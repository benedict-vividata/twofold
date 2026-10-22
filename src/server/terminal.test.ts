import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { TerminalServerMessage } from "../shared/model.js";
import { createApp } from "./http.js";
import { Terminals, projectName } from "./terminal.js";
import {
  createTestApp,
  lastRound,
  readySession,
  waitFor,
  type TestApp,
} from "./testing/fixtures.js";

let t: TestApp;
let terminals: Terminals;
let server: Server;
let port: number;

beforeEach(async () => {
  t = await createTestApp();
  terminals = new Terminals(t.config, t.app.store, (id) => t.app.workspaces.paths(id).repo);
  await terminals.init();
  t.app.terminalAvailable = terminals.available;
  const listener = getRequestListener(createApp(t.app, "token").fetch);
  server = createServer((request, response) => {
    void listener(request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    terminals.handleUpgrade(request, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;
});

afterEach(async () => {
  terminals.shutdown();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  await t.cleanup();
});

interface Client {
  socket: WebSocket;
  output: () => string;
  states: string[];
  type: (text: string) => void;
  waitFor: (predicate: () => boolean, timeoutMs?: number) => Promise<void>;
}

function connect(
  token: string,
  target: string,
  origin = `http://127.0.0.1:${String(port)}`,
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${String(port)}/api/c/${token}/terminal?target=${target}&cols=100&rows=30`,
      { headers: { origin } },
    );
    let output = "";
    const states: string[] = [];
    socket.on("message", (data: Buffer) => {
      const parsed = TerminalServerMessage.safeParse(JSON.parse(data.toString("utf8")));
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.t === "o") output += message.d;
      if (message.t === "s") states.push(message.state);
    });
    socket.on("unexpected-response", (_request, response) => {
      reject(new Error(`refused: ${String(response.statusCode)}`));
    });
    socket.on("error", reject);
    socket.on("open", () => {
      resolve({
        socket,
        output: () => output,
        states,
        type: (text) => {
          socket.send(JSON.stringify({ t: "i", d: text }));
        },
        waitFor: async (predicate, timeoutMs = 15_000) => {
          const started = Date.now();
          while (!predicate()) {
            if (Date.now() - started > timeoutMs) {
              throw new Error(`timed out; output so far:\n${output}\nstates: ${states.join(",")}`);
            }
            await new Promise((done) => setTimeout(done, 25));
          }
        },
      });
    });
  });
}

describe("terminals", () => {
  it("names the project directory after the repository", async () => {
    const session = await readySession(t.app);
    expect(projectName(session)).toBe("bookshelf");
  });

  it("runs a shell on a private copy of the merged code", async () => {
    const session = await readySession(t.app);
    const client = await connect(session.candidateToken, "merged");
    await client.waitFor(() => client.states.includes("ready"));
    await client.waitFor(() => client.output().includes("Terminal on the merged code"));
    client.type("ls src; git log --oneline | wc -l; echo DONE-$((40+2))\r");
    await client.waitFor(() => client.output().includes("DONE-42"));
    expect(client.output()).toContain("validation.ts");
    // A fresh repository with a single commit: no history to dig through.
    expect(client.output()).toMatch(/\b1\s*\r?\n/);
    client.socket.close();
  });

  it("keeps the server's settings out of the shell's environment", async () => {
    process.env.TWOFOLD_SECRET_FOR_TEST = "hunter2";
    try {
      const session = await readySession(t.app);
      const client = await connect(session.candidateToken, "merged");
      await client.waitFor(() => client.states.includes("ready"));
      client.type("echo SECRET=${TWOFOLD_SECRET_FOR_TEST:-none}\r");
      await client.waitFor(() => client.output().includes("SECRET=none"));
      expect(client.output()).not.toContain("hunter2");
      client.socket.close();
    } finally {
      delete process.env.TWOFOLD_SECRET_FOR_TEST;
    }
  });

  it("lets a reconnecting page pick up the scrollback", async () => {
    const session = await readySession(t.app);
    const first = await connect(session.candidateToken, "merged");
    await first.waitFor(() => first.states.includes("ready"));
    first.type("echo REMEMBER-ME\r");
    await first.waitFor(() => first.output().includes("REMEMBER-ME\r\n"));
    first.socket.close();
    const second = await connect(session.candidateToken, "merged");
    await second.waitFor(() => second.output().includes("REMEMBER-ME"));
    second.socket.close();
  });

  it("offers each pending version, and closes it once the pair is decided", async () => {
    const session = await readySession(t.app, {
      mix: { degraded: 1, tradeoff: 0, bothFlawed: 0, control: 0 },
    });
    await expect(connect(session.candidateToken, "a")).rejects.toThrow(/409/);

    t.app.generate(session.id, "Add pagination");
    const ready = await waitFor(t.app, session.id, (s) => lastRound(s).status === "ready");
    const merged = await connect(session.candidateToken, "merged");
    const a = await connect(session.candidateToken, "a");
    await merged.waitFor(() => merged.states.includes("ready"));
    await a.waitFor(() => a.states.includes("ready"));
    a.type("ls twofold-mock | wc -l; echo LISTED\r");
    await a.waitFor(() => /1\s*\r?\n.*LISTED/s.test(a.output()));

    await t.app.decide(session.id, lastRound(ready).id, {
      choice: "a",
      tags: [],
      note: "fine",
      edits: [],
    });
    await a.waitFor(() => a.states.includes("closed"));
    await merged.waitFor(() => merged.states.includes("stale"));
    merged.socket.close();
  });

  it("refuses other origins, unknown tokens and sessions without terminals", async () => {
    const session = await readySession(t.app);
    await expect(connect(session.candidateToken, "merged", "http://evil.example")).rejects.toThrow(
      /403/,
    );
    await expect(connect("not-a-token", "merged")).rejects.toThrow(/404/);
    await expect(connect(session.candidateToken, "elsewhere")).rejects.toThrow(/400/);

    const closed = await readySession(t.app, { allowTerminal: false });
    await expect(connect(closed.candidateToken, "merged")).rejects.toThrow(/403/);
  });
});
