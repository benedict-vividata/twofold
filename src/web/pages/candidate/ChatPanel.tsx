import { ArrowRight, CircleAlert, CircleDashed, GitCompareArrows, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CandidateRound, CandidateSession } from "../../../shared/model";
import { errorMessage, type CandidateApi } from "../../api";
import { LogoMark } from "../../components/Logo";
import { MessageView } from "../../components/MessageView";
import { Button, ErrorNote, Kbd, VersionMark, cx } from "../../components/ui";

const SUGGESTIONS = [
  "Give me a quick tour of this codebase.",
  "Where would this change need to go?",
  "What are the trickiest parts of this task?",
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function RoundCard({
  round,
  selected,
  onOpen,
}: {
  round: CandidateRound;
  selected: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  let status: React.JSX.Element;
  switch (round.status) {
    case "generating":
      status = (
        <span className="flex items-center gap-2 text-muted">
          <LogoMark animated className="size-4" /> {round.phase}…
        </span>
      );
      break;
    case "ready":
      status = <span className="font-medium text-ink">Two versions ready to review</span>;
      break;
    case "decided":
      status =
        round.decision?.choice === "reject" ? (
          <span className="flex items-center gap-1.5 text-muted">
            <X className="size-3.5" /> You rejected both
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted">
            <VersionMark size="sm" position={round.decision?.choice === "b" ? "b" : "a"} /> You
            merged version {round.decision?.choice.toUpperCase()}
            {round.decision !== null && round.decision.editedFiles.length > 0 ? " with edits" : ""}
          </span>
        );
      break;
    case "failed":
      status = (
        <span className="flex items-center gap-1.5 text-bad">
          <CircleAlert className="size-3.5" /> No versions produced
        </span>
      );
      break;
    case "cancelled":
      status = (
        <span className="flex items-center gap-1.5 text-muted">
          <CircleDashed className="size-3.5" /> Cancelled
        </span>
      );
      break;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "group w-full rounded-xl border bg-surface px-3.5 py-3 text-left shadow-xs transition hover:border-line-strong",
        selected ? "border-line-strong ring-2 ring-ring/15" : "border-line",
        round.status === "ready" && "border-ring/40",
      )}
    >
      <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wide text-faint">
        <GitCompareArrows className="size-3.5" /> Round {round.number}
      </div>
      <p className="mt-1 line-clamp-2 text-[13px]">{round.request}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px]">
        {status}
        <ArrowRight className="size-3.5 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
      </div>
    </button>
  );
}

export function ChatPanel({
  session,
  api,
  selectedRoundId,
  onOpenRound,
}: {
  session: CandidateSession;
  api: CandidateApi;
  selectedRoundId: string | null;
  onOpenRound: (roundId: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState<"ask" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  const openRound = session.timeline.find(
    (item) => item.type === "round" && (item.status === "generating" || item.status === "ready"),
  );
  const generateBlocked =
    openRound?.type === "round"
      ? openRound.status === "generating"
        ? "Two versions are already being written"
        : "Decide on the current versions first"
      : null;

  // Follow new content, unless the reader has scrolled up.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [session.timeline]);

  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${String(Math.min(element.scrollHeight, 220))}px`;
  }, [draft]);

  const ask = async (): Promise<void> => {
    const text = draft.trim();
    if (text === "" || session.chatBusy) return;
    setSending("ask");
    setError(null);
    try {
      await api.chat(text);
      setDraft("");
      stickToBottom.current = true;
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(null);
    }
  };

  const generate = async (): Promise<void> => {
    const text = draft.trim();
    if (text === "" || generateBlocked !== null) return;
    setSending("generate");
    setError(null);
    try {
      const { id } = await api.generate(text);
      setDraft("");
      stickToBottom.current = true;
      onOpenRound(id);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(null);
    }
  };

  const empty = session.timeline.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        {empty ? (
          <div className="flex h-full flex-col justify-end gap-4 pb-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Your assistant</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Ask about the code, talk through approaches, make a plan. When you want code
                written, press <span className="font-medium text-ink">Generate</span> and you'll get
                two versions to choose between.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setDraft(suggestion);
                    input.current?.focus();
                  }}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-[13px] text-muted shadow-xs transition hover:border-line-strong hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {session.timeline.map((item) =>
              item.type === "message" ? (
                <MessageView key={item.id} message={item} />
              ) : (
                <RoundCard
                  key={item.id}
                  round={item}
                  selected={item.id === selectedRoundId}
                  onOpen={() => {
                    onOpenRound(item.id);
                  }}
                />
              ),
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-surface p-3">
        {error !== null && (
          <div className="mb-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="rounded-xl border border-line-strong bg-surface shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15">
          <textarea
            ref={input}
            rows={2}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (event.metaKey || event.ctrlKey) void generate();
              else void ask();
            }}
            placeholder="Ask a question, or describe a change to generate…"
            className="block max-h-[220px] w-full resize-none bg-transparent focus-visible:outline-none px-3.5 pb-1 pt-3 text-[13.5px] leading-relaxed outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <span className="hidden items-center gap-1 text-[11.5px] text-faint sm:flex">
              <Kbd>↵</Kbd> ask · <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>↵</Kbd> generate
            </span>
            <span className="flex-1" />
            {session.chatBusy ? (
              <Button
                size="sm"
                icon={<Square className="size-3" />}
                onClick={() => {
                  void api.stopChat();
                }}
              >
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                loading={sending === "ask"}
                disabled={draft.trim() === "" || sending !== null}
                onClick={() => {
                  void ask();
                }}
              >
                Ask
              </Button>
            )}
            <span title={generateBlocked ?? "Write this change — you'll get two versions"}>
              <Button
                size="sm"
                variant="primary"
                loading={sending === "generate"}
                disabled={draft.trim() === "" || sending !== null || generateBlocked !== null}
                icon={<GitCompareArrows className="size-3.5" />}
                onClick={() => {
                  void generate();
                }}
              >
                Generate
              </Button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
