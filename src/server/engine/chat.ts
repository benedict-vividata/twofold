import { randomBytes } from "node:crypto";
import type { Message, Session } from "../../shared/model.js";
import { AgentError, type Harness } from "../agents/types.js";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import type { SessionStore } from "../store.js";
import { ACCEPTED_BRANCH, type Workspaces } from "../workspace.js";
import { chatInstructions, chatPrompt, transcript } from "./prompts.js";

function newMessage(role: Message["role"], text: string, status: Message["status"]): Message {
  return {
    type: "message",
    id: randomBytes(8).toString("hex"),
    role,
    createdAt: new Date().toISOString(),
    status,
    parts: text === "" ? [] : [{ kind: "text", text }],
    error: null,
  };
}

/**
 * The conversation with the assistant. Each turn runs in the session's main
 * checkout, reset to the accepted code first, so anything the assistant
 * changes in chat is thrown away before the next turn.
 */
export class ChatEngine {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly config: Config,
    private readonly store: SessionStore,
    private readonly workspaces: Workspaces,
    private readonly harnessFor: (session: Session) => Harness,
  ) {}

  send(sessionId: string, text: string): void {
    const session = this.store.get(sessionId);
    if (session === undefined) throw new Error("no session");
    // The conversation as it stood before this message, in case the agent has
    // to start a fresh thread and needs to be told what came before.
    const earlier = session.timeline.some((item) => item.type === "message")
      ? transcript(session)
      : null;
    const notices = [...session.chat.pendingNotices];
    const question = newMessage("candidate", text, "done");
    const answer = newMessage("assistant", "", "streaming");
    this.store.update(sessionId, (draft) => {
      draft.timeline.push(question, answer);
      draft.chat.busy = true;
      draft.chat.pendingNotices = [];
    });
    this.run(sessionId, answer.id, text, notices, earlier).catch((error: unknown) => {
      logger.error(`chat turn in ${sessionId} crashed: ${String(error)}`);
    });
  }

  cancel(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  private updateMessage(
    sessionId: string,
    messageId: string,
    mutate: (message: Message) => void,
  ): void {
    this.store.update(sessionId, (session) => {
      const message = session.timeline.find(
        (item) => item.type === "message" && item.id === messageId,
      );
      if (message?.type === "message") mutate(message);
    });
  }

  private async run(
    sessionId: string,
    messageId: string,
    text: string,
    notices: string[],
    earlier: string | null,
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    let resume: string | null = null;
    try {
      const session = this.store.get(sessionId);
      if (session?.headCommit == null) throw new Error("The session has no code yet.");
      resume = session.chat.agentSessionId;
      const repo = this.workspaces.paths(sessionId).repo;
      await this.workspaces.git.resetBranch(repo, ACCEPTED_BRANCH, session.headCommit);

      let prompt = chatPrompt(notices, text);
      if (resume === null && earlier !== null) {
        prompt = `<earlier_conversation>\n${earlier}\n</earlier_conversation>\n\n${prompt}`;
      }

      const result = await this.harnessFor(session).run({
        purpose: "chat",
        cwd: repo,
        prompt,
        instructions: chatInstructions(session),
        mode: "chat",
        resume,
        persist: true,
        outputSchema: null,
        scratchDir: this.workspaces.paths(sessionId).scratch,
        model: session.config.harness.model,
        effort: session.config.harness.effort,
        signal: controller.signal,
        timeoutMs: this.config.agentTimeoutMs,
        onEvent: (event) => {
          this.updateMessage(sessionId, messageId, (message) => {
            const last = message.parts.at(-1);
            if (event.type === "text") {
              if (last?.kind === "text") last.text = `${last.text}\n\n${event.text}`;
              else message.parts.push({ kind: "text", text: event.text });
            } else {
              message.parts.push({ kind: "activity", activity: event.activity });
            }
          });
        },
      });

      this.store.update(sessionId, (draft) => {
        draft.chat.busy = false;
        draft.chat.agentSessionId = result.sessionId;
        const message = draft.timeline.find(
          (item) => item.type === "message" && item.id === messageId,
        );
        if (message?.type !== "message") return;
        if (!message.parts.some((part) => part.kind === "text") && result.text.trim() !== "") {
          message.parts.push({ kind: "text", text: result.text });
        }
        message.status = "done";
      });
    } catch (error) {
      const cancelled =
        controller.signal.aborted || (error instanceof AgentError && error.cancelled);
      if (!cancelled) logger.warn(`chat turn failed in ${sessionId}: ${String(error)}`);
      this.store.update(sessionId, (draft) => {
        draft.chat.busy = false;
        // A failed resume usually means the agent lost the thread; start a new
        // one next time (the transcript goes with it). Undelivered context
        // notes are kept for the next turn.
        if (resume !== null && !cancelled) draft.chat.agentSessionId = null;
        draft.chat.pendingNotices = [...notices, ...draft.chat.pendingNotices];
        const message = draft.timeline.find(
          (item) => item.type === "message" && item.id === messageId,
        );
        if (message?.type !== "message") return;
        message.status = cancelled ? "done" : "error";
        message.error = cancelled
          ? "Stopped."
          : error instanceof Error
            ? error.message
            : String(error);
      });
    } finally {
      this.controllers.delete(sessionId);
    }
  }
}
