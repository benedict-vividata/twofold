import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessStatus } from "../shared/model.js";
import type { AgentResult, AgentTurn, Harness } from "./agents/types.js";
import { buildReport } from "./report.js";
import {
  createTestApp,
  lastRound,
  readySession,
  sampleConfig,
  waitFor,
  type TestApp,
} from "./testing/fixtures.js";
import { toCandidateSession } from "./views.js";

class ScriptedHarness implements Harness {
  readonly kind = "mock";
  readonly label = "Scripted";
  readonly turns: AgentTurn[] = [];

  constructor(private readonly script: (turn: AgentTurn, index: number) => Promise<AgentResult>) {}

  async status(): Promise<HarnessStatus> {
    return {
      kind: "mock",
      label: this.label,
      installed: true,
      authenticated: true,
      detail: "",
      models: [],
      efforts: [],
    };
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    this.turns.push(turn);
    return this.script(turn, this.turns.length - 1);
  }
}

function result(structured: unknown = { summary: "Done." }, text = "Done."): AgentResult {
  return { sessionId: null, text, structured, costUsd: null };
}

let t: TestApp;
afterEach(async () => {
  await t.cleanup();
});

describe("with the mock assistant", () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("provisions the sample and records a passing baseline", async () => {
    const session = await readySession(t.app);
    const ready = t.app.session(session.id);
    expect(ready.status).toBe("active");
    expect(ready.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(ready.headCommit).toBe(ready.baseCommit);
    expect(ready.baseline?.status).toBe("passed");
  });

  it("produces a reference and a degraded version, both checked", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    t.app.generate(session.id, "Add pagination to GET /books");
    const done = await waitFor(t.app, session.id, (s) => lastRound(s).status !== "generating");
    const round = lastRound(done);
    expect(round.status).toBe("ready");
    expect(round.pairKind).toBe("degraded");
    const roles = [round.variants?.a.role, round.variants?.b.role].sort();
    expect(roles).toEqual(["degraded", "reference"]);
    const degraded = round.variants?.a.role === "degraded" ? round.variants.a : round.variants?.b;
    expect(degraded?.degradation?.talkingPoints.length).toBeGreaterThan(0);
    expect(round.variants?.a.check.status).toBe("passed");
    expect(round.variants?.b.check.status).toBe("passed");
    expect(round.variants?.a.commit).not.toBe(round.variants?.b.commit);
    expect(round.runs.map((run) => run.purpose)).toEqual(["reference", "degrade"]);

    const files = await t.app.variantFiles(done, round.id, "a");
    expect(files.files).toHaveLength(1);
    expect(files.files[0]?.status).toBe("added");
    expect(files.files[0]?.after).toContain("export function paginate");
  });

  it("never sends hidden labels to the candidate", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    t.app.generate(session.id, "Add pagination");
    const done = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    const round = lastRound(done);
    const serialized = JSON.stringify(toCandidateSession(done));
    const degraded = round.variants?.a.degradation ?? round.variants?.b.degradation;
    for (const secret of [
      "reference",
      "degraded",
      "pairKind",
      "talkingPoints",
      degraded?.id ?? "missing",
      degraded?.summary ?? "missing",
      round.variants?.a.commit ?? "missing",
      done.config.privateNotes || "privateNotes",
      done.candidateToken,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("accepts a version with hand edits on top", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 0, tradeoff: 0, bothFlawed: 0, control: 1 },
    });
    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    const round = lastRound(ready);
    const files = await t.app.variantFiles(ready, round.id, "b");
    const file = files.files[0];
    expect(file).toBeDefined();
    const edited = `${file?.after ?? ""}// reviewed\n`;

    await t.app.decide(session.id, round.id, {
      choice: "b",
      tags: ["Readability", "Readability", " "],
      note: "Smaller and clearer.",
      edits: [{ path: file?.path ?? "", content: edited }],
    });

    const after = t.app.session(session.id);
    const decided = lastRound(after);
    expect(decided.status).toBe("decided");
    expect(decided.decision?.tags).toEqual(["Readability"]);
    expect(decided.decision?.edited?.files).toEqual([file?.path]);
    expect(after.headCommit).toBe(decided.decision?.edited?.commit);
    expect(after.chat.pendingNotices.at(-1)).toContain("edited it by hand");

    const content = await t.app.file(after, file?.path ?? "");
    expect(content.content).toBe(edited);
  });

  it("refuses edits to files outside the change", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 0, tradeoff: 0, bothFlawed: 0, control: 1 },
    });
    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    await expect(
      t.app.decide(session.id, lastRound(ready).id, {
        choice: "a",
        tags: [],
        note: "ok",
        edits: [{ path: "src/app.ts", content: "boom" }],
      }),
    ).rejects.toThrow(/not part of this change/);
  });

  it("requires a reason to reject both and leaves the code as it was", async () => {
    const session = await readySession(t.app);
    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    const round = lastRound(ready);
    await expect(
      t.app.decide(session.id, round.id, { choice: "reject", tags: [], note: " ", edits: [] }),
    ).rejects.toThrow(/Say what is wrong/);
    await t.app.decide(session.id, round.id, {
      choice: "reject",
      tags: [],
      note: "Both ignore the status filter.",
      edits: [],
    });
    const after = t.app.session(session.id);
    expect(after.headCommit).toBe(after.baseCommit);
    expect(after.chat.pendingNotices.at(-1)).toContain("Both ignore the status filter.");
  });

  it("requires a justification when configured to", async () => {
    const session = await readySession(t.app);
    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    await expect(
      t.app.decide(session.id, lastRound(ready).id, {
        choice: "a",
        tags: ["Simplicity"],
        note: "",
        edits: [],
      }),
    ).rejects.toThrow(/Explain why/);
  });

  it("only allows one open round at a time", async () => {
    const session = await readySession(t.app);
    t.app.generate(session.id, "Add pagination");
    expect(() => t.app.generate(session.id, "And filtering")).toThrow(/already being written/);
    await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    expect(() => t.app.generate(session.id, "And filtering")).toThrow(
      /Decide on the current versions/,
    );
  });

  it("produces two stances for a trade-off round", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 0, tradeoff: 1, bothFlawed: 0, control: 0 },
    });
    t.app.generate(session.id, "Add pagination");
    const done = await waitFor(t.app, session.id, (s) => lastRound(s).status !== "generating");
    const round = lastRound(done);
    expect(round.status).toBe("ready");
    expect(round.variants?.a.role).toBe("stance");
    expect(round.variants?.b.role).toBe("stance");
    expect(round.variants?.a.stance?.tradeoffId).toBe(round.variants?.b.stance?.tradeoffId);
    expect(round.variants?.a.stance?.label).not.toBe(round.variants?.b.stance?.label);
  });

  it("produces two flawed versions for a both-flawed round", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 0, tradeoff: 0, bothFlawed: 1, control: 0 },
    });
    t.app.generate(session.id, "Add pagination");
    const done = await waitFor(t.app, session.id, (s) => lastRound(s).status !== "generating");
    const round = lastRound(done);
    expect(round.status).toBe("ready");
    expect(round.variants?.a.role).toBe("degraded");
    expect(round.variants?.b.role).toBe("degraded");
    expect(round.variants?.a.degradation?.id).not.toBe(round.variants?.b.degradation?.id);
  });

  it("answers in chat and discards anything chat changed on disk", async () => {
    const session = await readySession(t.app);
    const repo = t.app.workspaces.paths(session.id).repo;
    await writeFile(path.join(repo, "scribble.txt"), "left behind by a chat turn");
    t.app.sendChat(session.id, "How is validation organised?");
    const done = await waitFor(t.app, session.id, (s) => !s.chat.busy);
    const reply = done.timeline.at(-1);
    expect(reply?.type === "message" && reply.status).toBe("done");
    expect(done.chat.agentSessionId).not.toBeNull();
    await expect(readFile(path.join(repo, "scribble.txt"), "utf8")).rejects.toThrow();
  });

  it("deletes a session that is still being set up", async () => {
    const created = await t.app.createSession(sampleConfig());
    await t.app.delete(created.id);
    expect(t.app.store.get(created.id)).toBeUndefined();
    await expect(stat(t.app.workspaces.paths(created.id).root)).rejects.toThrow();
  });

  it("writes a report that names what each version was", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    const round = lastRound(ready);
    const reference = round.variants?.a.role === "reference" ? "a" : "b";
    await t.app.decide(session.id, round.id, {
      choice: reference,
      tags: ["Simplicity"],
      note: "No class needed.",
      edits: [],
    });
    const report = buildReport(t.app.session(session.id));
    expect(report).toContain("Chose the reference");
    expect(report).toContain("> No class needed.");
    expect(report).toContain("**Talking points**");
  });
});

