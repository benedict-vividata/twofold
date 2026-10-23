import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HarnessStatus } from "../../shared/model.js";
import { CommandNotFoundError, type Runner } from "../process.js";
import { activity, displayPath } from "./activity.js";
import {
  AgentError,
  extractJson,
  type AgentResult,
  type AgentTurn,
  type Harness,
} from "./types.js";

const ThreadStarted = z.object({ type: z.literal("thread.started"), thread_id: z.string() });

const ItemEvent = z.object({
  type: z.enum(["item.started", "item.updated", "item.completed"]),
  item: z.looseObject({ id: z.string().optional(), type: z.string() }),
});

const AgentMessage = z.object({ type: z.literal("agent_message"), text: z.string() });
const CommandExecution = z.object({ type: z.literal("command_execution"), command: z.string() });
const FileChangeItem = z.object({
  type: z.literal("file_change"),
  changes: z.array(z.object({ path: z.string(), kind: z.string().optional() })),
});
const WebSearch = z.object({ type: z.literal("web_search"), query: z.string().optional() });
const McpCall = z.object({
  type: z.literal("mcp_tool_call"),
  server: z.string().optional(),
  tool: z.string().optional(),
});
const ErrorItem = z.object({ type: z.literal("error"), message: z.string() });

const TurnCompleted = z.object({ type: z.literal("turn.completed") });
const TurnFailed = z.object({
  type: z.literal("turn.failed"),
  error: z.object({ message: z.string() }).optional(),
});
const StreamError = z.object({ type: z.literal("error"), message: z.string() });

export interface CodexStreamState {
  threadId: string | null;
  messages: string[];
  completed: boolean;
  failure: string | null;
}

export function handleCodexLine(
  line: string,
  state: CodexStreamState,
  turn: Pick<AgentTurn, "cwd" | "onEvent">,
): void {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (_error) {
    return;
  }

  const thread = ThreadStarted.safeParse(raw);
  if (thread.success) {
    state.threadId = thread.data.thread_id;
    return;
  }

  const event = ItemEvent.safeParse(raw);
  if (event.success) {
    const item = event.data.item;
    const phase = event.data.type;

    const message = AgentMessage.safeParse(item);
    if (message.success) {
      if (phase === "item.completed" && message.data.text.trim() !== "") {
        state.messages.push(message.data.text);
        turn.onEvent({ type: "text", text: message.data.text });
      }
      return;
    }
    const command = CommandExecution.safeParse(item);
    if (command.success) {
      if (phase === "item.started") {
        turn.onEvent({
          type: "activity",
          activity: activity("command", `Ran ${command.data.command}`),
        });
      }
      return;
    }
    const files = FileChangeItem.safeParse(item);
    if (files.success) {
      if (phase === "item.completed") {
        for (const change of files.data.changes) {
          const verb =
            change.kind === "add" ? "Created" : change.kind === "delete" ? "Deleted" : "Edited";
          turn.onEvent({
            type: "activity",
            activity: activity("edit", `${verb} ${displayPath(change.path, turn.cwd)}`),
          });
        }
      }
      return;
    }
    const search = WebSearch.safeParse(item);
    if (search.success) {
      if (phase === "item.completed") {
        turn.onEvent({
          type: "activity",
          activity: activity("web", `Searched the web for “${search.data.query ?? ""}”`),
        });
      }
      return;
    }
    const mcp = McpCall.safeParse(item);
    if (mcp.success) {
      if (phase === "item.started") {
        turn.onEvent({
          type: "activity",
          activity: activity("other", `Used ${mcp.data.server ?? "tool"}.${mcp.data.tool ?? ""}`),
        });
      }
      return;
    }
    const failure = ErrorItem.safeParse(item);
    if (failure.success && phase === "item.completed") {
      turn.onEvent({ type: "activity", activity: activity("other", failure.data.message) });
    }
    return;
  }

  if (TurnCompleted.safeParse(raw).success) {
    state.completed = true;
    return;
  }
  const failed = TurnFailed.safeParse(raw);
  if (failed.success) {
    state.failure = failed.data.error?.message ?? "the turn failed";
    return;
  }
  const streamError = StreamError.safeParse(raw);
  if (streamError.success) {
    state.failure = streamError.data.message;
  }
}

