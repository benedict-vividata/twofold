import { spawn } from "node:child_process";
import { chown } from "node:fs/promises";
import type { SandboxIdentity } from "./config.js";

export interface RunOptions {
  cwd: string;
  stdin?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Streams stdout line by line. When given, stdout is not also buffered. */
  onStdoutLine?: (line: string) => void;
  /** How much of stderr / the combined output to keep, from the end. */
  tailBytes?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
  /** stdout and stderr interleaved, truncated from the front to `tailBytes`. */
  output: string;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

export class CommandNotFoundError extends Error {
  constructor(readonly command: string) {
    super(`'${command}' is not installed or not on PATH`);
    this.name = "CommandNotFoundError";
  }
}

/** Keeps the last `limit` bytes of a stream as text. */
class Tail {
  private chunks: Buffer[] = [];
  private size = 0;
  private dropped = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      const first = this.chunks.shift();
      if (first === undefined) break;
      this.size -= first.length;
      this.dropped = true;
    }
  }

  text(): string {
    let buffer = Buffer.concat(this.chunks);
    if (buffer.length > this.limit) {
      buffer = buffer.subarray(buffer.length - this.limit);
      this.dropped = true;
    }
    const body = buffer.toString("utf8");
    return this.dropped ? `[… earlier output truncated …]\n${body}` : body;
  }
}

const KILL_GRACE_MS = 5000;

/**
 * Spawns processes, optionally as the sandbox user. Children never inherit the
 * server's environment wholesale: in sandbox mode they get a minimal one plus
 * an explicit pass-through list, so secrets like the admin token stay put.
 */
export class Runner {
  constructor(
    private readonly sandbox: SandboxIdentity | null,
    private readonly passthrough: readonly string[],
    private readonly parentEnv: NodeJS.ProcessEnv = process.env,
    private readonly userName = "agent",
  ) {}

  get sandboxed(): boolean {
    return this.sandbox !== null;
  }

  /**
   * Gives a file the server wrote to the sandbox user, so a process running as
   * that user can read it. (A no-op without a sandbox: everything is one user.)
   */
  async handOver(file: string): Promise<void> {
    if (this.sandbox !== null) await chown(file, this.sandbox.uid, this.sandbox.gid);
  }

  baseEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.sandbox === null) {
      for (const [key, value] of Object.entries(this.parentEnv)) {
        if (value !== undefined && !key.startsWith("TWOFOLD_")) env[key] = value;
      }
    } else {
      env.PATH = this.parentEnv.PATH ?? "/usr/local/bin:/usr/bin:/bin";
      env.HOME = this.sandbox.home;
      env.USER = this.userName;
      env.LOGNAME = this.userName;
      env.LANG = "C.UTF-8";
      env.LC_ALL = "C.UTF-8";
      env.TERM = "dumb";
      for (const name of this.passthrough) {
        const value = this.parentEnv[name];
        if (value !== undefined && value !== "") env[name] = value;
      }
    }
    env.GIT_TERMINAL_PROMPT = "0";
    env.GIT_PAGER = "cat";
    env.PAGER = "cat";
    return env;
  }

  run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    const started = Date.now();
    const tailBytes = options.tailBytes ?? 64 * 1024;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...this.baseEnv(), ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group, so a cancel takes down everything it started.
      detached: true,
      ...(this.sandbox === null ? {} : { uid: this.sandbox.uid, gid: this.sandbox.gid }),
    });

    return new Promise((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderr = new Tail(tailBytes);
      const combined = new Tail(tailBytes);
      let pendingLine = "";
      let timedOut = false;
      let aborted = false;
      let killTimer: NodeJS.Timeout | undefined;
      let settled = false;

      const killGroup = (): void => {
        const pid = child.pid;
        if (pid === undefined) return;
        const send = (signal: NodeJS.Signals): void => {
          try {
            process.kill(-pid, signal);
          } catch (_error) {
            // Already gone.
          }
        };
        send("SIGTERM");
        killTimer = setTimeout(() => {
          send("SIGKILL");
        }, KILL_GRACE_MS);
        killTimer.unref();
      };

      const timeout =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              killGroup();
            }, options.timeoutMs);

      const onAbort = (): void => {
        aborted = true;
        killGroup();
      };
      if (options.signal?.aborted === true) onAbort();
      options.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        combined.push(chunk);
        if (options.onStdoutLine === undefined) {
          stdoutChunks.push(chunk);
          return;
        }
        pendingLine += chunk.toString("utf8");
        let newline = pendingLine.indexOf("\n");
        while (newline !== -1) {
          const line = pendingLine.slice(0, newline);
          pendingLine = pendingLine.slice(newline + 1);
          if (line.trim() !== "") options.onStdoutLine(line);
          newline = pendingLine.indexOf("\n");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
        combined.push(chunk);
      });

      const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        if (killTimer !== undefined) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", onAbort);
        if (options.onStdoutLine !== undefined && pendingLine.trim() !== "") {
          options.onStdoutLine(pendingLine);
        }
        resolve({
          code,
          signal,
          stdout: Buffer.concat(stdoutChunks),
          stderr: stderr.text(),
          output: combined.text(),
          timedOut,
          aborted,
          durationMs: Date.now() - started,
        });
      };

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        reject(error.code === "ENOENT" ? new CommandNotFoundError(command) : error);
      });
      child.on("close", finish);

      // A child that exits before reading its input closes the pipe; that is
      // its business, not an error of ours.
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin ?? "");
    });
  }

  /** Runs a shell command line, as the sandbox user when there is one. */
  shell(commandLine: string, options: RunOptions): Promise<RunResult> {
    return this.run("/bin/sh", ["-c", commandLine], options);
  }
}
