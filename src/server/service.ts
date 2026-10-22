import { randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  JUSTIFICATION_TAGS,
  SAMPLE_REPOS,
  SessionConfig,
  type DecisionRequest,
  type Environment,
  type FileContent,
  type Position,
  type Round,
  type Session,
  type TreeListing,
  type VariantFiles,
} from "../shared/model.js";
import { Harnesses } from "./agents/index.js";
import type { Harness } from "./agents/types.js";
import type { Config } from "./config.js";
import { ChatEngine } from "./engine/chat.js";
import { DEGRADATIONS, degradationInfo, tradeoffInfo } from "./engine/catalogue.js";
import { RoundEngine } from "./engine/rounds.js";
import { safeRepoPath } from "./git.js";
import { logger } from "./logger.js";
import type { SessionStore } from "./store.js";
import { CANDIDATE_IDENTITY, ProvisionError, type Workspaces } from "./workspace.js";

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 500 | 503,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const SampleMeta = z.object({ title: z.string(), brief: z.string(), check: z.string() });

const MAX_CACHED_DIFFS = 200;

/**
 * The application: session lifecycle, the candidate's actions, and the data
 * the two UIs read. HTTP handlers stay thin and call into this.
 */
export class Twofold {
  readonly rounds: RoundEngine;
  readonly chat: ChatEngine;
  private readonly diffCache = new Map<string, VariantFiles>();
  private readonly provisioning = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();

  constructor(
    readonly config: Config,
    readonly store: SessionStore,
    readonly workspaces: Workspaces,
    readonly harnesses: Harnesses,
  ) {
    const harnessFor = (session: Session): Harness => {
      const harness = harnesses.get(session.config.harness.kind);
      if (harness === undefined)
        throw new HttpError(503, `${session.config.harness.kind} is not available`);
      return harness;
    };
    this.rounds = new RoundEngine(config, store, workspaces, harnessFor);
    this.chat = new ChatEngine(config, store, workspaces, harnessFor);
  }

