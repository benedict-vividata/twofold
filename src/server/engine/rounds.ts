import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import type {
  AgentRun,
  CheckResult,
  PairKind,
  PairMix,
  Round,
  RunPurpose,
  Session,
  Variant,
} from "../../shared/model.js";
import type { AgentResult, Harness, JsonSchema } from "../agents/types.js";
import { AgentError, describeFailure } from "../agents/types.js";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import type { SessionStore } from "../store.js";
import { ASSISTANT_IDENTITY, type Slot, type Workspaces } from "../workspace.js";
import { DEGRADATIONS, TRADEOFFS, type Degradation, type Tradeoff } from "./catalogue.js";
import {
  DEGRADE_SCHEMA,
  REFERENCE_SCHEMA,
  REPAIR_SCHEMA,
  STANCE_SCHEMA,
  degradeInstructions,
  degradePrompt,
  referenceInstructions,
  referencePrompt,
  repairInstructions,
  repairPrompt,
  stanceInstructions,
  stancePrompt,
} from "./prompts.js";

const MAX_ACTIVITY = 300;

/** A version that is committed and checked but not yet given a position. */
type Produced = Omit<Variant, "stats">;

/** The agent finished but left the code unchanged. */
class NoChangeError extends Error {
  constructor(readonly agentText: string) {
    super("The assistant did not change any files.");
    this.name = "NoChangeError";
  }
}

const SummaryReport = z.object({ summary: z.string() });
const StanceReport = z.object({ summary: z.string(), talking_points: z.array(z.string()) });
const DegradeReport = z.object({
  degradation: z.string(),
  summary: z.string(),
  locations: z.array(
    z.object({ file: z.string(), line: z.number().int().nullable().catch(null), note: z.string() }),
  ),
  talking_points: z.array(z.string()),
});

export function pickPairKind(mix: PairMix, random: (max: number) => number = randomInt): PairKind {
  const weights: [PairKind, number][] = [
    ["degraded", mix.degraded],
    ["tradeoff", mix.tradeoff],
    ["both-flawed", mix.bothFlawed],
    ["control", mix.control],
  ];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random(Math.max(total, 1));
  for (const [kind, weight] of weights) {
    if (roll < weight) return kind;
    roll -= weight;
  }
  return "degraded";
}

function shuffle<T>(items: readonly T[], random: (max: number) => number = randomInt): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    const current = copy[index];
    const swapped = copy[other];
    if (current === undefined || swapped === undefined) continue;
    copy[index] = swapped;
    copy[other] = current;
  }
  return copy;
}

/** The enabled flaws in random order, with ones used in recent rounds pushed to the back. */
export function degradationMenu(
  enabled: readonly string[],
  recent: readonly string[],
  random: (max: number) => number = randomInt,
): Degradation[] {
  const pool = DEGRADATIONS.filter((entry) => enabled.includes(entry.id));
  const shuffled = shuffle(pool.length > 0 ? pool : DEGRADATIONS, random);
  return [
    ...shuffled.filter((entry) => !recent.includes(entry.id)),
    ...shuffled.filter((entry) => recent.includes(entry.id)),
  ];
}

function recentDegradations(session: Session): string[] {
  const used: string[] = [];
  for (const item of session.timeline) {
    if (item.type !== "round" || item.variants === null) continue;
    for (const variant of [item.variants.a, item.variants.b]) {
      if (variant.degradation !== null) used.push(variant.degradation.id);
    }
  }
  return used.slice(-4);
}

function pickTradeoff(session: Session): Tradeoff {
  const used = new Set<string>();
  for (const item of session.timeline) {
    if (item.type !== "round" || item.variants === null) continue;
    const stance = item.variants.a.stance;
    if (stance !== null) used.add(stance.tradeoffId);
  }
  const fresh = TRADEOFFS.filter((entry) => !used.has(entry.id));
  const pool = fresh.length > 0 ? fresh : TRADEOFFS;
  return pool[randomInt(pool.length)] ?? TRADEOFFS[0] ?? fail("no trade-offs defined");
}

