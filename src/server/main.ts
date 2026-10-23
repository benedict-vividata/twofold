import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Harnesses } from "./agents/index.js";
import { loadConfig, type Config } from "./config.js";
import { Git } from "./git.js";
import { createApp } from "./http.js";
import { logger } from "./logger.js";
import { Runner } from "./process.js";
import { Twofold } from "./service.js";
import { SessionStore } from "./store.js";
import { AppPorts } from "./ports.js";
import { Previews } from "./preview.js";
import { Terminals } from "./terminal.js";
import { Workspaces } from "./workspace.js";

/** The configured admin token, or one generated on first start and kept in the private directory. */
async function adminToken(config: Config): Promise<string> {
  if (config.adminToken !== null) return config.adminToken;
  const file = path.join(config.privateDir, "admin-token");
  const existing = await readFile(file, "utf8").catch(() => "");
  if (existing.trim() !== "") return existing.trim();
  const token = randomBytes(18).toString("base64url");
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  return token;
}

async function main(): Promise<void> {
  const config = loadConfig();
  // Group-writable files, so the server and the sandbox user can share workspaces.
  process.umask(0o002);
  await mkdir(config.privateDir, { recursive: true, mode: 0o700 });
  await chmod(config.privateDir, 0o700);
  await mkdir(config.workDir, { recursive: true });

  const runner = new Runner(config.sandbox, config.passthroughEnv);
  const git = new Git(runner);
  const store = new SessionStore(path.join(config.privateDir, "sessions"));
  await store.load();
  const app = new Twofold(
    config,
    store,
    new Workspaces(config, runner, git),
    new Harnesses(config, runner),
  );
  const token = await adminToken(config);
  const ports = new AppPorts();
  const terminals = new Terminals(config, store, (id) => app.workspaces.paths(id).repo, ports);
  await terminals.init();
  app.terminalAvailable = terminals.available;
  const previews = new Previews(config, store, ports);
  if (terminals.available) {
    try {
      const bound = await previews.listen(config.host);
      logger.info(
        `previews: merged :${String(bound[0])}, A :${String(bound[1])}, B :${String(bound[2])}`,
      );
    } catch (error) {
      logger.warn(
        `previews are off: couldn't listen on ${config.previewPorts.join(", ")}: ${String(error)}`,
      );
    }
  }

  const listener = getRequestListener(createApp(app, token, previews).fetch);
  const server = createServer((request, response) => {
    void listener(request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    terminals.handleUpgrade(request, socket, head);
  });
  server.listen(config.port, config.host, () => {
    const base = config.publicUrl ?? `http://localhost:${String(config.port)}`;
    logger.info(`twofold ${config.version} listening on ${config.host}:${String(config.port)}`);
    logger.info(
      `sandbox: ${config.sandbox === null ? "off (processes run as this user)" : `uid ${String(config.sandbox.uid)}`}`,
    );
    logger.info(`terminals: ${terminals.available ? "on" : "off (node-pty is unavailable)"}`);
    logger.info(`interviewer sign-in: ${base}/login#token=${token}`);
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received; shutting down`);
    terminals.shutdown();
    previews.close();
    server.close();
    void app
      .shutdown()
      .then(() => store.flush())
      .finally(() => {
        process.exit(0);
      });
    setTimeout(() => {
      process.exit(0);
    }, 8000).unref();
  };
  process.on("SIGTERM", () => {
    stop("SIGTERM");
  });
  process.on("SIGINT", () => {
    stop("SIGINT");
  });
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
