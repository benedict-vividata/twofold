import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Git,
  isAllowedRemote,
  parseLineChanges,
  parseNameStatus,
  parseNumstat,
  safeRepoPath,
} from "./git.js";
import { Runner } from "./process.js";

const identity = { name: "Test", email: "test@example.com", date: "2026-01-01T00:00:00Z" };

describe("safeRepoPath", () => {
  it("normalises harmless paths", () => {
    expect(safeRepoPath("src/app.ts")).toBe("src/app.ts");
    expect(safeRepoPath("./src/")).toBe("src");
    expect(safeRepoPath("")).toBe("");
  });

  it.each(["../etc/passwd", "/etc/passwd", "src/../../x", "a//b", "a/./b", "a\0b"])(
    "rejects %j",
    (raw) => {
      expect(() => safeRepoPath(raw)).toThrow();
    },
  );
});

describe("isAllowedRemote", () => {
  it.each(["https://github.com/a/b.git", "git@github.com:a/b.git", "ssh://git@host/a.git"])(
    "allows %s",
    (url) => {
      expect(isAllowedRemote(url)).toBe(true);
    },
  );

  it.each(["ext::sh -c touch% /tmp/pwned", "file:///etc", "/local/path", "--upload-pack=evil"])(
    "rejects %s",
    (url) => {
      expect(isAllowedRemote(url)).toBe(false);
    },
  );
});

describe("diff parsing", () => {
  it("reads name-status records, including renames", () => {
    const output = [
      "M",
      "src/a.ts",
      "R087",
      "old.ts",
      "new.ts",
      "A",
      "added.ts",
      "D",
      "gone.ts",
      "",
    ].join("\0");
    expect(parseNameStatus(output)).toEqual([
      { path: "src/a.ts", oldPath: null, status: "modified" },
      { path: "new.ts", oldPath: "old.ts", status: "renamed" },
      { path: "added.ts", oldPath: null, status: "added" },
      { path: "gone.ts", oldPath: null, status: "deleted" },
    ]);
  });

  it("reads numstat records, including binaries and renames", () => {
    const output = ["3\t1\tsrc/a.ts", "-\t-\timage.png", "2\t2\t", "old.ts", "new.ts", ""].join(
      "\0",
    );
    const counts = parseNumstat(output);
    expect(counts.get("src/a.ts")).toEqual({ additions: 3, deletions: 1, binary: false });
    expect(counts.get("image.png")).toEqual({ additions: 0, deletions: 0, binary: true });
    expect(counts.get("new.ts")).toEqual({ additions: 2, deletions: 2, binary: false });
  });
});

describe("parseLineChanges", () => {
  it("reads added, modified and deleted hunks from a -U0 diff", () => {
    const diff = [
      "diff --git a/x b/x",
      "@@ -0,0 +1,2 @@",
      "+a",
      "+b",
      "@@ -10 +12 @@ fn()",
      "-old",
      "+new",
      "@@ -20,3 +21,0 @@",
      "-gone",
      "@@ -30,2 +27,5 @@",
    ].join("\n");
    expect(parseLineChanges(diff)).toEqual([
      { kind: "added", from: 1, to: 2 },
      { kind: "modified", from: 12, to: 12 },
      { kind: "deleted", from: 21, to: 21 },
      { kind: "modified", from: 27, to: 31 },
    ]);
  });
});

describe("Git", () => {
  let dir: string;
  let git: Git;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "twofold-git-"));
    git = new Git(new Runner(null, []));
    await git.init(dir);
    await writeFile(path.join(dir, "a.txt"), "one\ntwo\n");
    await writeFile(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    await git.text(dir, ["add", "--all"]);
    const tree = (await git.text(dir, ["write-tree"])).trim();
    base = (
      await git.text(dir, ["commit-tree", tree, "-m", "base"], {
        env: {
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      })
    ).trim();
    await git.resetBranch(dir, "main", base);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("snapshots the working tree as one commit on a parent", async () => {
    await writeFile(path.join(dir, "a.txt"), "one\nTWO\nthree\n");
    await writeFile(path.join(dir, "b.txt"), "new\n");
    const snap = await git.snapshot(dir, base, "change", identity);
    expect(snap.tree).not.toBe(await git.treeOf(dir, base));
    const changes = await git.changedFiles(dir, base, snap.commit);
    expect(changes).toEqual([
      {
        path: "a.txt",
        oldPath: null,
        status: "modified",
        additions: 2,
        deletions: 1,
        binary: false,
      },
      { path: "b.txt", oldPath: null, status: "added", additions: 1, deletions: 0, binary: false },
    ]);
  });

  it("reports changed lines in the new file's numbering", async () => {
    await writeFile(path.join(dir, "a.txt"), "zero\none\nTWO\n");
    const snap = await git.snapshot(dir, base, "change", identity);
    expect(await git.lineChanges(dir, base, snap.commit, ["a.txt"])).toEqual([
      { kind: "added", from: 1, to: 1 },
      { kind: "modified", from: 3, to: 3 },
    ]);
  });

  it("reads blobs, detecting binaries", async () => {
    expect(await git.blob(dir, base, "a.txt")).toEqual({
      binary: false,
      tooLarge: false,
      content: "one\ntwo\n",
    });
    expect(await git.blob(dir, base, "bin.dat")).toEqual({
      binary: true,
      tooLarge: false,
      content: null,
    });
  });

  it("lists a tree with directories first", async () => {
    await writeFile(path.join(dir, "z.txt"), "z");
    await git.text(dir, ["add", "--all"]);
    const snap = await git.snapshot(dir, base, "more", identity);
    const entries = await git.lsTree(dir, snap.commit, "");
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "bin.dat", "z.txt"]);
  });

  it("commits edits without touching the working tree", async () => {
    const commit = await git.commitEdits(
      dir,
      base,
      [{ path: "a.txt", content: "edited\n" }],
      "edit",
      identity,
    );
    expect((await git.blob(dir, commit, "a.txt")).content).toBe("edited\n");
    expect((await git.blob(dir, commit, "bin.dat")).binary).toBe(true);
    expect((await git.blob(dir, "HEAD", "a.txt")).content).toBe("one\ntwo\n");
  });

  it("refuses to run repository hooks", async () => {
    const hook = path.join(dir, ".git", "hooks", "reference-transaction");
    await writeFile(hook, `#!/bin/sh\ntouch ${path.join(dir, "hook-ran")}\n`, { mode: 0o755 });
    await git.updateRef(dir, "refs/twofold/test", base);
    await expect(git.blob(dir, base, "a.txt")).resolves.toBeDefined();
    const { stat } = await import("node:fs/promises");
    await expect(stat(path.join(dir, "hook-ran"))).rejects.toThrow();
  });
});
