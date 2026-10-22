// A thin, typed client for the server. Every response is parsed with the
// shared schemas, so the UI only ever handles data the compiler can vouch for.
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  AdminSessionView,
  CandidateSession,
  Environment,
  FileContent,
  SessionSummary,
  TreeListing,
  VariantFiles,
  type DecisionRequestInput,
  type Position,
  type SessionConfigInput,
} from "../shared/model";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const ErrorBody = z.object({ error: z.string() });
const Ok = z.object({ ok: z.boolean() });
const Created = z.object({ id: z.string() });

async function call<T>(schema: z.ZodType<T>, url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch (_error) {
    throw new ApiError(0, "Can't reach the server. Check that it is running.");
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch (_error) {
    body = null;
  }
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error : `Request failed (${String(response.status)})`,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(500, "The server sent something unexpected.");
  return parsed.data;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function query(path: string): string {
  return new URLSearchParams({ path }).toString();
}

type Created = z.infer<typeof Created>;
type Ok = z.infer<typeof Ok>;

export interface AdminApi {
  login: (token: string) => Promise<Ok>;
  logout: () => Promise<Ok>;
  me: () => Promise<Ok>;
  environment: (refresh?: boolean) => Promise<Environment>;
  sessions: () => Promise<SessionSummary[]>;
  session: (id: string) => Promise<AdminSessionView>;
  create: (config: SessionConfigInput) => Promise<Created>;
  finish: (id: string) => Promise<Ok>;
  remove: (id: string) => Promise<Ok>;
  cancelRound: (id: string, roundId: string) => Promise<Ok>;
  variant: (id: string, roundId: string, position: Position) => Promise<VariantFiles>;
  reportUrl: (id: string) => string;
  eventsUrl: (id: string) => string;
}

export const adminApi: AdminApi = {
  login: (token: string) => call(Ok, "/api/admin/login", post({ token })),
  logout: () => call(Ok, "/api/admin/logout", post()),
  me: () => call(Ok, "/api/admin/me"),
  environment: (refresh = false) =>
    call(Environment, `/api/admin/environment${refresh ? "?refresh=1" : ""}`),
  sessions: () => call(z.array(SessionSummary), "/api/admin/sessions"),
  session: (id: string) => call(AdminSessionView, `/api/admin/sessions/${id}`),
  create: (config: SessionConfigInput) => call(Created, "/api/admin/sessions", post(config)),
  finish: (id: string) => call(Ok, `/api/admin/sessions/${id}/finish`, post()),
  remove: (id: string) => call(Ok, `/api/admin/sessions/${id}`, { method: "DELETE" }),
  cancelRound: (id: string, roundId: string) =>
    call(Ok, `/api/admin/sessions/${id}/rounds/${roundId}/cancel`, post()),
  variant: (id: string, roundId: string, position: Position) =>
    call(VariantFiles, `/api/admin/sessions/${id}/rounds/${roundId}/variants/${position}`),
  reportUrl: (id: string) => `/api/admin/sessions/${id}/report.md`,
  eventsUrl: (id: string) => `/api/admin/sessions/${id}/events`,
};

export interface CandidateApi {
  session: () => Promise<CandidateSession>;
  start: () => Promise<Ok>;
  finish: () => Promise<Ok>;
  chat: (text: string) => Promise<Ok>;
  stopChat: () => Promise<Ok>;
  generate: (request: string) => Promise<Created>;
  cancelRound: (roundId: string) => Promise<Ok>;
  decide: (roundId: string, decision: DecisionRequestInput) => Promise<Ok>;
  variant: (roundId: string, position: Position) => Promise<VariantFiles>;
  tree: (path: string) => Promise<TreeListing>;
  file: (path: string) => Promise<FileContent>;
  eventsUrl: string;
}

export function candidateApi(token: string): CandidateApi {
  const base = `/api/c/${encodeURIComponent(token)}`;
  return {
    session: () => call(CandidateSession, base),
    start: () => call(Ok, `${base}/start`, post()),
    finish: () => call(Ok, `${base}/finish`, post()),
    chat: (text: string) => call(Ok, `${base}/messages`, post({ text })),
    stopChat: () => call(Ok, `${base}/messages/stop`, post()),
    generate: (request: string) => call(Created, `${base}/rounds`, post({ request })),
    cancelRound: (roundId: string) => call(Ok, `${base}/rounds/${roundId}/cancel`, post()),
    decide: (roundId: string, decision: DecisionRequestInput) =>
      call(Ok, `${base}/rounds/${roundId}/decision`, post(decision)),
    variant: (roundId: string, position: Position) =>
      call(VariantFiles, `${base}/rounds/${roundId}/variants/${position}`),
    tree: (path: string) => call(TreeListing, `${base}/tree?${query(path)}`),
    file: (path: string) => call(FileContent, `${base}/file?${query(path)}`),
    eventsUrl: `${base}/events`,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Subscribes to a server-sent stream of snapshots. The browser reconnects on
 * its own; `connected` reflects whether the stream is currently open.
 */
export function useLive<T>(
  url: string | null,
  schema: z.ZodType<T>,
): { data: T | null; connected: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url === null) return undefined;
    const source = new EventSource(url);
    source.addEventListener("open", () => {
      setConnected(true);
      setError(null);
    });
    source.addEventListener("session", (event) => {
      try {
        const parsed = schema.safeParse(JSON.parse(String(event.data)));
        if (parsed.success) setData(parsed.data);
      } catch (_error) {
        // A malformed frame is skipped; the next snapshot replaces it.
      }
    });
    source.addEventListener("error", () => {
      setConnected(false);
      if (source.readyState === EventSource.CLOSED) setError("Lost connection to the server.");
    });
    return () => {
      source.close();
    };
  }, [url, schema]);

  return { data, connected, error };
}