  /** Stops everything in flight and waits for set-ups to wind down. */
  async shutdown(): Promise<void> {
    this.rounds.cancelAll();
    this.chat.cancelAll();
    const pending = [...this.provisioning.values()];
    for (const entry of pending) entry.controller.abort();
    await Promise.all(pending.map((entry) => entry.done));
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  session(id: string): Session {
    const session = this.store.get(id);
    if (session === undefined) throw new HttpError(404, "No such session");
    return session;
  }

  sessionByToken(token: string): Session {
    const session = this.store.findByToken(token);
    if (session === undefined) throw new HttpError(404, "This link is not valid");
    return session;
  }

  private round(session: Session, roundId: string): Round {
    const round = session.timeline.find((item) => item.type === "round" && item.id === roundId);
    if (round?.type !== "round") throw new HttpError(404, "No such round");
    return round;
  }

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  async environment(forceStatus = false): Promise<Environment> {
    const [harnesses, samples, localRepos] = await Promise.all([
      this.harnesses.status(forceStatus),
      this.samples(),
      this.localRepos(),
    ]);
    return {
      version: this.config.version,
      harnesses,
      degradations: degradationInfo(),
      tradeoffs: tradeoffInfo(),
      samples,
      localRepos,
      justificationTags: [...JUSTIFICATION_TAGS],
    };
  }

  private async samples(): Promise<Environment["samples"]> {
    const samples: Environment["samples"] = [];
    for (const name of SAMPLE_REPOS) {
      try {
        const raw: unknown = JSON.parse(
          await readFile(path.join(this.config.samplesDir, `${name}.json`), "utf8"),
        );
        samples.push({ name, ...SampleMeta.parse(raw) });
      } catch (error) {
        logger.warn(`sample ${name} is unavailable: ${String(error)}`);
      }
    }
    return samples;
  }

  private async localRepos(): Promise<string[]> {
    const entries = await readdir(this.config.reposDir, { withFileTypes: true }).catch(() => []);
    const repos: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const gitDir = await stat(path.join(this.config.reposDir, entry.name, ".git")).catch(
        () => null,
      );
      if (gitDir !== null) repos.push(entry.name);
    }
    return repos.sort();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async createSession(input: unknown): Promise<Session> {
    const parsed = SessionConfig.safeParse(input);
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
    const config = parsed.data;
    if (this.harnesses.get(config.harness.kind) === undefined) {
      throw new HttpError(
        400,
        `The ${config.harness.kind} assistant is not available on this server`,
      );
    }
    const known = new Set(DEGRADATIONS.map((entry) => entry.id));
    config.degradations = config.degradations.filter((id) => known.has(id));
    if (config.degradations.length === 0)
      throw new HttpError(400, "Enable at least one kind of flaw");

    const now = new Date().toISOString();
    const session: Session = {
      id: randomBytes(8).toString("hex"),
      createdAt: now,
      updatedAt: now,
      candidateToken: randomBytes(24).toString("base64url"),
      config,
      status: "provisioning",
      statusDetail: "Queued",
      provisionLog: "",
      baseCommit: null,
      headCommit: null,
      baseline: null,
      startedAt: null,
      finishedAt: null,
      chat: { busy: false, agentSessionId: null, pendingNotices: [] },
      timeline: [],
    };
    await this.store.create(session);
    const controller = new AbortController();
    const done = this.provision(session.id, controller.signal).finally(() => {
      this.provisioning.delete(session.id);
    });
    this.provisioning.set(session.id, { controller, done });
    return session;
  }

  private async provision(id: string, signal: AbortSignal): Promise<void> {
    const log = (line: string): void => {
      this.store.update(id, (draft) => {
        draft.statusDetail = line.split("\n")[0] ?? line;
        draft.provisionLog = `${draft.provisionLog}${line}\n`.slice(-64 * 1024);
      });
    };
    try {
      const session = this.session(id);
      const interrupted = (): void => {
        if (signal.aborted) throw new ProvisionError("Set-up was interrupted.");
      };
      const base = await this.workspaces.provision(session, log, signal);
      interrupted();
      log(`Starting point: ${base.slice(0, 12)}`);
      const repo = this.workspaces.paths(id).repo;

      const setup = session.config.commands.setup.trim();
      if (setup !== "") {
        log(`Running setup: ${setup}`);
        const result = await this.workspaces.runCommand(session, repo, setup, signal);
        log(result.output.trim());
        interrupted();
        if (result.status !== "passed") {
          throw new ProvisionError("The setup command failed; see the log.");
        }
      }

      let baseline = null;
      if (session.config.commands.check.trim() !== "") {
        log(`Running checks on the starting code: ${session.config.commands.check.trim()}`);
        baseline = await this.workspaces.check(session, repo, signal);
        interrupted();
        log(`Checks ${baseline.status} on the starting code.`);
      }

      this.store.update(id, (draft) => {
        draft.baseCommit = base;
        draft.headCommit = base;
        draft.baseline = baseline;
        draft.status = "ready";
        draft.statusDetail =
          baseline?.status === "failed"
            ? "Ready — but the checks fail on the starting code, so failing checks will not be repaired"
            : "Ready";
      });
      logger.info(`session ${id} is ready`);
    } catch (error) {
      const message = signal.aborted
        ? "Set-up was interrupted."
        : error instanceof Error
          ? error.message
          : String(error);
      logger.warn(`session ${id} failed to provision: ${message}`);
      if (this.store.get(id) === undefined) return;
      this.store.update(id, (draft) => {
        draft.status = "failed";
        draft.statusDetail = message.split("\n")[0] ?? message;
        draft.provisionLog = `${draft.provisionLog}${message}\n`;
      });
    }
  }

  start(id: string): void {
    const session = this.session(id);
    if (session.status === "active") return;
    if (session.status !== "ready") throw new HttpError(409, "This session is not ready to start");
    this.store.update(id, (draft) => {
      draft.status = "active";
      draft.startedAt = new Date().toISOString();
    });
  }

  finish(id: string): void {
    const session = this.session(id);
    if (session.status === "finished") return;
    if (session.status !== "active" && session.status !== "ready") {
      throw new HttpError(409, "This session cannot be finished now");
    }
    for (const item of session.timeline) {
      if (item.type === "round" && item.status === "generating") this.rounds.cancel(item.id);
    }
    this.chat.cancel(id);
    this.store.update(id, (draft) => {
      draft.status = "finished";
      draft.finishedAt = new Date().toISOString();
    });
  }

  async delete(id: string): Promise<void> {
    const session = this.session(id);
    const setup = this.provisioning.get(id);
    if (setup !== undefined) {
      setup.controller.abort();
      await setup.done;
    }
    for (const item of session.timeline) {
      if (item.type === "round") this.rounds.cancel(item.id);
    }
    this.chat.cancel(id);
    await this.store.delete(id);
    await this.workspaces.remove(id);
  }

  // -------------------------------------------------------------------------
  // The candidate's actions
  // -------------------------------------------------------------------------

  private requireActive(session: Session): void {
    if (session.status !== "active") {
      throw new HttpError(
        409,
        session.status === "finished" ? "This session has finished" : "Start the session first",
      );
    }
  }

  private openRound(session: Session): Round | undefined {
    for (const item of session.timeline) {
      if (item.type === "round" && (item.status === "generating" || item.status === "ready"))
        return item;
    }
    return undefined;
  }

  sendChat(id: string, text: string): void {
    const session = this.session(id);
    this.requireActive(session);
    if (session.chat.busy) throw new HttpError(409, "The assistant is still answering");
    this.chat.send(id, text);
  }

  stopChat(id: string): void {
    this.chat.cancel(id);
  }

  generate(id: string, request: string): Round {
    const session = this.session(id);
    this.requireActive(session);
    const open = this.openRound(session);
    if (open?.status === "generating")
      throw new HttpError(409, "Two versions are already being written");
    if (open?.status === "ready") throw new HttpError(409, "Decide on the current versions first");
    return this.rounds.start(id, request);
  }

  cancelRound(id: string, roundId: string): void {
    const session = this.session(id);
    const round = this.round(session, roundId);
    if (round.status !== "generating") throw new HttpError(409, "That round is not generating");
    this.rounds.cancel(roundId);
  }

  async decide(id: string, roundId: string, request: DecisionRequest): Promise<void> {
    const session = this.session(id);
    this.requireActive(session);
    const round = this.round(session, roundId);
    if (round.status !== "ready" || round.variants === null) {
      throw new HttpError(409, "There is nothing to decide on in this round");
    }
    const note = request.note.trim();
    if (request.choice === "reject" && note === "") {
      throw new HttpError(400, "Say what is wrong with both versions");
    }
    if (request.choice !== "reject" && session.config.requireNote && note === "") {
      throw new HttpError(400, "Explain why you chose this version");
    }

    let head: string | null = null;
    let edited: { commit: string; files: string[] } | null = null;
    if (request.choice !== "reject") {
      const variant = round.variants[request.choice];
      head = variant.commit;
      if (request.edits.length > 0) {
        edited = await this.applyEdits(session, round, request.choice, request.edits);
        if (edited !== null) head = edited.commit;
      }
    } else if (request.edits.length > 0) {
      throw new HttpError(400, "Edits can only be made to a version you accept");
    }

    const notice =
      request.choice === "reject"
        ? `The engineer rejected both generated versions of “${round.request}”. Their reason: “${note}”. The code is unchanged.`
        : `The engineer accepted a version of “${round.request}”${edited === null ? "" : " and edited it by hand"}. The working tree now includes it.`;

    this.store.update(id, (draft) => {
      const target = this.round(draft, roundId);
      target.decision = {
        choice: request.choice,
        tags: [...new Set(request.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))],
        note,
        edited,
        decidedAt: new Date().toISOString(),
      };
      target.status = "decided";
      target.phase = "Decided";
      if (head !== null) draft.headCommit = head;
      draft.chat.pendingNotices.push(notice);
    });
  }

