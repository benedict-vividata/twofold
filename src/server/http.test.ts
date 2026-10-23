import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./http.js";
import { createTestApp, readySession, sampleConfig, type TestApp } from "./testing/fixtures.js";

const TOKEN = "interviewer-secret";

let t: TestApp;
let http: ReturnType<typeof createApp>;

beforeEach(async () => {
  t = await createTestApp();
  http = createApp(t.app, TOKEN);
});

afterEach(async () => {
  await t.cleanup();
});

async function signIn(): Promise<string> {
  const response = await http.request("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("HttpOnly");
  return cookie.split(";")[0] ?? "";
}

describe("interviewer API", () => {
  it("requires signing in", async () => {
    expect((await http.request("/api/admin/sessions")).status).toBe(401);
    const bad = await http.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    expect(bad.status).toBe(403);
  });

  it("creates and lists sessions once signed in", async () => {
    const cookie = await signIn();
    const created = await http.request("/api/admin/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(sampleConfig()),
    });
    expect(created.status).toBe(201);
    const list = await http.request("/api/admin/sessions", { headers: { cookie } });
    const sessions: unknown = await list.json();
    expect(Array.isArray(sessions) && sessions.length).toBe(1);
  });

  it("refuses state-changing requests from other origins", async () => {
    const cookie = await signIn();
    const response = await http.request("/api/admin/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        host: "localhost:7777",
        origin: "http://localhost:7778",
      },
      body: JSON.stringify(sampleConfig()),
    });
    expect(response.status).toBe(403);
  });

  it("rejects an invalid configuration with a readable message", async () => {
    const cookie = await signIn();
    const response = await http.request("/api/admin/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...sampleConfig(), title: "" }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("error");
  });
});

describe("candidate API", () => {
  it("is scoped to the token in the link", async () => {
    expect((await http.request("/api/c/not-a-token")).status).toBe(404);
    const session = await readySession(t.app);
    const response = await http.request(`/api/c/${session.candidateToken}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(session.candidateToken);
    expect(body).not.toContain("privateNotes");
  });

  it("rejects paths that escape the repository", async () => {
    const session = await readySession(t.app);
    const response = await http.request(
      `/api/c/${session.candidateToken}/file?path=../../etc/passwd`,
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown version", async () => {
    const session = await readySession(t.app);
    const response = await http.request(`/api/c/${session.candidateToken}/tree?version=c`);
    expect(response.status).toBe(400);
  });

  it("serves files from the accepted code", async () => {
    const session = await readySession(t.app);
    const response = await http.request(`/api/c/${session.candidateToken}/file?path=src/app.ts`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("createApp");
  });
});
