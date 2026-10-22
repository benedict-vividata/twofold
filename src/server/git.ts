import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { FileChange, TreeEntry } from "../shared/model.js";
import type { RunResult, Runner } from "./process.js";

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: RunResult,
  ) {
    const detail =
      result.stderr.trim() || result.output.trim() || `exit code ${String(result.code)}`;
    super(`git ${args.slice(0, 2).join(" ")} failed: ${detail}`);
    this.name = "GitError";
  }
}

export interface CommitIdentity {
  name: string;
  email: string;
  /** ISO timestamp used for both author and committer dates. */
  date: string;
}

export interface BlobContent {
  binary: boolean;
  tooLarge: boolean;
  content: string | null;
}

export const MAX_BLOB_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

/** Config every invocation carries, whatever the repository's own config says. */
const HARDENING = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotePath=false",
  "-c",
  "advice.detachedHead=false",
  "-c",
  "init.defaultBranch=main",
  "-c",
  "commit.gpgSign=false",
];

/**
 * Rejects paths that could escape a tree: absolute, `..` segments, NUL bytes.
 * Every path a client sends goes through here before it reaches git.
 */
export function safeRepoPath(raw: string): string {
  const trimmed = raw
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (trimmed.includes("\0")) throw new Error("Invalid path");
  if (trimmed === "") return "";
  if (trimmed.startsWith("/")) throw new Error("Invalid path");
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error("Invalid path");
  }
  return segments.join("/");
}

export function isAllowedRemote(url: string): boolean {
  return (
    /^(https?:\/\/|ssh:\/\/|git:\/\/)[^\s]+$/i.test(url) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(url)
  );
}

export class Git {
  constructor(private readonly runner: Runner) {}

