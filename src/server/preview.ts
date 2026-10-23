// Previews: a browser view of servers the candidate starts in a terminal.
//
// Those servers listen inside the container, so the browser can't reach them
// directly. Each target (the merged code, version A, version B) gets its own
// preview port that proxies to the server, at the root of its own origin, so
// apps that use absolute paths (`/assets/…`, `/@vite/client`) work unchanged.
//
// Which session and app port a request belongs to is carried in a cookie that
// the preview sets when it's opened from the candidate's page, so several
// sessions can share the same preview ports.
//
// Browsers send cookies to every port on a host, so the interviewer's
// sign-in cookie would otherwise reach the candidate's app. Every `twofold_*`
// cookie is stripped on the way in, and the app can't set one on the way out.
import { randomBytes } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import type { PreviewTarget, Session, TerminalTarget } from "../shared/model.js";
import type { Config } from "./config.js";
import { logger } from "./logger.js";
import type { AppPorts } from "./ports.js";
import type { SessionStore } from "./store.js";
import { targetCommit } from "./terminal.js";

export const PREVIEW_TARGETS: readonly TerminalTarget[] = ["merged", "a", "b"];

const LABEL: Record<TerminalTarget, string> = { merged: "merged", a: "A", b: "B" };
const OPEN_PATH = /^\/__twofold\/([A-Za-z0-9_-]{16,64})\/(\d{1,5})(\/.*)?$/;

function cookieName(target: TerminalTarget): string {
  return `twofold_preview_${target}`;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return cookies;
}

/** The request's cookies without any of Twofold's own. */
export function stripTwofoldCookies(header: string | undefined): string | null {
  const kept = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair !== "" && !pair.startsWith("twofold_"));
  return kept.length === 0 ? null : kept.join("; ");
}

function forwardedHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === "cookie") continue;
    out[name] = value;
  }
  const cookie = stripTwofoldCookies(headers.cookie);
  if (cookie !== null) out.cookie = cookie;
  if (headers.host !== undefined) out["x-forwarded-host"] = headers.host;
  out["x-forwarded-proto"] = "http";
  return out;
}

/** The app's response headers, minus any attempt to set one of Twofold's cookies. */
function returnedHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (name === "set-cookie" && Array.isArray(value)) {
      const kept = value.filter((cookie) => !cookie.trim().startsWith("twofold_"));
      if (kept.length > 0) out[name] = kept;
      continue;
    }
    out[name] = value;
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
}

