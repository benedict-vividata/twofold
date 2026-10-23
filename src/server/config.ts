import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SandboxIdentity {
  uid: number;
  gid: number;
  home: string;
}

export interface Config {
  version: string;
  host: string;
  port: number;
  /** Used for candidate links when set; otherwise links follow the request's origin. */
  publicUrl: string | null;
  /** Interviewer-only state: sessions with their hidden labels, the admin token. */
  privateDir: string;
  /** Repositories and worktrees. Readable and writable by the sandbox user. */
  workDir: string;
  samplesDir: string;
  reposDir: string;
  staticDir: string | null;
  adminToken: string | null;
  /**
   * When set, every process that touches a workspace (agents, git, setup and
   * check commands) runs as this user instead of the server's own. The
   * container uses it so an agent cannot read the private directory.
   */
  sandbox: SandboxIdentity | null;
  /**
   * The candidate's terminal runs as this user: one that can read neither the
   * private directory nor the agents' workspaces.
   */
  terminalUser: SandboxIdentity | null;
  terminalsDir: string;
  /**
   * The ports the previews of the merged code, version A and version B listen
   * on: one origin each, so apps can use absolute paths. Port 0 picks any.
   */
  previewPorts: [number, number, number];
  /** Public base URLs for those, when they differ from this host on those ports (e.g. behind a tunnel). */
  previewUrls: [string, string, string] | null;
  /** Environment variable names passed through to sandboxed processes. */
  passthroughEnv: string[];
  enableMock: boolean;
  mockDelayMs: number;
  agentTimeoutMs: number;
  claudeBin: string;
  codexBin: string;
}

const DEFAULT_PASSTHROUGH = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "DISABLE_AUTOUPDATER",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "UV_CACHE_DIR",
  "npm_config_cache",
];

const here = path.dirname(fileURLToPath(import.meta.url));
// `here` is src/server in development and dist/ when bundled.
const projectRoot =
  path.basename(here) === "dist" ? path.dirname(here) : path.resolve(here, "../..");

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer, got '${raw}'`);
  return value;
}

function flagFromEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function listFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: string[]): string[] {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Exactly three values: for the merged code, version A and version B. */
function three<T>(values: T[], name: string): [T, T, T] {
  const [merged, a, b] = values;
  if (values.length !== 3 || merged === undefined || a === undefined || b === undefined) {
    throw new Error(`${name} needs three comma-separated values (merged, A, B)`);
  }
  return [merged, a, b];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.TWOFOLD_DATA_DIR ?? path.join(projectRoot, ".twofold-data"));
  const uid = nonEmpty(env.TWOFOLD_SANDBOX_UID);
  const gid = nonEmpty(env.TWOFOLD_SANDBOX_GID);
  const sandbox: SandboxIdentity | null =
    uid !== null && gid !== null
      ? {
          uid: intFromEnv(env, "TWOFOLD_SANDBOX_UID", 0),
          gid: intFromEnv(env, "TWOFOLD_SANDBOX_GID", 0),
          home: env.TWOFOLD_SANDBOX_HOME ?? "/home/agent",
        }
      : null;

  const terminalUid = nonEmpty(env.TWOFOLD_TERMINAL_UID);
  const terminalGid = nonEmpty(env.TWOFOLD_TERMINAL_GID);
  const terminalUser: SandboxIdentity | null =
    terminalUid !== null && terminalGid !== null
      ? {
          uid: intFromEnv(env, "TWOFOLD_TERMINAL_UID", 0),
          gid: intFromEnv(env, "TWOFOLD_TERMINAL_GID", 0),
          home: env.TWOFOLD_TERMINAL_HOME ?? "/home/candidate",
        }
      : null;

  const previewPorts = listFromEnv(env, "TWOFOLD_PREVIEW_PORTS", ["7778", "7779", "7780"]).map(
    (raw) => {
      const value = Number.parseInt(raw, 10);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(`TWOFOLD_PREVIEW_PORTS has an invalid port '${raw}'`);
      }
      return value;
    },
  );
  const previewUrls = listFromEnv(env, "TWOFOLD_PREVIEW_URLS", []).map((url) =>
    url.replace(/\/+$/, ""),
  );

  const staticDir = path.join(projectRoot, "dist", "web");
  const extraEnv = (env.TWOFOLD_PASSTHROUGH_ENV ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  return {
    version: env.TWOFOLD_VERSION ?? "0.1.0",
    host: env.TWOFOLD_HOST ?? "127.0.0.1",
    port: intFromEnv(env, "TWOFOLD_PORT", 7777),
    publicUrl: nonEmpty(env.TWOFOLD_PUBLIC_URL)?.replace(/\/+$/, "") ?? null,
    privateDir: path.resolve(env.TWOFOLD_PRIVATE_DIR ?? path.join(dataDir, "private")),
    workDir: path.resolve(env.TWOFOLD_WORK_DIR ?? path.join(dataDir, "work")),
    samplesDir: path.resolve(env.TWOFOLD_SAMPLES_DIR ?? path.join(projectRoot, "samples")),
    reposDir: path.resolve(env.TWOFOLD_REPOS_DIR ?? path.join(projectRoot, "repos")),
    staticDir: env.TWOFOLD_STATIC_DIR ?? staticDir,
    adminToken: nonEmpty(env.TWOFOLD_ADMIN_TOKEN),
    sandbox,
    terminalUser,
    terminalsDir: path.resolve(env.TWOFOLD_TERMINALS_DIR ?? path.join(dataDir, "terminals")),
    previewPorts: three(previewPorts, "TWOFOLD_PREVIEW_PORTS"),
    previewUrls: previewUrls.length === 0 ? null : three(previewUrls, "TWOFOLD_PREVIEW_URLS"),
    passthroughEnv: [...new Set([...DEFAULT_PASSTHROUGH, ...extraEnv])],
    enableMock: flagFromEnv(env, "TWOFOLD_ENABLE_MOCK"),
    mockDelayMs: intFromEnv(env, "TWOFOLD_MOCK_DELAY_MS", 600),
    agentTimeoutMs: intFromEnv(env, "TWOFOLD_AGENT_TIMEOUT_MINUTES", 30) * 60_000,
    claudeBin: env.TWOFOLD_CLAUDE_BIN ?? "claude",
    codexBin: env.TWOFOLD_CODEX_BIN ?? "codex",
  };
}