  private async exec(
    cwd: string,
    args: readonly string[],
    options: {
      stdin?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<RunResult> {
    const result = await this.runner.run("git", [...HARDENING, ...args], {
      cwd,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      env: { GIT_LFS_SKIP_SMUDGE: "1", ...options.env },
      timeoutMs: options.timeoutMs ?? 120_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      tailBytes: 16 * 1024,
    });
    if (result.code !== 0) throw new GitError(args, result);
    return result;
  }

  async text(
    cwd: string,
    args: readonly string[],
    options: {
      stdin?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<string> {
    const result = await this.exec(cwd, args, options);
    return result.stdout.toString("utf8");
  }

  async init(dir: string): Promise<void> {
    await this.exec(dir, ["init", "--quiet", "--shared=group"]);
  }

  /**
   * Fetches a single ref (a branch, tag or commit; the remote's HEAD when
   * empty) into a fresh repository and checks it out on `branch`. The remote is
   * removed afterwards so credentials embedded in the URL go no further.
   */
  async cloneRef(params: {
    dir: string;
    remote: string;
    ref: string;
    shallow: boolean;
    branch: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const { dir, remote, ref, shallow, branch, timeoutMs, signal } = params;
    await this.init(dir);
    await this.exec(dir, ["remote", "add", "origin", remote]);
    const fetchArgs = ["fetch", "--quiet", "--no-tags", "--no-recurse-submodules"];
    if (shallow) fetchArgs.push("--depth", "1");
    fetchArgs.push("origin", ref === "" ? "HEAD" : ref);
    await this.exec(dir, fetchArgs, { timeoutMs, ...(signal === undefined ? {} : { signal }) });
    await this.exec(dir, ["checkout", "--quiet", "-B", branch, "FETCH_HEAD"]);
    await this.exec(dir, ["remote", "remove", "origin"]);
    return this.resolveCommit(dir, "HEAD");
  }

  async resolveCommit(cwd: string, rev: string): Promise<string> {
    return (await this.text(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])).trim();
  }

  async treeOf(cwd: string, commit: string): Promise<string> {
    return (await this.text(cwd, ["rev-parse", "--verify", `${commit}^{tree}`])).trim();
  }

  async addWorktree(repo: string, dir: string, commit: string): Promise<void> {
    await this.exec(repo, ["worktree", "add", "--quiet", "--detach", "--force", dir, commit]);
  }

  /** Puts a worktree exactly at `commit`, keeping ignored files (installed dependencies). */
  async resetWorktree(dir: string, commit: string): Promise<void> {
    await this.exec(dir, ["checkout", "--quiet", "--detach", "--force", commit]);
    await this.exec(dir, ["reset", "--quiet", "--hard", commit]);
    await this.exec(dir, ["clean", "-fdq"]);
  }

  /** Resets the branch checked out in `dir` to `commit`, for the main checkout. */
  async resetBranch(dir: string, branch: string, commit: string): Promise<void> {
    await this.exec(dir, ["checkout", "--quiet", "--force", "-B", branch, commit]);
    await this.exec(dir, ["reset", "--quiet", "--hard", commit]);
    await this.exec(dir, ["clean", "-fdq"]);
  }

  private identityEnv(identity: CommitIdentity): Record<string, string> {
    return {
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_AUTHOR_DATE: identity.date,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
      GIT_COMMITTER_DATE: identity.date,
    };
  }

  async commitTree(
    cwd: string,
    tree: string,
    parent: string,
    message: string,
    identity: CommitIdentity,
  ): Promise<string> {
    return (
      await this.text(cwd, ["commit-tree", tree, "-p", parent, "-F", "-"], {
        stdin: message,
        env: this.identityEnv(identity),
      })
    ).trim();
  }

  /**
   * Commits whatever is in the worktree now — whether or not the agent made
   * commits of its own — as a single commit on top of `parent`.
   */
  async snapshot(
    dir: string,
    parent: string,
    message: string,
    identity: CommitIdentity,
  ): Promise<{ commit: string; tree: string }> {
    await this.exec(dir, ["add", "--all"]);
    const tree = (await this.text(dir, ["write-tree"])).trim();
    const commit = await this.commitTree(dir, tree, parent, message, identity);
    return { commit, tree };
  }

  async updateRef(repo: string, ref: string, commit: string): Promise<void> {
    await this.exec(repo, ["update-ref", ref, commit]);
  }

  async diff(repo: string, base: string, commit: string, maxBytes = 200_000): Promise<string> {
    const text = await this.text(repo, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "-M",
      base,
      commit,
    ]);
    if (text.length <= maxBytes) return text;
    return `${text.slice(0, maxBytes)}\n[… diff truncated …]\n`;
  }

  async changedFiles(
    repo: string,
    base: string,
    commit: string,
  ): Promise<Omit<FileChange, "before" | "after" | "tooLarge">[]> {
    const common = ["diff", "--no-ext-diff", "--no-textconv", "-M", "-z"];
    const [nameStatus, numstat] = await Promise.all([
      this.text(repo, [...common, "--name-status", base, commit]),
      this.text(repo, [...common, "--numstat", base, commit]),
    ]);

    const counts = parseNumstat(numstat);
    return parseNameStatus(nameStatus).map((entry) => {
      const count = counts.get(entry.path);
      return {
        ...entry,
        additions: count?.additions ?? 0,
        deletions: count?.deletions ?? 0,
        binary: count?.binary ?? false,
      };
    });
  }

  async blob(repo: string, commit: string, filePath: string): Promise<BlobContent> {
    const spec = `${commit}:${safeRepoPath(filePath)}`;
    const size = Number.parseInt((await this.text(repo, ["cat-file", "-s", spec])).trim(), 10);
    if (size > MAX_BLOB_BYTES) return { binary: false, tooLarge: true, content: null };
    const result = await this.exec(repo, ["cat-file", "blob", spec]);
    const bytes = result.stdout;
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { binary: true, tooLarge: false, content: null };
    }
    return { binary: false, tooLarge: false, content: bytes.toString("utf8") };
  }

  async lsTree(repo: string, commit: string, dir: string): Promise<TreeEntry[]> {
    const safeDir = safeRepoPath(dir);
    const args = ["ls-tree", "-z", commit];
    if (safeDir !== "") args.push("--", `${safeDir}/`);
    const output = await this.text(repo, args);
    const entries: TreeEntry[] = [];
    for (const record of output.split("\0")) {
      if (record === "") continue;
      const tab = record.indexOf("\t");
      if (tab === -1) continue;
      const [, type] = record.slice(0, tab).split(" ");
      const entryPath = record.slice(tab + 1);
      entries.push({
        name: path.posix.basename(entryPath),
        path: entryPath,
        type: type === "tree" ? "dir" : "file",
      });
    }
    return entries.sort((left, right) =>
      left.type === right.type ? left.name.localeCompare(right.name) : left.type === "dir" ? -1 : 1,
    );
  }

  private async modeOf(repo: string, commit: string, filePath: string): Promise<string | null> {
    const output = await this.text(repo, ["ls-tree", "-z", commit, "--", filePath]);
    const record = output.split("\0")[0] ?? "";
    const mode = record.split(" ")[0];
    return mode === undefined || mode === "" ? null : mode;
  }

  /** A new commit on `parent` with the given files replaced, built without touching any worktree. */
  async commitEdits(
    repo: string,
    parent: string,
    edits: readonly { path: string; content: string }[],
    message: string,
    identity: CommitIdentity,
  ): Promise<string> {
    const gitDir = (await this.text(repo, ["rev-parse", "--absolute-git-dir"])).trim();
    const indexFile = path.join(gitDir, `twofold-edit-${randomBytes(6).toString("hex")}.index`);
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      await this.exec(repo, ["read-tree", parent], { env });
      for (const edit of edits) {
        const filePath = safeRepoPath(edit.path);
        const mode = (await this.modeOf(repo, parent, filePath)) ?? "100644";
        const blob = (
          await this.text(repo, ["hash-object", "-w", "--no-filters", "--stdin"], {
            stdin: edit.content,
          })
        ).trim();
        await this.exec(
          repo,
          ["update-index", "--add", "--cacheinfo", `${mode},${blob},${filePath}`],
          {
            env,
          },
        );
      }
      const tree = (await this.text(repo, ["write-tree"], { env })).trim();
      return await this.commitTree(repo, tree, parent, message, identity);
    } finally {
      await rm(indexFile, { force: true });
    }
  }
}

type NameStatusEntry = Pick<FileChange, "path" | "oldPath" | "status">;

export function parseNameStatus(output: string): NameStatusEntry[] {
  const fields = output.split("\0");
  const entries: NameStatusEntry[] = [];
  let index = 0;
  while (index < fields.length) {
    const code = fields[index];
    if (code === undefined || code === "") {
      index += 1;
      continue;
    }
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = fields[index + 1] ?? "";
      const newPath = fields[index + 2] ?? "";
      entries.push({
        path: newPath,
        oldPath,
        status: letter === "R" ? "renamed" : "added",
      });
      index += 3;
      continue;
    }
    const filePath = fields[index + 1] ?? "";
    const status = letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
    entries.push({ path: filePath, oldPath: null, status });
    index += 2;
  }
  return entries;
}

interface Count {
  additions: number;
  deletions: number;
  binary: boolean;
}

export function parseNumstat(output: string): Map<string, Count> {
  const counts = new Map<string, Count>();
  const fields = output.split("\0");
  let index = 0;
  while (index < fields.length) {
    const record = fields[index];
    if (record === undefined || record === "") {
      index += 1;
      continue;
    }
    const [added = "0", deleted = "0", inlinePath = ""] = record.split("\t");
    const binary = added === "-" && deleted === "-";
    const count: Count = {
      additions: binary ? 0 : Number.parseInt(added, 10),
      deletions: binary ? 0 : Number.parseInt(deleted, 10),
      binary,
    };
    if (inlinePath === "") {
      // A rename: the old and new paths follow as their own fields.
      const newPath = fields[index + 2] ?? "";
      counts.set(newPath, count);
      index += 3;
    } else {
      counts.set(inlinePath, count);
      index += 1;
    }
  }
  return counts;
}