export class CodexHarness implements Harness {
  readonly kind = "codex";
  readonly label = "Codex";

  constructor(
    private readonly runner: Runner,
    private readonly bin: string,
  ) {}

  async status(): Promise<HarnessStatus> {
    const base: Pick<HarnessStatus, "kind" | "label" | "models" | "efforts"> = {
      kind: this.kind,
      label: this.label,
      models: ["gpt-5.6-luna"],
      efforts: ["minimal", "low", "medium", "high", "xhigh"],
    };
    try {
      const version = await this.runner.run(this.bin, ["--version"], {
        cwd: "/",
        timeoutMs: 20_000,
      });
      if (version.code !== 0) {
        return { ...base, installed: false, authenticated: false, detail: version.output.trim() };
      }
      const versionText = version.stdout.toString("utf8").trim();
      const login = await this.runner.run(this.bin, ["login", "status"], {
        cwd: "/",
        timeoutMs: 20_000,
      });
      const statusText = login.output.trim().split("\n").at(-1) ?? "";
      return {
        ...base,
        installed: true,
        authenticated: login.code === 0,
        detail: `${versionText} · ${login.code === 0 ? statusText : "not signed in"}`,
      };
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return { ...base, installed: false, authenticated: false, detail: error.message };
      }
      throw error;
    }
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    const common = [
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
    ];
    if (turn.model !== "") common.push("--model", turn.model);
    if (turn.effort !== "") common.push("-c", `model_reasoning_effort="${turn.effort}"`);
    if (!turn.persist) common.push("--ephemeral");

    let schemaFile: string | null = null;
    if (turn.outputSchema !== null) {
      await mkdir(turn.scratchDir, { recursive: true });
      schemaFile = path.join(turn.scratchDir, `schema-${randomBytes(6).toString("hex")}.json`);
      await writeFile(schemaFile, JSON.stringify(turn.outputSchema));
      await chmod(schemaFile, 0o600);
      await this.runner.handOver(schemaFile);
      common.push("--output-schema", schemaFile);
    }

    // Codex has no separate system prompt flag; the instructions open the
    // conversation instead, and a resumed thread already has them.
    const prompt =
      turn.resume === null
        ? `<instructions>\n${turn.instructions}\n</instructions>\n\n${turn.prompt}`
        : turn.prompt;
    const args =
      turn.resume === null
        ? ["exec", ...common, "--cd", turn.cwd, "-"]
        : ["exec", "resume", ...common, turn.resume, "-"];

    const state: CodexStreamState = {
      threadId: null,
      messages: [],
      completed: false,
      failure: null,
    };
    let result;
    try {
      result = await this.runner.run(this.bin, args, {
        cwd: turn.cwd,
        stdin: prompt,
        signal: turn.signal,
        timeoutMs: turn.timeoutMs,
        onStdoutLine: (line) => {
          handleCodexLine(line, state, turn);
        },
      });
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        throw new AgentError("Codex is not installed", error.message);
      }
      throw error;
    } finally {
      if (schemaFile !== null) await rm(schemaFile, { force: true });
    }

    if (result.aborted) throw new AgentError("Cancelled", "", true);
    if (result.timedOut) throw new AgentError("Codex timed out", result.stderr);
    if (state.failure !== null)
      throw new AgentError(`Codex reported an error: ${state.failure}`, result.stderr);
    if (!state.completed && result.code !== 0) {
      throw new AgentError(
        `Codex exited with status ${String(result.code)}`,
        result.stderr.trim() || result.output.trim(),
      );
    }

    const last = state.messages.at(-1) ?? "";
    return {
      sessionId: state.threadId ?? turn.resume,
      text:
        turn.outputSchema === null
          ? state.messages.join("\n\n")
          : state.messages.slice(0, -1).join("\n\n"),
      structured: turn.outputSchema === null ? null : extractJson(last),
      costUsd: null,
    };
  }
}
