// Builds a real application over temporary directories, for integration tests.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MIX, type Session, type SessionConfigInput } from "../../shared/model.js";
import { Harnesses } from "../agents/index.js";
import type { Harness } from "../agents/types.js";
import { loadConfig, type Config } from "../config.js";
import { DEFAULT_DEGRADATIONS } from "../engine/catalogue.js";
import { Git } from "../git.js";
import { Runner } from "../process.js";
import { Twofold } from "../service.js";
import { SessionStore } from "../store.js";
import { Workspaces } from "../workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLES_DIR = path.resolve(here, "../../../samples");

export interface TestApp {
  app: Twofold;
  config: Config;
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestApp(
  options: { extra?: Harness[]; env?: Record<string, string> } = {},
): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), "twofold-test-"));
  const config = loadConfig({
    ...process.env,
    TWOFOLD_DATA_DIR: dir,
    TWOFOLD_SAMPLES_DIR: SAMPLES_DIR,
    TWOFOLD_REPOS_DIR: path.join(dir, "repos"),
    TWOFOLD_ENABLE_MOCK: "1",
    TWOFOLD_MOCK_DELAY_MS: "0",
    TWOFOLD_SANDBOX_UID: "",
    TWOFOLD_SANDBOX_GID: "",
    ...options.env,
  });
  const runner = new Runner(null, config.passthroughEnv);
  const store = new SessionStore(path.join(config.privateDir, "sessions"));
  await store.load();
  const app = new Twofold(
    config,
    store,
    new Workspaces(config, runner, new Git(runner)),
    new Harnesses(config, runner, options.extra ?? []),
  );
  return {
    app,
    config,
    dir,
    cleanup: async () => {
      await app.shutdown();
      await store.flush();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function sampleConfig(overrides: Partial<SessionConfigInput> = {}): SessionConfigInput {
  return {
    candidateName: "Ada",
    title: "Bookshelf",
    brief: "Add pagination to GET /books.",
    repo: { kind: "sample", name: "bookshelf" },
    harness: { kind: "mock" },
    commands: { check: "npm test --silent", timeoutSeconds: 120 },
    mix: DEFAULT_MIX,
    degradations: [...DEFAULT_DEGRADATIONS],
    ...overrides,
  };
}

/** Polls until `predicate` holds for the session, or fails after `timeoutMs`. */
export async function waitFor(
  app: Twofold,
  id: string,
  predicate: (session: Session) => boolean,
  timeoutMs = 20_000,
): Promise<Session> {
  const started = Date.now();
  for (;;) {
    const session = app.session(id);
    if (predicate(session)) return session;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting; status=${session.status} detail=${session.statusDetail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function readySession(
  app: Twofold,
  overrides: Partial<SessionConfigInput> = {},
): Promise<Session> {
  const created = await app.createSession(sampleConfig(overrides));
  const session = await waitFor(app, created.id, (s) => s.status !== "provisioning");
  if (session.status !== "ready") throw new Error(`provisioning failed: ${session.provisionLog}`);
  app.start(session.id);
  return session;
}

export function lastRound(session: Session) {
  const rounds = session.timeline.flatMap((item) => (item.type === "round" ? [item] : []));
  const round = rounds.at(-1);
  if (round === undefined) throw new Error("no rounds");
  return round;
}
