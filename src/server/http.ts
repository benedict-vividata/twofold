import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  ChatRequest,
  DecisionRequest,
  GenerateRequest,
  LoginRequest,
  Position,
  type AdminSessionView,
  type Session,
} from "../shared/model.js";
import { logger } from "./logger.js";
import { buildReport } from "./report.js";
import { HttpError, type Twofold } from "./service.js";
import { toCandidateSession, toSummary } from "./views.js";

const ADMIN_COOKIE = "twofold_admin";
const SSE_HEARTBEAT_MS = 20_000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokensMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch (_error) {
    throw new HttpError(400, "Expected a JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      400,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch (_error) {
      return undefined;
    }
  }
  return undefined;
}

function isHttps(c: Context): boolean {
  return c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // CodeMirror injects its styles at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export function createApp(app: Twofold, adminToken: string): Hono {
  const http = new Hono();
  const { config, store } = app;

  http.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: undefined,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: "no-referrer",
    }),
  );
  http.use("*", async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP);
  });
  http.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  http.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    logger.error(`${c.req.method} ${c.req.path}: ${error.stack ?? String(error)}`);
    return c.json({ error: "Internal error" }, 500);
  });

  const defaultLimit = bodyLimit({
    maxSize: 512 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  });
  const decisionLimit = bodyLimit({
    maxSize: 16 * 1024 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  });

  const candidateUrl = (c: Context, session: Session): string => {
    const origin = config.publicUrl ?? new URL(c.req.url).origin;
    return `${origin}/c/${session.candidateToken}`;
  };

  const adminView = (c: Context, session: Session): AdminSessionView => ({
    session,
    candidateUrl: candidateUrl(c, session),
  });

  http.get("/api/health", (c) => c.json({ ok: true, version: config.version }));

  // -------------------------------------------------------------------------
  // Interviewer
  // -------------------------------------------------------------------------

  http.post("/api/admin/login", defaultLimit, async (c) => {
    const { token } = await parseBody(c, LoginRequest);
    if (!tokensMatch(token.trim(), adminToken)) throw new HttpError(403, "That token is not right");
    setCookie(c, ADMIN_COOKIE, adminToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttps(c),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.json({ ok: true });
  });

  http.post("/api/admin/logout", (c) => {
    deleteCookie(c, ADMIN_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  http.use("/api/admin/*", async (c, next) => {
    if (c.req.path === "/api/admin/login" || c.req.path === "/api/admin/logout") {
      await next();
      return;
    }
    const cookie = readCookie(c.req.header("cookie"), ADMIN_COOKIE);
    if (cookie === undefined || !tokensMatch(cookie, adminToken)) {
      return c.json({ error: "Sign in as the interviewer" }, 401);
    }
    await next();
    return;
  });

  http.get("/api/admin/me", (c) => c.json({ ok: true }));

  http.get("/api/admin/environment", async (c) =>
    c.json(await app.environment(c.req.query("refresh") === "1")),
  );

  http.get("/api/admin/sessions", (c) => c.json(store.list().map(toSummary)));

  http.post("/api/admin/sessions", defaultLimit, async (c) => {
    const session = await app.createSession(await parseBody(c, z.unknown()));
    return c.json({ id: session.id }, 201);
  });

  http.get("/api/admin/sessions/:id", (c) => c.json(adminView(c, app.session(c.req.param("id")))));

  http.get("/api/admin/sessions/:id/events", (c) => {
    const session = app.session(c.req.param("id"));
    return streamSSE(c, async (stream) => {
      const send = async (current: Session): Promise<void> => {
        await stream.writeSSE({ event: "session", data: JSON.stringify(adminView(c, current)) });
      };
      await send(session);
      const unsubscribe = store.subscribe(session.id, (current) => {
        void send(current);
      });
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" });
      }, SSE_HEARTBEAT_MS);
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  http.post("/api/admin/sessions/:id/finish", (c) => {
    app.finish(c.req.param("id"));
    return c.json({ ok: true });
  });

  http.delete("/api/admin/sessions/:id", async (c) => {
    await app.delete(c.req.param("id"));
    return c.json({ ok: true });
  });

  http.post("/api/admin/sessions/:id/rounds/:roundId/cancel", (c) => {
    app.cancelRound(c.req.param("id"), c.req.param("roundId"));
    return c.json({ ok: true });
  });

  http.get("/api/admin/sessions/:id/rounds/:roundId/variants/:position", async (c) => {
    const session = app.session(c.req.param("id"));
    const position = Position.parse(c.req.param("position"));
    return c.json(await app.variantFiles(session, c.req.param("roundId"), position));
  });

  http.get("/api/admin/sessions/:id/report.md", (c) => {
    const session = app.session(c.req.param("id"));
    const name = (session.config.candidateName || session.config.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="twofold-${name || session.id}.md"`);
    return c.body(buildReport(session));
  });

  http.get("/api/admin/sessions/:id/tree", async (c) =>
    c.json(await app.tree(app.session(c.req.param("id")), c.req.query("path") ?? "")),
  );

  http.get("/api/admin/sessions/:id/file", async (c) =>
    c.json(await app.file(app.session(c.req.param("id")), c.req.query("path") ?? "")),
  );

  // -------------------------------------------------------------------------
  // Candidate — every route is scoped by the unguessable token in the link
  // -------------------------------------------------------------------------

  const candidate = (c: Context): Session => app.sessionByToken(c.req.param("token") ?? "");

  http.get("/api/c/:token", (c) => c.json(toCandidateSession(candidate(c))));

  http.get("/api/c/:token/events", (c) => {
    const session = candidate(c);
    return streamSSE(c, async (stream) => {
      const send = async (current: Session): Promise<void> => {
        await stream.writeSSE({
          event: "session",
          data: JSON.stringify(toCandidateSession(current)),
        });
      };
      await send(session);
      const unsubscribe = store.subscribe(session.id, (current) => {
        void send(current);
      });
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" });
      }, SSE_HEARTBEAT_MS);
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  http.post("/api/c/:token/start", (c) => {
    app.start(candidate(c).id);
    return c.json({ ok: true });
  });

  http.post("/api/c/:token/finish", (c) => {
    app.finish(candidate(c).id);
    return c.json({ ok: true });
  });

  http.post("/api/c/:token/messages", defaultLimit, async (c) => {
    const { text } = await parseBody(c, ChatRequest);
    app.sendChat(candidate(c).id, text);
    return c.json({ ok: true }, 202);
  });

  http.post("/api/c/:token/messages/stop", (c) => {
    app.stopChat(candidate(c).id);
    return c.json({ ok: true });
  });

  http.post("/api/c/:token/rounds", defaultLimit, async (c) => {
    const { request } = await parseBody(c, GenerateRequest);
    const round = app.generate(candidate(c).id, request);
    return c.json({ id: round.id }, 202);
  });

  http.post("/api/c/:token/rounds/:roundId/cancel", (c) => {
    app.cancelRound(candidate(c).id, c.req.param("roundId"));
    return c.json({ ok: true });
  });

  http.post("/api/c/:token/rounds/:roundId/decision", decisionLimit, async (c) => {
    const decision = await parseBody(c, DecisionRequest);
    await app.decide(candidate(c).id, c.req.param("roundId"), decision);
    return c.json({ ok: true });
  });

  http.get("/api/c/:token/rounds/:roundId/variants/:position", async (c) => {
    const position = Position.safeParse(c.req.param("position"));
    if (!position.success) throw new HttpError(404, "No such version");
    return c.json(await app.variantFiles(candidate(c), c.req.param("roundId"), position.data));
  });

  http.get("/api/c/:token/tree", async (c) =>
    c.json(await app.tree(candidate(c), c.req.query("path") ?? "")),
  );

  http.get("/api/c/:token/file", async (c) =>
    c.json(await app.file(candidate(c), c.req.query("path") ?? "")),
  );

  http.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // -------------------------------------------------------------------------
  // The web app
  // -------------------------------------------------------------------------

  const staticDir = config.staticDir;
  if (staticDir !== null) {
    const root = path.resolve(staticDir);
    http.get("*", async (c) => {
      const requested = path.resolve(root, `.${decodeURIComponent(new URL(c.req.url).pathname)}`);
      const inside = requested === root || requested.startsWith(`${root}${path.sep}`);
      const info = inside ? await stat(requested).catch(() => null) : null;
      const file = info?.isFile() === true ? requested : path.join(root, "index.html");
      const body = await readFile(file).catch(() => null);
      if (body === null) return c.text("The web app has not been built. Run `pnpm build`.", 503);
      const type = MIME[path.extname(file)] ?? "application/octet-stream";
      c.header("Content-Type", type);
      c.header(
        "Cache-Control",
        file.includes(`${path.sep}assets${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      return c.body(new Uint8Array(body));
    });
  }

  return http;
}