  /** Commits the candidate's hand edits on top of the chosen version. */
  private async applyEdits(
    session: Session,
    round: Round,
    position: Position,
    edits: DecisionRequest["edits"],
  ): Promise<{ commit: string; files: string[] } | null> {
    const variants = round.variants;
    if (variants === null) return null;
    const files = await this.variantFiles(session, round.id, position);
    const editable = new Map<string, string>();
    for (const file of files.files) {
      if (file.after !== null && file.status !== "deleted") editable.set(file.path, file.after);
    }

    const changes: { path: string; content: string }[] = [];
    for (const edit of edits) {
      const original = editable.get(safeRepoPath(edit.path));
      if (original === undefined)
        throw new HttpError(400, `${edit.path} is not part of this change`);
      // The editor works in LF; keep a CRLF file CRLF.
      const content = original.includes("\r\n")
        ? edit.content.replace(/\r?\n/g, "\r\n")
        : edit.content;
      if (content !== original) changes.push({ path: edit.path, content });
    }
    if (changes.length === 0) return null;

    const repo = this.workspaces.paths(session.id).repo;
    const commit = await this.workspaces.git.commitEdits(
      repo,
      variants[position].commit,
      changes,
      "Hand edits before accepting\n",
      { ...CANDIDATE_IDENTITY, date: new Date().toISOString() },
    );
    return { commit, files: changes.map((change) => change.path) };
  }

