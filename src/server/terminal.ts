// The candidate's terminals: real shells (a PTY each) on a private copy of the
// code, reached over a WebSocket.
//
// Each session has up to three, one per target: the merged code, and version
// A and B while they await a decision. A terminal's directory is an exported
// copy of that commit with a fresh one-commit git repository, so `git diff`
// shows what the candidate changed and nothing else. It has no history and no
// access to the session's repository, worktrees or labels. In the container
// the shell runs as its own user, which can read none of those.
//
// Nothing typed or printed here is recorded anywhere beyond the live
// scrollback that lets a reloaded page pick up where it left off.
import { spawn } from "node:child_process";
import { chown, mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { IPty } from "node-pty";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  TerminalClientMessage,
  TerminalTarget,
  type Session,
  type TerminalServerMessage,
} from "../shared/model.js";
import type { Config, SandboxIdentity } from "./config.js";
import { logger } from "./logger.js";
import type { AppPorts } from "./ports.js";
import type { SessionStore } from "./store.js";

type PtyModule = typeof import("node-pty");

const SCROLLBACK_BYTES = 256 * 1024;
const IDLE_MS = 30 * 60_000;
const HEARTBEAT_MS = 30_000;

interface Live {
  key: string;
  sessionId: string;
  target: TerminalTarget;
  /** The commit the directory was exported from, once it has been. */
  preparedCommit: string | null;
  pty: IPty | null;
  starting: Promise<void> | null;
  clients: Set<WebSocket>;
  scrollback: string;
  stale: boolean;
  size: { cols: number; rows: number };
  idle: NodeJS.Timeout | null;
}

const LABELS: Record<TerminalTarget, string> = {
  merged: "the merged code",
  a: "version A",
  b: "version B",
};

/** The commit a target runs on right now, or null if it has none. */
export function targetCommit(session: Session, target: TerminalTarget): string | null {
  if (target === "merged") return session.headCommit;
  for (const item of session.timeline) {
    if (item.type === "round" && item.status === "ready" && item.variants !== null) {
      return item.variants[target].commit;
    }
  }
  return null;
}

