import { chown, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CheckResult, Session } from "../shared/model.js";
import type { Config } from "./config.js";
import { Git, isAllowedRemote, type CommitIdentity } from "./git.js";
import type { Runner } from "./process.js";

export const ACCEPTED_BRANCH = "twofold/accepted";

/** Worktrees a round can produce versions in. The names never reach the candidate. */
export type Slot = "ref" | "x" | "y";

export interface SessionPaths {
  root: string;
  repo: string;
  scratch: string;
  tree: (slot: Slot) => string;
}

export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionError";
  }
}

export const SYSTEM_IDENTITY = { name: "Twofold", email: "twofold@localhost" };
export const ASSISTANT_IDENTITY = { name: "Assistant", email: "assistant@twofold.localhost" };
export const CANDIDATE_IDENTITY = { name: "Candidate", email: "candidate@twofold.localhost" };

/**
 * Owns the on-disk side of a session: the clone, the worktrees versions are
 * generated in, and the interviewer's setup and check commands. Every process
 * here runs through the runner, so in the container it runs as the sandbox user.
 */
export class Workspaces {
  constructor(
    private readonly config: Config,
    private readonly runner: Runner,
    readonly git: Git,
  ) {}

  paths(id: string): SessionPaths {
    const root = path.join(this.config.workDir, id);
    return {
      root,
      repo: path.join(root, "repo"),
      scratch: path.join(root, "scratch"),
      tree: (slot) => path.join(root, "trees", slot),
    };
  }

  /** A directory the sandbox user owns. */
  private async makeDir(dir: string): Promise<void> {
    // Not world-readable: the candidate's terminal user must not see inside.
    await mkdir(dir, { recursive: true, mode: 0o2770 });
    const sandbox = this.config.sandbox;
    if (sandbox !== null) await chown(dir, sandbox.uid, sandbox.gid);
  }

  /** Clones the session's source and returns the base commit. */
  async provision(
    session: Session,
    log: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const paths = this.paths(session.id);
    await this.makeDir(this.config.workDir);
    await rm(paths.root, { recursive: true, force: true });
    await this.makeDir(paths.root);
    await this.makeDir(paths.scratch);
    await this.makeDir(paths.repo);

    const source = session.config.repo;
    const cloneTimeout = 15 * 60_000;
    switch (source.kind) {
      case "sample": {
        const sampleDir = path.join(this.config.samplesDir, source.name);
        log(`Copying the ${source.name} sample`);
        await this.expectSuccess(
          await this.runner.run("cp", ["-R", `${sampleDir}/.`, paths.repo], {
            cwd: paths.root,
            ...(signal === undefined ? {} : { signal }),
          }),
          "Could not copy the sample repository",
        );
        await this.git.init(paths.repo);
        const identity: CommitIdentity = { ...SYSTEM_IDENTITY, date: "2026-01-01T09:00:00Z" };
        await this.git.text(paths.repo, ["add", "--all"]);
        const tree = (await this.git.text(paths.repo, ["write-tree"])).trim();
        const commit = (
          await this.git.text(paths.repo, ["commit-tree", tree, "-F", "-"], {
            stdin: "Initial commit",
            env: {
              GIT_AUTHOR_NAME: identity.name,
              GIT_AUTHOR_EMAIL: identity.email,
              GIT_AUTHOR_DATE: identity.date,
              GIT_COMMITTER_NAME: identity.name,
              GIT_COMMITTER_EMAIL: identity.email,
              GIT_COMMITTER_DATE: identity.date,
            },
          })
        ).trim();
        await this.git.resetBranch(paths.repo, ACCEPTED_BRANCH, commit);
        return commit;
      }
      case "git": {
        if (!isAllowedRemote(source.url)) {
          throw new ProvisionError(
            "Only https://, ssh:// and git:// URLs (or user@host:path) are supported.",
          );
        }
        log(`Fetching ${redactUrl(source.url)}${source.ref === "" ? "" : ` at ${source.ref}`}`);
        return this.git.cloneRef({
          dir: paths.repo,
          remote: source.url,
          ref: source.ref,
          shallow: !source.fullHistory,
          branch: ACCEPTED_BRANCH,
          timeoutMs: cloneTimeout,
          ...(signal === undefined ? {} : { signal }),
        });
      }
      case "local": {
        const resolved = path.resolve(this.config.reposDir, source.path);
        if (
          resolved !== this.config.reposDir &&
          !resolved.startsWith(`${this.config.reposDir}${path.sep}`)
        ) {
          throw new ProvisionError(`Local repositories must live under ${this.config.reposDir}.`);
        }
        const exists = await stat(resolved).catch(() => null);
        if (exists?.isDirectory() !== true)
          throw new ProvisionError(`No repository at ${resolved}.`);
        log(`Fetching ${source.path}${source.ref === "" ? "" : ` at ${source.ref}`}`);
        return this.git.cloneRef({
          dir: paths.repo,
          remote: `file://${resolved}`,
          ref: source.ref,
          shallow: false,
          branch: ACCEPTED_BRANCH,
          timeoutMs: cloneTimeout,
          ...(signal === undefined ? {} : { signal }),
        });
      }
    }
  }

  private async expectSuccess(
    result: { code: number | null; output: string },
    message: string,
  ): Promise<void> {
    if (result.code !== 0) throw new ProvisionError(`${message}: ${result.output.trim()}`);
  }

  /** Creates the worktree for a slot on first use, running the setup command in it. */
  async ensureTree(session: Session, slot: Slot, commit: string): Promise<string> {
    const paths = this.paths(session.id);
    const dir = paths.tree(slot);
    const exists = await stat(path.join(dir, ".git")).catch(() => null);
    if (exists !== null) return dir;

    await this.makeDir(path.dirname(dir));
    await this.git.addWorktree(paths.repo, dir, commit);
    const setup = session.config.commands.setup.trim();
    if (setup !== "") {
      const result = await this.runCommand(session, dir, setup);
      if (result.status !== "passed") {
        await rm(dir, { recursive: true, force: true });
        await this.git.text(paths.repo, ["worktree", "prune"]).catch(() => "");
        throw new ProvisionError(`The setup command failed in a fresh worktree:\n${result.output}`);
      }
    }
    return dir;
  }

  async runCommand(
    session: Session,
    cwd: string,
    command: string,
    signal?: AbortSignal,
  ): Promise<CheckResult> {
    const result = await this.runner.shell(command, {
      cwd,
      env: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
      timeoutMs: session.config.commands.timeoutSeconds * 1000,
      tailBytes: 48 * 1024,
      ...(signal === undefined ? {} : { signal }),
    });
    const note = result.timedOut
      ? `\n[timed out after ${String(session.config.commands.timeoutSeconds)}s]`
      : result.aborted
        ? "\n[cancelled]"
        : "";
    return {
      status: result.code === 0 && !result.timedOut && !result.aborted ? "passed" : "failed",
      exitCode: result.code,
      output: `${result.output}${note}`,
      durationMs: result.durationMs,
    };
  }

  /** The check command, or a `skipped` result when there is none. */
  async check(session: Session, cwd: string, signal?: AbortSignal): Promise<CheckResult> {
    const command = session.config.commands.check.trim();
    if (command === "") return { status: "skipped", exitCode: null, output: "", durationMs: 0 };
    return this.runCommand(session, cwd, command, signal);
  }

  async remove(id: string): Promise<void> {
    await rm(this.paths(id).root, { recursive: true, force: true });
  }
}

export function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@\s]+@/, "//***@");
}