function fail(message: string): never {
  throw new Error(message);
}

function commitMessage(round: Round): string {
  const firstLine = round.request.split("\n")[0]?.trim() ?? "";
  const subject = firstLine.length > 64 ? `${firstLine.slice(0, 63)}…` : firstLine;
  return `${subject === "" ? `Round ${String(round.number)}` : subject}\n`;
}

interface RoundContext {
  sessionId: string;
  roundId: string;
  harness: Harness;
  signal: AbortSignal;
  base: string;
  request: string;
  message: string;
  date: string;
}

export class RoundEngine {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly config: Config,
    private readonly store: SessionStore,
    private readonly workspaces: Workspaces,
    private readonly harnessFor: (session: Session) => Harness,
  ) {}

  /** Records a new round and starts generating it in the background. */
  start(sessionId: string, request: string): Round {
    const session = this.store.get(sessionId) ?? fail("no session");
    const number = session.timeline.filter((item) => item.type === "round").length + 1;
    const round: Round = {
      type: "round",
      id: randomBytes(8).toString("hex"),
      number,
      request,
      createdAt: new Date().toISOString(),
      status: "generating",
      phase: "Starting",
      error: null,
      pairKind: pickPairKind(session.config.mix),
      baseCommit: session.headCommit ?? fail("session has no head commit"),
      variants: null,
      decision: null,
      runs: [],
    };
    this.store.update(sessionId, (draft) => {
      draft.timeline.push(round);
    });
    this.run(sessionId, round.id).catch((error: unknown) => {
      logger.error(`round ${round.id} crashed: ${String(error)}`);
    });
    return round;
  }

  cancel(roundId: string): boolean {
    const controller = this.controllers.get(roundId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  private round(session: Session, roundId: string): Round {
    const round = session.timeline.find((item) => item.type === "round" && item.id === roundId);
    if (round?.type !== "round") throw new Error(`no round ${roundId}`);
    return round;
  }

  private updateRound(ctx: RoundContext, mutate: (round: Round) => void): void {
    this.store.update(ctx.sessionId, (session) => {
      mutate(this.round(session, ctx.roundId));
    });
  }

  private setPhase(ctx: RoundContext, phase: string): void {
    this.updateRound(ctx, (round) => {
      round.phase = phase;
    });
  }

  private session(ctx: RoundContext): Session {
    return this.store.get(ctx.sessionId) ?? fail("session disappeared");
  }

  private async run(sessionId: string, roundId: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(roundId, controller);
    const session = this.store.get(sessionId) ?? fail("no session");
    const round = this.round(session, roundId);
    const ctx: RoundContext = {
      sessionId,
      roundId,
      harness: this.harnessFor(session),
      signal: controller.signal,
      base: round.baseCommit,
      request: round.request,
      message: commitMessage(round),
      date: round.createdAt,
    };

    try {
      const [first, second] = await this.produce(ctx, round.pairKind);
      const swap = randomInt(2) === 1;
      const [a, b] = swap ? [second, first] : [first, second];
      const repo = this.workspaces.paths(sessionId).repo;
      const [statsA, statsB] = await Promise.all([
        this.stats(repo, ctx.base, a.commit),
        this.stats(repo, ctx.base, b.commit),
      ]);
      await this.workspaces.git.updateRef(
        repo,
        `refs/twofold/rounds/${String(round.number)}/a`,
        a.commit,
      );
      await this.workspaces.git.updateRef(
        repo,
        `refs/twofold/rounds/${String(round.number)}/b`,
        b.commit,
      );
      this.updateRound(ctx, (draft) => {
        draft.variants = { a: { ...a, stats: statsA }, b: { ...b, stats: statsB } };
        draft.status = "ready";
        draft.phase = "Ready for review";
      });
    } catch (error) {
      const cancelled =
        controller.signal.aborted || (error instanceof AgentError && error.cancelled);
      if (!cancelled) logger.warn(`round ${roundId} failed: ${describeFailure(error)}`);
      this.updateRound(ctx, (draft) => {
        draft.status = cancelled ? "cancelled" : "failed";
        draft.phase = cancelled ? "Cancelled" : "Failed";
        draft.error = cancelled ? null : candidateMessage(error);
        for (const run of draft.runs) {
          if (run.status === "running") {
            run.status = cancelled ? "cancelled" : "failed";
            run.endedAt = new Date().toISOString();
          }
        }
      });
    } finally {
      this.controllers.delete(roundId);
    }
  }

  private async produce(ctx: RoundContext, kind: PairKind): Promise<[Produced, Produced]> {
    const session = this.session(ctx);
    switch (kind) {
      case "degraded": {
        this.setPhase(ctx, "Writing the change");
        const reference = await this.reference(ctx, "ref");
        this.setPhase(ctx, "Writing the second version");
        const menu = degradationMenu(session.config.degradations, recentDegradations(session));
        const degraded = await this.degraded(ctx, "x", reference, menu);
        return [reference, degraded];
      }
      case "both-flawed": {
        this.setPhase(ctx, "Writing the change");
        const reference = await this.reference(ctx, "ref");
        this.setPhase(ctx, "Writing two versions");
        const menu = degradationMenu(session.config.degradations, recentDegradations(session));
        // Interleave the menu so the two sides start from different flaws.
        const left = menu.filter((_, index) => index % 2 === 0);
        const right = menu.filter((_, index) => index % 2 === 1);
        return Promise.all([
          this.degraded(ctx, "x", reference, left),
          this.degraded(ctx, "y", reference, right.length > 0 ? right : left),
        ]);
      }
      case "tradeoff": {
        this.setPhase(ctx, "Writing two versions");
        const tradeoff = pickTradeoff(session);
        return Promise.all([
          this.stance(ctx, "x", tradeoff, "left"),
          this.stance(ctx, "y", tradeoff, "right"),
        ]);
      }
      case "control": {
        this.setPhase(ctx, "Writing the change");
        const reference = await this.reference(ctx, "ref");
        return [reference, reference];
      }
    }
  }

  private async stats(repo: string, base: string, commit: string): Promise<Variant["stats"]> {
    const files = await this.workspaces.git.changedFiles(repo, base, commit);
    return {
      files: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    };
  }

  /** Prepares a slot's worktree at `commit`. */
  private async tree(ctx: RoundContext, slot: Slot, commit: string): Promise<string> {
    const dir = await this.workspaces.ensureTree(this.session(ctx), slot, ctx.base);
    await this.workspaces.git.resetWorktree(dir, commit);
    return dir;
  }

  private async snapshot(
    ctx: RoundContext,
    dir: string,
  ): Promise<{ commit: string; tree: string }> {
    return this.workspaces.git.snapshot(dir, ctx.base, ctx.message, {
      ...ASSISTANT_IDENTITY,
      date: ctx.date,
    });
  }

  private async reference(ctx: RoundContext, slot: Slot): Promise<Produced> {
    const dir = await this.tree(ctx, slot, ctx.base);
    const session = this.session(ctx);
    const result = await this.agent(ctx, {
      purpose: "reference",
      label: "Reference implementation",
      cwd: dir,
      instructions: referenceInstructions(session),
      prompt: referencePrompt(session, ctx.request),
      schema: REFERENCE_SCHEMA,
    });
    const snap = await this.snapshot(ctx, dir);
    const baseTree = await this.workspaces.git.treeOf(dir, ctx.base);
    if (snap.tree === baseTree) throw new NoChangeError(result.text);
    const report = SummaryReport.safeParse(result.structured);
    const checked = await this.checkWithRepair(ctx, dir, snap.commit, null);
    return {
      commit: checked.commit,
      role: "reference",
      summary: report.success ? report.data.summary : result.text,
      degradation: null,
      stance: null,
      check: checked.check,
    };
  }

  private async stance(
    ctx: RoundContext,
    slot: Slot,
    tradeoff: Tradeoff,
    side: "left" | "right",
  ): Promise<Produced> {
    const dir = await this.tree(ctx, slot, ctx.base);
    const session = this.session(ctx);
    const label = side === "left" ? tradeoff.left : tradeoff.right;
    const result = await this.agent(ctx, {
      purpose: "stance",
      label: `${label} (${tradeoff.name})`,
      cwd: dir,
      instructions: stanceInstructions(session, tradeoff, side),
      prompt: stancePrompt(session, ctx.request, side),
      schema: STANCE_SCHEMA,
    });
    const snap = await this.snapshot(ctx, dir);
    const baseTree = await this.workspaces.git.treeOf(dir, ctx.base);
    if (snap.tree === baseTree) throw new NoChangeError(result.text);
    const report = StanceReport.safeParse(result.structured);
    const checked = await this.checkWithRepair(ctx, dir, snap.commit, null);
    return {
      commit: checked.commit,
      role: "stance",
      summary: report.success ? report.data.summary : result.text,
      degradation: null,
      stance: {
        tradeoffId: tradeoff.id,
        label,
        summary: report.success ? report.data.summary : "",
        talkingPoints: report.success ? report.data.talking_points : [],
      },
      check: checked.check,
    };
  }

  private async degraded(
    ctx: RoundContext,
    slot: Slot,
    from: Produced,
    menu: readonly Degradation[],
  ): Promise<Produced> {
    const session = this.session(ctx);
    const repo = this.workspaces.paths(ctx.sessionId).repo;
    const diff = await this.workspaces.git.diff(repo, ctx.base, from.commit);
    const fromTree = await this.workspaces.git.treeOf(repo, from.commit);

    // A second try, with the menu rotated, if the first leaves the code as it was.
    const attempts = [menu, [...menu.slice(1), ...menu.slice(0, 1)]];
    for (const [attempt, options] of attempts.entries()) {
      const dir = await this.tree(ctx, slot, from.commit);
      const result = await this.agent(ctx, {
        purpose: "degrade",
        label: attempt === 0 ? "Alternative version" : "Alternative version (retry)",
        cwd: dir,
        instructions: degradeInstructions(session, options),
        prompt: degradePrompt(session, ctx.request, diff),
        schema: DEGRADE_SCHEMA,
      });
      const snap = await this.snapshot(ctx, dir);
      if (snap.tree === fromTree) continue;

      const report = DegradeReport.safeParse(result.structured);
      const chosen =
        (report.success
          ? options.find((entry) => entry.id === report.data.degradation)
          : undefined) ??
        options[0] ??
        fail("empty degradation menu");
      const summary = report.success ? report.data.summary : "";
      const checked = await this.checkWithRepair(
        ctx,
        dir,
        snap.commit,
        summary === "" ? chosen.name : summary,
      );
      return {
        commit: checked.commit,
        role: "degraded",
        summary: from.summary,
        degradation: {
          id: chosen.id,
          name: chosen.name,
          summary,
          locations: report.success ? report.data.locations : [],
          talkingPoints: report.success ? report.data.talking_points : [],
        },
        stance: null,
        check: checked.check,
      };
    }
    throw new NoChangeError("");
  }

  /**
   * Runs the check, and if it fails (and the starting code passed), gives the
   * agent one chance to fix it. `preserve` describes a deliberate flaw the fix
   * must keep.
   */
  private async checkWithRepair(
    ctx: RoundContext,
    dir: string,
    commit: string,
    preserve: string | null,
  ): Promise<{ commit: string; check: CheckResult }> {
    const session = this.session(ctx);
    const command = session.config.commands.check.trim();
    if (command === "")
      return { commit, check: await this.workspaces.check(session, dir, ctx.signal) };

    this.setPhase(ctx, "Running checks");
    const first = await this.workspaces.check(session, dir, ctx.signal);
    if (ctx.signal.aborted) throw new AgentError("Cancelled", "", true);
    if (first.status !== "failed" || session.baseline?.status === "failed")
      return { commit, check: first };

    this.setPhase(ctx, "Fixing a failing check");
    await this.agent(ctx, {
      purpose: "repair",
      label: preserve === null ? "Fix failing check" : "Fix failing check (alternative)",
      cwd: dir,
      instructions: repairInstructions(preserve),
      prompt: repairPrompt(command, first.output),
      schema: REPAIR_SCHEMA,
    });
    const snap = await this.snapshot(ctx, dir);
    this.setPhase(ctx, "Running checks");
    const second = await this.workspaces.check(session, dir, ctx.signal);
    return { commit: snap.commit, check: second };
  }

  private async agent(
    ctx: RoundContext,
    spec: {
      purpose: RunPurpose;
      label: string;
      cwd: string;
      instructions: string;
      prompt: string;
      schema: JsonSchema;
    },
  ): Promise<AgentResult> {
    const session = this.session(ctx);
    const run: AgentRun = {
      id: randomBytes(6).toString("hex"),
      purpose: spec.purpose,
      label: spec.label,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "running",
      activity: [],
      finalText: "",
      error: null,
      costUsd: null,
    };
    this.updateRound(ctx, (round) => {
      round.runs.push(run);
    });
    const updateRun = (mutate: (draft: AgentRun) => void): void => {
      this.updateRound(ctx, (round) => {
        const draft = round.runs.find((candidate) => candidate.id === run.id);
        if (draft !== undefined) mutate(draft);
      });
    };

    try {
      const result = await ctx.harness.run({
        purpose: spec.purpose,
        cwd: spec.cwd,
        prompt: spec.prompt,
        instructions: spec.instructions,
        mode: "write",
        resume: null,
        persist: false,
        outputSchema: spec.schema,
        scratchDir: this.workspaces.paths(ctx.sessionId).scratch,
        model: session.config.harness.model,
        effort: session.config.harness.effort,
        signal: ctx.signal,
        timeoutMs: this.config.agentTimeoutMs,
        onEvent: (event) => {
          if (event.type !== "activity") return;
          updateRun((draft) => {
            draft.activity.push(event.activity);
            if (draft.activity.length > MAX_ACTIVITY)
              draft.activity.splice(0, draft.activity.length - MAX_ACTIVITY);
          });
        },
      });
      updateRun((draft) => {
        draft.status = "done";
        draft.endedAt = new Date().toISOString();
        draft.finalText =
          result.structured === null ? result.text : JSON.stringify(result.structured, null, 2);
        draft.costUsd = result.costUsd;
      });
      return result;
    } catch (error) {
      const cancelled = error instanceof AgentError && error.cancelled;
      updateRun((draft) => {
        draft.status = cancelled ? "cancelled" : "failed";
        draft.endedAt = new Date().toISOString();
        draft.error =
          error instanceof AgentError ? `${error.message}\n${error.detail}`.trim() : String(error);
      });
      throw error;
    }
  }
}

/**
 * What the candidate is told when a round fails. Deliberately says nothing
 * about which version failed; the interviewer sees the details in the runs.
 */
function candidateMessage(error: unknown): string {
  if (error instanceof NoChangeError) {
    const said = error.agentText.trim();
    return said === ""
      ? "The assistant didn't produce two distinct versions. Try again, or rephrase the request."
      : `The assistant didn't change any files. It said:\n\n${said}`;
  }
  if (error instanceof AgentError) return error.message;
  return "Something went wrong while generating the versions. Try again.";
}