  // -------------------------------------------------------------------------
  // Reading code
  // -------------------------------------------------------------------------

  async variantFiles(session: Session, roundId: string, position: Position): Promise<VariantFiles> {
    const round = this.round(session, roundId);
    if (round.variants === null || (round.status !== "ready" && round.status !== "decided")) {
      throw new HttpError(409, "This round has no versions to show yet");
    }
    const base = round.baseCommit;
    const commit = round.variants[position].commit;
    const key = `${session.id}:${base}..${commit}`;
    const cached = this.diffCache.get(key);
    if (cached !== undefined) return cached;

    const repo = this.workspaces.paths(session.id).repo;
    const git = this.workspaces.git;
    const changed = await git.changedFiles(repo, base, commit);
    const files = await Promise.all(
      changed.map(async (file) => {
        if (file.binary) return { ...file, tooLarge: false, before: null, after: null };
        const [before, after] = await Promise.all([
          file.status === "added" ? null : git.blob(repo, base, file.oldPath ?? file.path),
          file.status === "deleted" ? null : git.blob(repo, commit, file.path),
        ]);
        const binary = before?.binary === true || after?.binary === true;
        const tooLarge = before?.tooLarge === true || after?.tooLarge === true;
        return {
          ...file,
          binary,
          tooLarge,
          before: binary || tooLarge ? null : (before?.content ?? null),
          after: binary || tooLarge ? null : (after?.content ?? null),
        };
      }),
    );
    const result: VariantFiles = { files };
    this.diffCache.set(key, result);
    if (this.diffCache.size > MAX_CACHED_DIFFS) {
      const oldest = this.diffCache.keys().next().value;
      if (oldest !== undefined) this.diffCache.delete(oldest);
    }
    return result;
  }

  private head(session: Session): string {
    if (session.headCommit === null)
      throw new HttpError(409, "The repository is still being prepared");
    return session.headCommit;
  }

  /** The commit to browse: the merged code, or one of the versions awaiting a decision. */
  private browseTarget(
    session: Session,
    version: Position | null,
  ): { commit: string; round: Round | null } {
    if (version === null) return { commit: this.head(session), round: null };
    const round = this.openRound(session);
    if (round?.status !== "ready" || round.variants === null) {
      throw new HttpError(409, "There are no versions waiting for a decision");
    }
    return { commit: round.variants[version].commit, round };
  }

  async tree(session: Session, dir: string, version: Position | null = null): Promise<TreeListing> {
    const safe = validPath(dir);
    const repo = this.workspaces.paths(session.id).repo;
    const { commit, round } = this.browseTarget(session, version);
    const entries = await this.workspaces.git.lsTree(repo, commit, safe);
    if (round === null || version === null) return { entries };

    const changed = (await this.variantFiles(session, round.id, version)).files;
    return {
      entries: entries.map((entry) => {
        if (entry.type === "dir") {
          const inside = changed.some((file) => file.path.startsWith(`${entry.path}/`));
          return { ...entry, change: inside ? "contains" : null };
        }
        const file = changed.find((candidate) => candidate.path === entry.path);
        if (file === undefined || file.status === "deleted") return entry;
        return {
          ...entry,
          change:
            file.status === "added" ? "added" : file.status === "renamed" ? "renamed" : "modified",
        };
      }),
    };
  }

  async file(
    session: Session,
    filePath: string,
    version: Position | null = null,
  ): Promise<FileContent> {
    const safe = validPath(filePath);
    if (safe === "") throw new HttpError(400, "Invalid path");
    const repo = this.workspaces.paths(session.id).repo;
    const { commit, round } = this.browseTarget(session, version);
    let blob;
    try {
      blob = await this.workspaces.git.blob(repo, commit, safe);
    } catch (_error) {
      throw new HttpError(404, "No such file");
    }
    if (round === null || version === null) return { path: safe, ...blob, changes: null };

    const changed = (await this.variantFiles(session, round.id, version)).files.find(
      (file) => file.path === safe,
    );
    const changes =
      changed === undefined
        ? []
        : await this.workspaces.git.lineChanges(repo, round.baseCommit, commit, [
            ...(changed.oldPath === null ? [] : [changed.oldPath]),
            safe,
          ]);
    return { path: safe, ...blob, changes };
  }
}

function validPath(raw: string): string {
  try {
    return safeRepoPath(raw);
  } catch (_error) {
    throw new HttpError(400, "Invalid path");
  }
}
