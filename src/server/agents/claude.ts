import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { HarnessStatus } from "../../shared/model.js";
import { CommandNotFoundError, type Runner } from "../process.js";
import { describeClaudeTool } from "./activity.js";
import {
  AgentError,
  extractJson,
  type AgentResult,
  type AgentTurn,
  type Harness,
} from "./types.js";

const InitEvent = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  session_id: z.string(),
});

const AssistantEvent = z.object({
  type: z.literal("assistant"),
  parent_tool_use_id: z.string().nullish(),
  message: z.object({ content: z.array(z.unknown()) }),
});

const TextBlock = z.object({ type: z.literal("text"), text: z.string() });
const ToolUseBlock = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

const ResultEvent = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  session_id: z.string().optional(),
  errors: z.array(z.string()).optional(),
});

const AuthStatus = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  subscriptionType: z.string().nullish(),
  email: z.string().nullish(),
});

/** Tools a chat turn may not use: it talks about the code, it does not change it. */
const CHAT_DISALLOWED_TOOLS = "Edit,MultiEdit,Write,NotebookEdit";

export interface ClaudeStreamState {
  sessionId: string | null;
  texts: string[];
  result: z.infer<typeof ResultEvent> | null;
}

/** Feeds one line of `--output-format stream-json` into the turn's state. */
export function handleClaudeLine(
  line: string,
  state: ClaudeStreamState,
  turn: Pick<AgentTurn, "cwd" | "onEvent">,
): void {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (_error) {
    return;
  }

  const init = InitEvent.safeParse(raw);
  if (init.success) {
    state.sessionId = init.data.session_id;
    return;
  }

  const assistant = AssistantEvent.safeParse(raw);
  if (assistant.success) {
    // Subagent chatter is not part of the conversation.
    if (assistant.data.parent_tool_use_id != null) return;
    for (const block of assistant.data.message.content) {
      const text = TextBlock.safeParse(block);
      if (text.success) {
        if (text.data.text.trim() === "") continue;
        state.texts.push(text.data.text);
        turn.onEvent({ type: "text", text: text.data.text });
        continue;
      }
      const tool = ToolUseBlock.safeParse(block);
      if (tool.success) {
        const described = describeClaudeTool(tool.data.name, tool.data.input, turn.cwd);
        if (described !== null) turn.onEvent({ type: "activity", activity: described });
      }
    }
    return;
  }

  const result = ResultEvent.safeParse(raw);
  if (result.success) {
    state.result = result.data;
    if (result.data.session_id !== undefined) state.sessionId = result.data.session_id;
  }
}

export class ClaudeHarness implements Harness {
  readonly kind = "claude";
  readonly label = "Claude Code";

  constructor(
    private readonly runner: Runner,
    private readonly bin: string,
  ) {}

  async status(): Promise<HarnessStatus> {
    const base: Pick<HarnessStatus, "kind" | "label" | "models" | "efforts"> = {
      kind: this.kind,
      label: this.label,
      models: ["fable", "opus", "sonnet", "haiku"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    };
    try {
      const version = await this.runner.run(this.bin, ["--version"], {
        cwd: "/",
        timeoutMs: 20_000,
      });
      if (version.code !== 0) {
        return { ...base, installed: false, authenticated: false, detail: version.output.trim() };
      }
      const auth = await this.runner.run(this.bin, ["auth", "status"], {
        cwd: "/",
        timeoutMs: 20_000,
      });
      const parsed = AuthStatus.safeParse(extractJson(auth.stdout.toString("utf8")));
      const versionText = version.stdout.toString("utf8").trim();
      if (parsed.success && parsed.data.loggedIn) {
        const plan = parsed.data.subscriptionType ?? parsed.data.authMethod ?? "signed in";
        return {
          ...base,
          installed: true,
          authenticated: true,
          detail: `${versionText} · ${plan}`,
        };
      }
      return {
        ...base,
        installed: true,
        authenticated: false,
        detail: `${versionText} · not signed in`,
      };
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return { ...base, installed: false, authenticated: false, detail: error.message };
      }
      throw error;
    }
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--dangerously-skip-permissions",
      "--append-system-prompt",
      turn.instructions,
    ];
    if (turn.model !== "") args.push("--model", turn.model);
    if (turn.effort !== "") args.push("--effort", turn.effort);
    if (turn.mode === "chat") args.push("--disallowedTools", CHAT_DISALLOWED_TOOLS);
    if (!turn.persist) args.push("--no-session-persistence");
    else if (turn.resume !== null) args.push("--resume", turn.resume);
    else args.push("--session-id", randomUUID());
    if (turn.outputSchema !== null) args.push("--json-schema", JSON.stringify(turn.outputSchema));

    const state: ClaudeStreamState = { sessionId: null, texts: [], result: null };
    let result;
    try {
      result = await this.runner.run(this.bin, args, {
        cwd: turn.cwd,
        stdin: turn.prompt,
        signal: turn.signal,
        timeoutMs: turn.timeoutMs,
        onStdoutLine: (line) => {
          handleClaudeLine(line, state, turn);
        },
      });
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        throw new AgentError("Claude Code is not installed", error.message);
      }
      throw error;
    }

    if (result.aborted) throw new AgentError("Cancelled", "", true);
    if (result.timedOut) throw new AgentError("Claude Code timed out", result.stderr);
    const final = state.result;
    if (final === null) {
      throw new AgentError(
        "Claude Code exited without a result",
        result.stderr.trim() || result.output.trim(),
      );
    }
    if (final.is_error === true || final.subtype !== "success") {
      const reason = final.errors?.join("; ") ?? final.result ?? final.subtype;
      throw new AgentError(`Claude Code reported an error: ${reason}`, result.stderr);
    }

    const text = final.result ?? state.texts.join("\n\n");
    let structured: unknown = null;
    if (turn.outputSchema !== null) {
      structured = final.structured_output ?? extractJson(text);
    }
    return {
      sessionId: state.sessionId,
      text: turn.outputSchema === null ? text : state.texts.join("\n\n"),
      structured,
      costUsd: final.total_cost_usd ?? null,
    };
  }
}
