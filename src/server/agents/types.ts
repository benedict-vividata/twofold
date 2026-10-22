import type { Activity, HarnessKind, HarnessStatus, RunPurpose } from "../../shared/model.js";

export type JsonSchema = Record<string, unknown>;

export type AgentEvent = { type: "text"; text: string } | { type: "activity"; activity: Activity };

export interface AgentTurn {
  purpose: RunPurpose;
  cwd: string;
  prompt: string;
  /** Standing instructions for the whole conversation. */
  instructions: string;
  /** `chat` may read and run things but its file edits are thrown away; `write` produces a change. */
  mode: "chat" | "write";
  /** A conversation to continue, from an earlier turn's `sessionId`. */
  resume: string | null;
  /** Whether the conversation must be resumable afterwards. Generation runs leave nothing behind. */
  persist: boolean;
  /** When set, the final answer must be JSON matching this schema. */
  outputSchema: JsonSchema | null;
  /** Where the harness may write scratch files (outside any worktree). */
  scratchDir: string;
  model: string;
  effort: string;
  signal: AbortSignal;
  timeoutMs: number;
  onEvent: (event: AgentEvent) => void;
}

export interface AgentResult {
  sessionId: string | null;
  text: string;
  structured: unknown;
  costUsd: number | null;
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly cancelled = false,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface Harness {
  readonly kind: HarnessKind;
  readonly label: string;
  status(): Promise<HarnessStatus>;
  run(turn: AgentTurn): Promise<AgentResult>;
}

/** Pulls the first JSON object out of free text: a fenced block, or the outermost braces. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
      return parsed;
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return null;
}