describe("with a scripted assistant", () => {
  it("gives a failing check one repair attempt", async () => {
    const harness = new ScriptedHarness(async (turn) => {
      const broken = path.join(turn.cwd, "test", "pagination.test.ts");
      if (turn.purpose === "reference") {
        await writeFile(
          broken,
          'import { test } from "node:test";\ntest("x", () => { throw new Error("no"); });\n',
        );
        return result();
      }
      if (turn.purpose === "repair") {
        await writeFile(broken, 'import { test } from "node:test";\ntest("x", () => {});\n');
        return result({ summary: "Fixed the test." });
      }
      await writeFile(path.join(turn.cwd, "extra.ts"), "export const x = 1;\n");
      return result({ degradation: "noise", summary: "s", locations: [], talking_points: [] });
    });
    t = await createTestApp({ extra: [harness] });
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    t.app.generate(session.id, "Add pagination");
    const done = await waitFor(
      t.app,
      session.id,
      (s) => lastRound(s).status !== "generating",
      60_000,
    );
    const round = lastRound(done);
    expect(round.status).toBe("ready");
    expect(round.runs.map((run) => run.purpose)).toEqual(["reference", "repair", "degrade"]);
    expect(round.variants?.a.check.status).toBe("passed");
    expect(round.variants?.b.check.status).toBe("passed");
  });

  it("fails the round with the assistant's words when nothing changed", async () => {
    const harness = new ScriptedHarness(async () => result(null, "Which page size do you want?"));
    t = await createTestApp({ extra: [harness] });
    const session = await readySession(t.app);
    t.app.generate(session.id, "Add pagination");
    const done = await waitFor(t.app, session.id, (s) => lastRound(s).status !== "generating");
    const round = lastRound(done);
    expect(round.status).toBe("failed");
    expect(round.error).toContain("Which page size do you want?");
  });

  it("cancels a round in progress", async () => {
    const harness = new ScriptedHarness(
      (turn) =>
        new Promise((_resolve, reject) => {
          turn.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    t = await createTestApp({ extra: [harness] });
    const session = await readySession(t.app);
    const round = t.app.generate(session.id, "Add pagination");
    await waitFor(t.app, session.id, (s) => lastRound(s).runs.length > 0);
    t.app.cancelRound(session.id, round.id);
    const done = await waitFor(t.app, session.id, (s) => lastRound(s).status !== "generating");
    expect(lastRound(done).status).toBe("cancelled");
    expect(lastRound(done).error).toBeNull();
  });

  it("survives deleting a session while a round and a chat turn are running", async () => {
    const harness = new ScriptedHarness(
      (turn) =>
        new Promise((_resolve, reject) => {
          turn.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    t = await createTestApp({ extra: [harness] });
    const session = await readySession(t.app);
    t.app.sendChat(session.id, "Hello?");
    t.app.generate(session.id, "Add pagination");
    await waitFor(t.app, session.id, (s) => lastRound(s).runs.length > 0);
    await t.app.delete(session.id);
    // Give the cancelled tasks time to finish their (now pointless) updates.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(t.app.store.get(session.id)).toBeUndefined();
  });

  it("gives the assistant the conversation and the request when implementing", async () => {
    const harness = new ScriptedHarness(async (turn) => {
      if (turn.mode === "chat")
        return {
          sessionId: "thread-1",
          text: "Use page and pageSize.",
          structured: null,
          costUsd: null,
        };
      await mkdir(path.join(turn.cwd, "lib"), { recursive: true });
      await writeFile(
        path.join(turn.cwd, "lib", `${turn.purpose}.ts`),
        `export const v = ${String(Math.random())};\n`,
      );
      return result({ degradation: "noise", summary: "ok", locations: [], talking_points: [] });
    });
    t = await createTestApp({ extra: [harness] });
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    t.app.sendChat(session.id, "What parameter names should we use?");
    await waitFor(t.app, session.id, (s) => !s.chat.busy);
    t.app.generate(session.id, "Add pagination with those names");
    await waitFor(t.app, session.id, (s) => lastRound(s).status !== "generating");
    const reference = harness.turns.find((turn) => turn.purpose === "reference");
    expect(reference?.prompt).toContain("What parameter names should we use?");
    expect(reference?.prompt).toContain("Use page and pageSize.");
    expect(reference?.prompt).toContain("<request>\nAdd pagination with those names\n</request>");
    expect(reference?.persist).toBe(false);
    const degrade = harness.turns.find((turn) => turn.purpose === "degrade");
    expect(degrade?.prompt).toContain("lib/reference.ts");
    await rm(t.dir, { recursive: true, force: true }).catch(() => undefined);
  });
});