/** A directory name for the project, from its source. */
export function projectName(session: Session): string {
  const repo = session.config.repo;
  const raw =
    repo.kind === "sample"
      ? repo.name
      : repo.kind === "local"
        ? path.basename(repo.path)
        : (repo.url.split(/[/:]/).filter(Boolean).at(-1) ?? "").replace(/\.git$/, "");
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return name === "" ? "project" : name.slice(0, 60);
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function send(socket: WebSocket, message: TerminalServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

export class Terminals {
  private pty: PtyModule | null = null;
  private readonly live = new Map<string, Live>();
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly alive = new WeakSet<WebSocket>();

  constructor(
    private readonly config: Config,
    private readonly store: SessionStore,
    private readonly repoOf: (sessionId: string) => string,
    private readonly ports: AppPorts,
  ) {
    store.subscribeAll((id, session) => {
      this.sessionChanged(id, session);
    });
  }

  /** Loads the PTY module; without it the feature is simply off. */
  async init(): Promise<void> {
    try {
      this.pty = await import("node-pty");
    } catch (error) {
      logger.warn(`terminals are unavailable (node-pty did not load): ${String(error)}`);
      this.pty = null;
    }
    this.heartbeat = setInterval(() => {
      for (const socket of this.server.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  get available(): boolean {
    return this.pty !== null;
  }

  shutdown(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    for (const live of this.live.values()) this.close(live, "The server is restarting.");
    this.server.close();
  }

  // -------------------------------------------------------------------------
  // Connecting
  // -------------------------------------------------------------------------

  /** Handles `GET /api/c/:token/terminal?target=…` upgrades; anything else is refused. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const refuse = (status: number, reason: string): void => {
      socket.end(
        `HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    };
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = /^\/api\/c\/([^/]+)\/terminal$/.exec(url.pathname);
    if (match?.[1] === undefined) {
      refuse(404, "Not Found");
      return;
    }

    // Only pages served by this server may open a terminal.
    const origin = request.headers.origin;
    if (origin !== undefined) {
      let host: string | null;
      try {
        host = new URL(origin).host;
      } catch (_error) {
        host = null;
      }
      if (host !== request.headers.host) {
        refuse(403, "Forbidden");
        return;
      }
    }

    const session = this.store.findByToken(decodeURIComponent(match[1]));
    if (session === undefined) {
      refuse(404, "Not Found");
      return;
    }
    if (this.pty === null || !session.config.allowTerminal) {
      refuse(403, "Forbidden");
      return;
    }
    const target = TerminalTarget.safeParse(url.searchParams.get("target") ?? "merged");
    if (!target.success) {
      refuse(400, "Bad Request");
      return;
    }
    if (session.status !== "active" || targetCommit(session, target.data) === null) {
      refuse(409, "Conflict");
      return;
    }
    const cols = Number.parseInt(url.searchParams.get("cols") ?? "", 10);
    const rows = Number.parseInt(url.searchParams.get("rows") ?? "", 10);
    const size = {
      cols: Number.isFinite(cols) ? Math.min(Math.max(cols, 20), 1000) : 100,
      rows: Number.isFinite(rows) ? Math.min(Math.max(rows, 5), 500) : 30,
    };

    this.server.handleUpgrade(request, socket, head, (client) => {
      this.attach(client, session.id, target.data, size);
    });
  }

  private attach(
    socket: WebSocket,
    sessionId: string,
    target: TerminalTarget,
    size: { cols: number; rows: number },
  ): void {
    const key = `${sessionId}:${target}`;
    let live = this.live.get(key);
    if (live === undefined) {
      live = {
        key,
        sessionId,
        target,
        preparedCommit: null,
        pty: null,
        starting: null,
        clients: new Set(),
        scrollback: "",
        stale: false,
        size,
        idle: null,
      };
      this.live.set(key, live);
    }
    const entry = live;
    if (entry.idle !== null) {
      clearTimeout(entry.idle);
      entry.idle = null;
    }
    entry.clients.add(socket);
    this.alive.add(socket);

    if (entry.scrollback !== "") send(socket, { t: "o", d: entry.scrollback });
    if (entry.stale) send(socket, { t: "s", state: "stale", message: this.staleMessage(entry) });

    socket.on("pong", () => {
      this.alive.add(socket);
    });
    socket.on("message", (data) => {
      this.onMessage(entry, data);
    });
    socket.on("close", () => {
      entry.clients.delete(socket);
      if (entry.clients.size === 0 && this.live.get(entry.key) === entry) {
        entry.idle = setTimeout(() => {
          this.stop(entry);
        }, IDLE_MS);
        entry.idle.unref();
      }
    });

    if (entry.pty === null) {
      entry.size = size;
      void this.start(entry, false);
    } else {
      send(socket, { t: "s", state: "ready", message: "" });
    }
  }

  private onMessage(live: Live, data: RawData): void {
    let raw: unknown;
    try {
      raw = JSON.parse(rawText(data));
    } catch (_error) {
      return;
    }
    const message = TerminalClientMessage.safeParse(raw);
    if (!message.success) return;
    switch (message.data.t) {
      case "i":
        live.pty?.write(message.data.d);
        break;
      case "r":
        live.size = { cols: message.data.c, rows: message.data.r };
        try {
          live.pty?.resize(message.data.c, message.data.r);
        } catch (_error) {
          // The shell may have just exited.
        }
        break;
      case "restart":
        void this.start(live, true);
        break;
    }
  }

  private broadcast(live: Live, message: TerminalServerMessage): void {
    for (const socket of live.clients) send(socket, message);
  }

  private appendOutput(live: Live, data: string): void {
    live.scrollback += data;
    if (live.scrollback.length > SCROLLBACK_BYTES) {
      live.scrollback = live.scrollback.slice(live.scrollback.length - SCROLLBACK_BYTES);
    }
    this.broadcast(live, { t: "o", d: data });
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------

  /** Starts the shell, exporting the code first if it isn't there yet (or `fresh` is asked for). */
  private start(live: Live, fresh: boolean): Promise<void> {
    if (live.starting !== null) return live.starting;
    const run = async (): Promise<void> => {
      const session = this.store.get(live.sessionId);
      const commit = session === undefined ? null : targetCommit(session, live.target);
      if (session === undefined || commit === null || this.pty === null) {
        this.close(live, "This terminal is no longer available.");
        return;
      }
      if (live.pty !== null) {
        live.pty.kill();
        live.pty = null;
      }
      const dirs = this.dirs(session, live.target);
      if (fresh || live.preparedCommit !== commit) {
        live.scrollback = "";
        this.broadcast(live, {
          t: "s",
          state: "preparing",
          message: `Copying ${LABELS[live.target]}…`,
        });
        await this.prepare(session, live.target, commit);
        live.preparedCommit = commit;
        live.stale = false;
      }

      const shell = this.pty.spawn("/bin/bash", ["--rcfile", dirs.rc, "-i"], {
        name: "xterm-256color",
        cols: live.size.cols,
        rows: live.size.rows,
        cwd: dirs.project,
        env: {
          ...this.environment(),
          PORT: String(this.ports.portFor(live.sessionId, live.target)),
        },
        ...(this.config.terminalUser === null
          ? {}
          : { uid: this.config.terminalUser.uid, gid: this.config.terminalUser.gid }),
      });
      live.pty = shell;
      shell.onData((data) => {
        this.appendOutput(live, data);
      });
      shell.onExit(({ exitCode }) => {
        if (live.pty !== shell) return;
        live.pty = null;
        this.broadcast(live, { t: "x", code: exitCode });
      });
      this.broadcast(live, { t: "s", state: "ready", message: "" });
    };
    live.starting = run()
      .catch((error: unknown) => {
        logger.warn(`terminal ${live.key} failed to start: ${String(error)}`);
        this.broadcast(live, {
          t: "s",
          state: "error",
          message: "The terminal couldn't be started. Try restarting it.",
        });
      })
      .finally(() => {
        live.starting = null;
      });
    return live.starting;
  }

  private stop(live: Live): void {
    if (live.pty !== null) {
      live.pty.kill();
      live.pty = null;
    }
    if (live.idle !== null) clearTimeout(live.idle);
    live.idle = null;
  }

  private close(live: Live, message: string): void {
    this.stop(live);
    this.broadcast(live, { t: "s", state: "closed", message });
    for (const socket of live.clients) socket.close(1000);
    live.clients.clear();
    this.live.delete(live.key);
  }

  private staleMessage(live: Live): string {
    return live.target === "merged"
      ? "The merged code has changed since this terminal started. Restart it to load the new code — changes you made here will be discarded."
      : "This version has changed. Restart the terminal to load it.";
  }

  /** Keeps terminals in step with the session: stale after a merge, closed when a version goes away. */
  private sessionChanged(id: string, session: Session | null): void {
    for (const live of [...this.live.values()]) {
      if (live.sessionId !== id) continue;
      if (session?.status !== "active") {
        this.close(live, session === null ? "This session was deleted." : "The session has ended.");
        continue;
      }
      const commit = targetCommit(session, live.target);
      if (commit === null) {
        this.close(
          live,
          `Version ${live.target.toUpperCase()} is no longer waiting for a decision, so its terminal has closed.`,
        );
        void rm(path.join(this.config.terminalsDir, id, live.target), {
          recursive: true,
          force: true,
        });
        continue;
      }
      if (live.preparedCommit !== null && commit !== live.preparedCommit && !live.stale) {
        if (live.target === "merged") {
          live.stale = true;
          this.broadcast(live, { t: "s", state: "stale", message: this.staleMessage(live) });
        } else {
          this.close(live, "A new pair of versions replaced this one.");
        }
      }
    }
    if (session === null) {
      this.ports.release(id);
      void rm(path.join(this.config.terminalsDir, id), { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // The directory a terminal works in
  // -------------------------------------------------------------------------

  private dirs(
    session: Session,
    target: TerminalTarget,
  ): { root: string; project: string; rc: string; marker: string } {
    const root = path.join(this.config.terminalsDir, session.id, target);
    return {
      root,
      project: path.join(root, projectName(session)),
      rc: path.join(root, ".bashrc-twofold"),
      marker: path.join(root, ".setup-done"),
    };
  }

  private environment(): Record<string, string> {
    const user = this.config.terminalUser;
    const env: Record<string, string> = {};
    if (user === null) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !key.startsWith("TWOFOLD_")) env[key] = value;
      }
    } else {
      // Built from nothing: no credentials or server settings reach the shell.
      env.PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
      env.HOME = user.home;
      env.USER = "candidate";
      env.LOGNAME = "candidate";
      env.SHELL = "/bin/bash";
      env.LANG = "C.UTF-8";
      env.LC_ALL = "C.UTF-8";
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    return env;
  }

  private async makeDir(dir: string, user: SandboxIdentity | null): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (user !== null) await chown(dir, user.uid, user.gid);
  }

  private async prepare(session: Session, target: TerminalTarget, commit: string): Promise<void> {
    const user = this.config.terminalUser;
    const dirs = this.dirs(session, target);
    await rm(dirs.root, { recursive: true, force: true });
    await this.makeDir(path.join(this.config.terminalsDir, session.id), user);
    await this.makeDir(dirs.root, user);
    await this.makeDir(dirs.project, user);
    await this.exportTree(this.repoOf(session.id), commit, dirs.project);

    const git = async (args: string[]): Promise<void> => {
      await this.run(
        "git",
        ["-c", "user.name=Candidate", "-c", "user.email=candidate@twofold.localhost", ...args],
        dirs.project,
        user,
      );
    };
    await git(["init", "-q", "-b", "main"]);
    await git(["add", "--all"]);
    await git([
      "commit",
      "-q",
      "--no-verify",
      "--allow-empty",
      "-m",
      `Starting point: ${LABELS[target]}`,
    ]);

    const setup = session.config.commands.setup.trim();
    const label =
      target === "merged"
        ? "\\[\\e[1m\\]merged\\[\\e[0m\\]"
        : `\\[\\e[1;${target === "a" ? "36" : "35"}m\\]${target.toUpperCase()}\\[\\e[0m\\]`;
    const banner =
      target === "merged"
        ? "Terminal on the merged code. Changes you make here aren't part of your submission."
        : `Terminal on version ${target.toUpperCase()}. Changes you make here aren't part of your submission.`;
    const rc = [
      "[ -r /etc/bash.bashrc ] && . /etc/bash.bashrc",
      '[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
      `PS1=${shellQuote(`${label} \\[\\e[2m\\]\\W\\[\\e[0m\\] \\$ `)}`,
      `cd ${shellQuote(dirs.project)}`,
      `printf '\\033[2m%s\\033[0m\\n' ${shellQuote(banner)}`,
      `printf '\\033[2m%s\\033[0m\\n' ${shellQuote(
        `PORT=${String(this.ports.portFor(session.id, target))} is set here: a server started on it shows up in the Preview tab.`,
      )}`,
      setup === ""
        ? ""
        : [
            `if [ ! -e ${shellQuote(dirs.marker)} ]; then`,
            `  printf '\\033[2m$ %s\\033[0m\\n' ${shellQuote(setup)}`,
            `  ( ${setup} )`,
            `  touch ${shellQuote(dirs.marker)}`,
            "fi",
          ].join("\n"),
      "",
    ].join("\n");
    await writeFile(dirs.rc, rc, { mode: 0o600 });
    if (user !== null) await chown(dirs.rc, user.uid, user.gid);
  }

  /** `git archive` as the sandbox user, piped into `tar` as the terminal user. */
  private exportTree(repo: string, commit: string, into: string): Promise<void> {
    const sandbox = this.config.sandbox;
    const user = this.config.terminalUser;
    return new Promise((resolve, reject) => {
      const archive = spawn(
        "git",
        ["-c", "core.hooksPath=/dev/null", "archive", "--format=tar", commit],
        {
          cwd: repo,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: sandbox?.home ?? process.env.HOME ?? "/",
          },
          ...(sandbox === null ? {} : { uid: sandbox.uid, gid: sandbox.gid }),
        },
      );
      const extract = spawn("tar", ["-x", "-f", "-", "-C", into], {
        cwd: into,
        stdio: ["pipe", "ignore", "pipe"],
        // Runs as the candidate, who can read its environment: give it nothing of ours.
        env: this.environment(),
        ...(user === null ? {} : { uid: user.uid, gid: user.gid }),
      });
      archive.stdout.pipe(extract.stdin);
      let errors = "";
      archive.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString("utf8")));
      extract.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString("utf8")));
      let pending = 2;
      let failed = false;
      const done = (code: number | null): void => {
        if (code !== 0 && !failed) {
          failed = true;
          reject(new Error(`exporting the code failed: ${errors.trim()}`));
          return;
        }
        pending -= 1;
        if (pending === 0 && !failed) resolve();
      };
      archive.on("error", reject);
      extract.on("error", reject);
      archive.on("close", done);
      extract.on("close", done);
    });
  }

  private run(
    command: string,
    args: string[],
    cwd: string,
    user: SandboxIdentity | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...this.environment(), GIT_TERMINAL_PROMPT: "0" },
        ...(user === null ? {} : { uid: user.uid, gid: user.gid }),
      });
      let errors = "";
      child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(" ")} failed: ${errors.trim()}`));
      });
    });
  }
}