/** A small page for the preview frame: waiting for a server, or a dead end. */
function page(
  response: ServerResponse,
  status: number,
  title: string,
  body: string,
  refresh = false,
): void {
  const html = `<!doctype html><html><head><meta charset="utf-8">${
    refresh ? '<meta http-equiv="refresh" content="2">' : ""
  }<title>${escapeHtml(title)}</title><style>
  :root{color-scheme:light dark;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
  main{max-width:28rem;padding:2rem;text-align:center}
  h1{font-size:15px;margin:0 0 .4rem}p{margin:0;opacity:.7}code{font:12.5px ui-monospace,Menlo,monospace}
  </style></head><body><main><h1>${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

export class Previews {
  /** key → whose preview it is */
  private readonly owners = new Map<string, { sessionId: string; target: TerminalTarget }>();
  /** `${sessionId}:${target}` → key */
  private readonly keys = new Map<string, string>();
  private readonly servers: Server[] = [];
  private listening: [number, number, number] | null = null;

  constructor(
    private readonly config: Config,
    private readonly store: SessionStore,
    private readonly ports: AppPorts,
  ) {
    store.subscribeAll((id, session) => {
      if (session !== null) return;
      for (const target of PREVIEW_TARGETS) {
        const key = this.keys.get(`${id}:${target}`);
        if (key !== undefined) this.owners.delete(key);
        this.keys.delete(`${id}:${target}`);
      }
    });
  }

  get available(): boolean {
    return this.listening !== null;
  }

  /** Starts the three preview servers; returns the ports they listen on. */
  async listen(host: string): Promise<[number, number, number]> {
    const bound = await Promise.all(
      PREVIEW_TARGETS.map(
        (target, index) =>
          new Promise<number>((resolve, reject) => {
            const server = createServer((request, response) => {
              this.handle(target, request, response);
            });
            server.on("upgrade", (request, socket, head) => {
              this.upgrade(target, request, socket, head);
            });
            server.once("error", reject);
            server.listen(this.config.previewPorts[index] ?? 0, host, () => {
              const address = server.address();
              resolve(typeof address === "object" && address !== null ? address.port : 0);
            });
            this.servers.push(server);
          }),
      ),
    );
    const [merged = 0, a = 0, b = 0] = bound;
    this.listening = [merged, a, b];
    return this.listening;
  }

  close(): void {
    for (const server of this.servers) server.close();
    this.servers.length = 0;
    this.listening = null;
  }

  /** What the candidate's page needs to open a target's preview, or null if it has none right now. */
  info(
    session: Session,
    target: TerminalTarget,
    request: { host: string; protocol: string },
  ): PreviewTarget | null {
    if (this.listening === null || !session.config.allowTerminal || session.status !== "active")
      return null;
    if (targetCommit(session, target) === null) return null;
    const index = PREVIEW_TARGETS.indexOf(target);
    const owner = `${session.id}:${target}`;
    let key = this.keys.get(owner);
    if (key === undefined) {
      key = randomBytes(18).toString("base64url");
      this.keys.set(owner, key);
      this.owners.set(key, { sessionId: session.id, target });
    }
    return {
      target,
      origin: this.origin(index, request),
      key,
      port: this.ports.portFor(session.id, target),
    };
  }

  /** The origins the candidate's page may frame. */
  origins(request: { host: string; protocol: string }): string[] {
    if (this.listening === null) return [];
    return PREVIEW_TARGETS.map((_, index) => this.origin(index, request));
  }

  private origin(index: number, request: { host: string; protocol: string }): string {
    const configured = this.config.previewUrls?.[index];
    if (configured !== undefined) return configured;
    const hostname = request.host.replace(/:\d+$/, "");
    return `${request.protocol}//${hostname}:${String(this.listening?.[index] ?? 0)}`;
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  private blockedPort(port: number): boolean {
    if (port < 1024 || port > 65535) return true;
    return port === this.config.port || (this.listening?.includes(port) ?? false);
  }

  /** Who a request is for, from its cookie; or why it can't be served. */
  private resolve(
    target: TerminalTarget,
    request: IncomingMessage,
  ): { port: number; session: Session } | { status: number; title: string; body: string } {
    const value = parseCookies(request.headers.cookie).get(cookieName(target));
    const [key = "", rawPort = ""] = (value ?? "").split(".");
    const owner = this.owners.get(key);
    if (owner?.target !== target) {
      return {
        status: 404,
        title: "Nothing to preview here",
        body: "Open the preview from the Preview tab in Twofold.",
      };
    }
    const session = this.store.get(owner.sessionId);
    if (session?.status !== "active" || targetCommit(session, target) === null) {
      return {
        status: 410,
        title: "This preview has closed",
        body:
          target === "merged"
            ? "The session has ended."
            : `Version ${LABEL[target]} is no longer waiting for a decision.`,
      };
    }
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || this.blockedPort(port)) {
      return { status: 403, title: "That port can't be previewed", body: "Choose another port." };
    }
    return { port, session };
  }

  private handle(target: TerminalTarget, request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://preview");
    const open = OPEN_PATH.exec(url.pathname);
    if (open !== null) {
      // Opened from the candidate's page: remember who this is for, then show the app.
      const [, key = "", rawPort = ""] = open;
      const owner = this.owners.get(key);
      const port = Number.parseInt(rawPort, 10);
      if (owner?.target !== target || this.blockedPort(port)) {
        page(
          response,
          404,
          "Nothing to preview here",
          "Open the preview from the Preview tab in Twofold.",
        );
        return;
      }
      response.writeHead(302, {
        location: `${open[3] ?? "/"}${url.search}`,
        "set-cookie": `${cookieName(target)}=${key}.${String(port)}; Path=/; HttpOnly; SameSite=Lax`,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    const route = this.resolve(target, request);
    if (!("port" in route)) {
      page(response, route.status, route.title, route.body);
      return;
    }
    const { port } = route;
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: request.method,
        path: request.url,
        headers: forwardedHeaders(request.headers),
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, returnedHeaders(reply.headers));
        reply.pipe(response);
      },
    );
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error.code === "ECONNREFUSED") {
        page(
          response,
          502,
          `Waiting for a server on port ${String(port)}…`,
          `Start one in the <b>${escapeHtml(LABEL[target])}</b> terminal, which has <code>PORT=${String(
            port,
          )}</code> set. This page refreshes by itself.`,
          true,
        );
      } else {
        page(response, 502, "The server didn't answer", escapeHtml(error.message));
      }
    });
    request.pipe(upstream);
  }

  /** WebSockets (dev-server reloads, app sockets), passed straight through. */
  private upgrade(
    target: TerminalTarget,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const route = this.resolve(target, request);
    if (!("port" in route)) {
      socket.end(
        `HTTP/1.1 ${String(route.status)} Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      return;
    }
    const upstream = connect(route.port, "127.0.0.1", () => {
      const lines = [
        `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}`,
      ];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index] ?? "";
        const value = request.rawHeaders[index + 1] ?? "";
        if (name.toLowerCase() === "cookie") {
          const kept = stripTwofoldCookies(value);
          if (kept !== null) lines.push(`${name}: ${kept}`);
          continue;
        }
        lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", (error) => {
      logger.warn(`preview websocket to port ${String(route.port)} failed: ${error.message}`);
      socket.destroy();
    });
    socket.on("error", () => {
      upstream.destroy();
    });
  }
}
