import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Session } from "../shared/model.js";
import { logger } from "./logger.js";

type Listener = (session: Session) => void;

const PERSIST_DELAY_MS = 250;
const NOTIFY_DELAY_MS = 60;
const ID_PATTERN = /^[a-z0-9]{6,40}$/;

/**
 * Sessions live in memory and are mirrored to one JSON file each in the
 * private directory. Mutations are synchronous (JavaScript runs them one at a
 * time), and both the disk write and subscriber notification are coalesced.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly globalListeners = new Set<(id: string, session: Session | null) => void>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();
  private readonly notifyTimers = new Map<string, NodeJS.Timeout>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid session id '${id}'`);
    return path.join(this.dir, `${id}.json`);
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.dir)).filter((name) => name.endsWith(".json"));
    for (const name of names) {
      try {
        const parsed = Session.safeParse(
          JSON.parse(await readFile(path.join(this.dir, name), "utf8")),
        );
        if (!parsed.success) {
          logger.warn(`skipping unreadable session file ${name}: ${parsed.error.message}`);
          continue;
        }
        const session = parsed.data;
        if (recoverInterrupted(session)) this.schedulePersist(session.id);
        this.sessions.set(session.id, session);
      } catch (error) {
        logger.warn(`skipping session file ${name}: ${String(error)}`);
      }
    }
    logger.info(`loaded ${String(this.sessions.size)} session(s)`);
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  findByToken(token: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.candidateToken === token) return session;
    }
    return undefined;
  }

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    await this.persistNow(session.id);
  }

  /**
   * Applies a synchronous mutation and schedules persistence and notification.
   * A session deleted while work for it was still in flight is simply gone:
   * late updates are dropped rather than thrown from background tasks.
   */
  update(id: string, mutate: (session: Session) => void): Session | undefined {
    const session = this.sessions.get(id);
    if (session === undefined) return undefined;
    mutate(session);
    session.updatedAt = new Date().toISOString();
    this.schedulePersist(id);
    this.scheduleNotify(id);
    return session;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
    this.emitGlobal(id, null);
    clearTimeout(this.persistTimers.get(id));
    this.persistTimers.delete(id);
    await this.enqueueWrite(async () => {
      await rm(this.file(id), { force: true });
    });
  }

  /** Every change to every session; `null` when a session is deleted. */
  subscribeAll(listener: (id: string, session: Session | null) => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private emitGlobal(id: string, session: Session | null): void {
    for (const listener of this.globalListeners) {
      try {
        listener(id, session);
      } catch (error) {
        logger.warn(`session listener failed: ${String(error)}`);
      }
    }
  }

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  async flush(): Promise<void> {
    const pending = [...this.persistTimers.keys()];
    for (const id of pending) {
      clearTimeout(this.persistTimers.get(id));
      this.persistTimers.delete(id);
      await this.persistNow(id);
    }
    await this.writeChain;
  }

  private scheduleNotify(id: string): void {
    if (this.notifyTimers.has(id)) return;
    this.notifyTimers.set(
      id,
      setTimeout(() => {
        this.notifyTimers.delete(id);
        const session = this.sessions.get(id);
        if (session === undefined) return;
        this.emitGlobal(id, session);
        for (const listener of this.listeners.get(id) ?? []) {
          try {
            listener(session);
          } catch (error) {
            logger.warn(`session listener failed: ${String(error)}`);
          }
        }
      }, NOTIFY_DELAY_MS),
    );
  }

  private schedulePersist(id: string): void {
    if (this.persistTimers.has(id)) return;
    this.persistTimers.set(
      id,
      setTimeout(() => {
        this.persistTimers.delete(id);
        void this.persistNow(id);
      }, PERSIST_DELAY_MS),
    );
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task).catch((error: unknown) => {
      logger.error(`failed to write session state: ${String(error)}`);
    });
    this.writeChain = next;
    return next;
  }

  private persistNow(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const session = this.sessions.get(id);
      if (session === undefined) return;
      const target = this.file(id);
      const temporary = `${target}.tmp`;
      await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
      await rename(temporary, target);
    });
  }
}

/**
 * A restart kills every agent process, so anything that was in flight is now
 * stale. Returns whether anything changed.
 */
export function recoverInterrupted(session: Session): boolean {
  let changed = false;
  const interrupted = "Interrupted by a server restart.";
  if (session.status === "provisioning") {
    session.status = "failed";
    session.statusDetail = interrupted;
    changed = true;
  }
  if (session.chat.busy) {
    session.chat.busy = false;
    changed = true;
  }
  for (const item of session.timeline) {
    if (item.type === "message" && item.status === "streaming") {
      item.status = "error";
      item.error = interrupted;
      changed = true;
    }
    if (item.type === "round" && item.status === "generating") {
      item.status = "failed";
      item.error = interrupted;
      item.phase = "Interrupted";
      for (const run of item.runs) {
        if (run.status === "running") {
          run.status = "cancelled";
          run.endedAt = new Date().toISOString();
        }
      }
      changed = true;
    }
  }
  return changed;
}
