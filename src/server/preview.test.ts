import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { AppPorts } from "./ports.js";
import { Previews, stripTwofoldCookies } from "./preview.js";
import {
  createTestApp,
  lastRound,
  readySession,
  waitFor,
  type TestApp,
} from "./testing/fixtures.js";

let t: TestApp;
let previews: Previews;
let ports: [number, number, number];
let app: Server;
let appPort: number;

const where = { host: "127.0.0.1:7777", protocol: "http:" };

beforeEach(async () => {
  t = await createTestApp({ env: { TWOFOLD_PREVIEW_PORTS: "0,0,0" } });
  previews = new Previews(t.config, t.app.store, new AppPorts());
  ports = await previews.listen("127.0.0.1");

  // Stands in for a server the candidate started: echoes what it was sent.
  app = createServer((request, response) => {
    response.setHeader("set-cookie", ["app=1; Path=/", "twofold_admin=evil; Path=/"]);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ path: request.url, cookie: request.headers.cookie ?? null }));
  });
  const sockets = new WebSocketServer({ server: app });
  sockets.on("connection", (socket) => {
    socket.on("message", (data: Buffer) => {
      socket.send(`echo:${data.toString("utf8")}`);
    });
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  appPort = address.port;
});

afterEach(async () => {
  previews.close();
  await new Promise<void>((resolve) =>
    app.close(() => {
      resolve();
    }),
  );
  await t.cleanup();
});

function base(index: number): string {
  return `http://127.0.0.1:${String(ports[index] ?? 0)}`;
}

/** Opens a preview the way the candidate's page does, and returns its cookie. */
async function open(index: number, key: string, port: number, rest = "/"): Promise<Response> {
  return fetch(`${base(index)}/__twofold/${key}/${String(port)}${rest}`, { redirect: "manual" });
}

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("stripTwofoldCookies", () => {
  it("keeps the app's cookies and drops Twofold's", () => {
    expect(stripTwofoldCookies("a=1; twofold_admin=x; b=2; twofold_preview_a=y")).toBe("a=1; b=2");
    expect(stripTwofoldCookies("twofold_admin=x")).toBeNull();
    expect(stripTwofoldCookies(undefined)).toBeNull();
  });
});

describe("previews", () => {
  it("serves the candidate's server at the root of its own origin", async () => {
    const session = await readySession(t.app);
    const info = previews.info(session, "merged", where);
    expect(info?.origin).toBe(base(0));

    const opened = await open(0, info?.key ?? "", appPort, "/books?page=2");
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe("/books?page=2");
    const cookie = cookieFrom(opened);
    expect(cookie).toBe(`twofold_preview_merged=${info?.key ?? ""}.${String(appPort)}`);

    const response = await fetch(`${base(0)}/books?page=2`, {
      headers: { cookie: `${cookie}; twofold_admin=interviewer-secret; theirs=1` },
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    // The app sees its own cookies, never Twofold's.
    expect(body).toEqual({ path: "/books?page=2", cookie: "theirs=1" });
    // …and can't set one of Twofold's.
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toEqual(["app=1; Path=/"]);
  });

  it("shows a waiting page until something listens on the port", async () => {
    const session = await readySession(t.app);
    const info = previews.info(session, "merged", where);
    const cookie = cookieFrom(await open(0, info?.key ?? "", 1999));
    const response = await fetch(`${base(0)}/`, { headers: { cookie } });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("Waiting for a server on port 1999");
    expect(text).toContain('http-equiv="refresh"');
  });

  it("refuses Twofold's own ports and privileged ones", async () => {
    const session = await readySession(t.app);
    const key = previews.info(session, "merged", where)?.key ?? "";
    expect((await open(0, key, t.config.port)).status).toBe(404);
    expect((await open(0, key, ports[1])).status).toBe(404);
    expect((await open(0, key, 80)).status).toBe(404);
  });

  it("needs a cookie from the candidate's page, for the right target", async () => {
    const session = await readySession(t.app);
    const key = previews.info(session, "merged", where)?.key ?? "";
    expect((await fetch(`${base(0)}/`)).status).toBe(404);
    // A merged key opened on version A's port is no good.
    expect((await open(1, key, appPort)).status).toBe(404);
  });

  it("offers A and B only while they are pending, and closes them after", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    expect(previews.info(session, "a", where)).toBeNull();

    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    const a = previews.info(ready, "a", where);
    expect(a?.origin).toBe(base(1));
    const cookie = cookieFrom(await open(1, a?.key ?? "", appPort));
    expect((await fetch(`${base(1)}/`, { headers: { cookie } })).status).toBe(200);

    await t.app.decide(session.id, lastRound(ready).id, {
      choice: "b",
      tags: [],
      note: "fine",
      edits: [],
    });
    const after = await fetch(`${base(1)}/`, { headers: { cookie } });
    expect(after.status).toBe(410);
    expect(await after.text()).toContain("no longer waiting for a decision");
  });

  it("passes WebSockets through", async () => {
    const session = await readySession(t.app);
    const info = previews.info(session, "merged", where);
    const cookie = cookieFrom(await open(0, info?.key ?? "", appPort));
    const socket = new WebSocket(`ws://127.0.0.1:${String(ports[0])}/live`, {
      headers: { cookie },
    });
    const reply = await new Promise<string>((resolve, reject) => {
      socket.on("open", () => {
        socket.send("ping");
      });
      socket.on("message", (data: Buffer) => {
        resolve(data.toString("utf8"));
      });
      socket.on("error", reject);
    });
    expect(reply).toBe("echo:ping");
    socket.close();
  });
});
