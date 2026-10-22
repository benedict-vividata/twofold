import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./types.js";
import { extractJson } from "./types.js";
import { handleClaudeLine, type ClaudeStreamState } from "./claude.js";
import { handleCodexLine, type CodexStreamState } from "./codex.js";

function collect() {
  const events: AgentEvent[] = [];
  return {
    events,
    turn: { cwd: "/work/repo", onEvent: (event: AgentEvent) => events.push(event) },
  };
}

describe("Claude stream-json", () => {
  it("tracks the session, text, tool calls and the result", () => {
    const { events, turn } = collect();
    const state: ClaudeStreamState = { sessionId: null, texts: [], result: null };
    const lines = [
      { type: "system", subtype: "init", session_id: "s-1", tools: [] },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Read",
              input: { file_path: "/work/repo/src/app.ts" },
            },
            {
              type: "tool_use",
              id: "t2",
              name: "Bash",
              input: { command: "npm test", description: "Run tests" },
            },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "..." }] },
      },
      {
        type: "assistant",
        parent_tool_use_id: "t9",
        message: { content: [{ type: "text", text: "subagent noise" }] },
      },
      { type: "assistant", message: { content: [{ type: "text", text: "All done." }] } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t3", name: "StructuredOutput", input: { summary: "x" } },
          ],
        },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: '{"summary":"x"}',
        structured_output: { summary: "x" },
        session_id: "s-1",
        total_cost_usd: 0.01,
      },
    ];
    for (const line of lines) handleClaudeLine(JSON.stringify(line), state, turn);
    handleClaudeLine("not json", state, turn);

    expect(state.sessionId).toBe("s-1");
    expect(state.texts).toEqual(["All done."]);
    expect(state.result?.structured_output).toEqual({ summary: "x" });
    expect(
      events.map((event) =>
        event.type === "text" ? ["text", event.text] : [event.activity.kind, event.activity.label],
      ),
    ).toEqual([
      ["read", "Read src/app.ts"],
      ["command", "Run tests"],
      ["text", "All done."],
    ]);
  });
});

describe("Codex exec --json", () => {
  it("tracks the thread, messages, commands and file changes", () => {
    const { events, turn } = collect();
    const state: CodexStreamState = {
      threadId: null,
      messages: [],
      completed: false,
      failure: null,
    };
    const lines = [
      { type: "thread.started", thread_id: "th-1" },
      { type: "turn.started" },
      {
        type: "item.started",
        item: {
          id: "i0",
          type: "command_execution",
          command: "rg paginate",
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: { id: "i0", type: "command_execution", command: "rg paginate", exit_code: 0 },
      },
      { type: "item.completed", item: { id: "i1", type: "reasoning", text: "thinking" } },
      {
        type: "item.completed",
        item: {
          id: "i2",
          type: "file_change",
          changes: [{ path: "/work/repo/src/a.ts", kind: "update" }],
        },
      },
      {
        type: "item.completed",
        item: { id: "i3", type: "agent_message", text: '{"summary":"ok"}' },
      },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    for (const line of lines) handleCodexLine(JSON.stringify(line), state, turn);

    expect(state.threadId).toBe("th-1");
    expect(state.completed).toBe(true);
    expect(state.failure).toBeNull();
    expect(state.messages).toEqual(['{"summary":"ok"}']);
    expect(
      events.map((event) => (event.type === "text" ? event.text : event.activity.label)),
    ).toEqual(["Ran rg paginate", "Edited src/a.ts", '{"summary":"ok"}']);
  });

  it("records a failed turn", () => {
    const { turn } = collect();
    const state: CodexStreamState = {
      threadId: null,
      messages: [],
      completed: false,
      failure: null,
    };
    handleCodexLine(
      JSON.stringify({ type: "turn.failed", error: { message: "usage limit reached" } }),
      state,
      turn,
    );
    expect(state.failure).toBe("usage limit reached");
  });
});

describe("extractJson", () => {
  it("finds JSON in a fenced block or bare braces", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"b": [1,2]} suffix')).toEqual({ b: [1, 2] });
    expect(extractJson("no json here")).toBeNull();
  });
});
