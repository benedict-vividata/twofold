import {
  CircleAlert,
  Code2,
  FileText,
  GitCompareArrows,
  MessagesSquare,
  PartyPopper,
  Sparkles,
  SquareTerminal,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandidateSession, JUSTIFICATION_TAGS, type Position } from "../../../shared/model";
import { ApiError, candidateApi, errorMessage, useLive, type CandidateApi } from "../../api";
import { CodeBrowser } from "../../components/CodeBrowser";
import { Logo, LogoMark } from "../../components/Logo";
import { Markdown } from "../../components/Markdown";
import { ReviewPanel } from "../../components/ReviewPanel";
import { ThemeToggle } from "../../components/ThemeToggle";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Spinner,
  VersionMark,
  cx,
} from "../../components/ui";
import { ChatPanel } from "./ChatPanel";
import { CodeVersionBar, type CodeVersion } from "./CodeVersionBar";
import { TerminalPanel } from "./TerminalPanel";

type Tab = "chat" | "task" | "code" | "review";

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex min-h-full items-center justify-center p-6">{children}</div>;
}

const STEPS = [
  {
    icon: <MessagesSquare className="size-4" />,
    title: "Talk it through",
    text: "Use the assistant to explore the code, ask questions and plan your approach.",
  },
  {
    icon: <GitCompareArrows className="size-4" />,
    title: "Generate",
    text: "When you want code written, press Generate. Every change arrives as two versions, A and B.",
  },
  {
    icon: <Sparkles className="size-4" />,
    title: "Choose, and say why",
    text: "Read both. Merge the one you would ship — editing it first if you like — or reject both. Explain your call.",
  },
];

function Welcome({
  session,
  api,
}: {
  session: CandidateSession;
  api: CandidateApi;
}): React.JSX.Element {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="min-h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col px-6 py-14">
        <Logo />
        <h1 className="mt-10 text-[26px] font-semibold tracking-tight">
          {session.candidateName === "" ? "Welcome" : `Welcome, ${session.candidateName}`}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          This is a coding exercise with an AI assistant ({session.assistant}). We're interested in
          how you judge code, not how fast you type.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Card key={step.title} className="p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-faint">
                <span className="flex size-6 items-center justify-center rounded-md bg-surface-2 text-muted">
                  {step.icon}
                </span>
                Step {index + 1}
              </div>
              <h3 className="mt-3 text-[14px] font-semibold">{step.title}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{step.text}</p>
            </Card>
          ))}
        </div>

        <p className="mt-5 text-[13px] leading-relaxed text-muted">
          There's no trick to which version is A and which is B, and nobody is timing you. The
          assistant can't see the versions — the call is yours.
        </p>

        <Card className="mt-8 p-5">
          <div className="mb-3 text-[11.5px] font-medium uppercase tracking-wide text-faint">
            Your task
          </div>
          <h2 className="mb-2 text-[17px] font-semibold tracking-tight">{session.title}</h2>
          <Markdown className="text-[13.5px]">{session.brief}</Markdown>
        </Card>

        {error !== null && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="mt-8 flex items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            loading={starting}
            onClick={() => {
              setStarting(true);
              setError(null);
              api
                .start()
                .catch((failure: unknown) => {
                  setError(errorMessage(failure));
                })
                .finally(() => {
                  setStarting(false);
                });
            }}
          >
            Start the exercise
          </Button>
          <span className="text-[12.5px] text-faint">
            Your conversation and choices are shared with your interviewer.
          </span>
        </div>
      </div>
    </div>
  );
}

function Finished({ session }: { session: CandidateSession }): React.JSX.Element {
  const rounds = session.timeline.flatMap((item) =>
    item.type === "round" && item.decision !== null ? [item] : [],
  );
  return (
    <Centered>
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-surface shadow-xs">
          <PartyPopper className="size-5 text-muted" />
        </div>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight">That's a wrap</h1>
        <p className="mt-2 text-[14px] text-muted">
          Thanks{session.candidateName === "" ? "" : `, ${session.candidateName}`}. Your interviewer
          will walk through your choices with you.
        </p>
        {rounds.length > 0 && (
          <Card className="mt-8 divide-y divide-line text-left">
            {rounds.map((round) => (
              <div key={round.id} className="flex items-start gap-3 px-4 py-3">
                {round.decision?.choice === "a" || round.decision?.choice === "b" ? (
                  <VersionMark position={round.decision.choice} />
                ) : (
                  <span className="flex size-5.5 items-center justify-center rounded-md bg-surface-3 text-muted">
                    <X className="size-3.5" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="line-clamp-1 text-[13px] font-medium">{round.request}</p>
                  {round.decision?.note !== undefined && round.decision.note !== "" && (
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">
                      {round.decision.note}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </Centered>
  );
}

function Workspace({
  session,
  api,
  token,
}: {
  session: CandidateSession;
  api: CandidateApi;
  token: string;
}): React.JSX.Element {
  const rounds = session.timeline.flatMap((item) => (item.type === "round" ? [item] : []));
  const latest = rounds.at(-1);
  const [tab, setTab] = useState<Tab>("task");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(latest?.id ?? null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Ctrl+` shows and hides the terminal, as in most editors.
  useEffect(() => {
    if (!session.terminal) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [session.terminal]);
  const [finishing, setFinishing] = useState(false);

  // Bring a round forward when it starts and again when its versions are ready.
  const seen = useRef(new Map(rounds.map((round) => [round.id, round.status])));
  useEffect(() => {
    for (const round of rounds) {
      const before = seen.current.get(round.id);
      if (before === undefined && round.status === "generating") {
        setSelectedRoundId(round.id);
        setTab((current) => (current === "chat" ? current : "review"));
      }
      if (before === "generating" && round.status === "ready") {
        setSelectedRoundId(round.id);
        setTab("review");
      }
      seen.current.set(round.id, round.status);
    }
  }, [rounds]);

  const selected = rounds.find((round) => round.id === selectedRoundId) ?? latest;
  const loadFiles = useCallback(
    (position: Position) => api.variant(selected?.id ?? "", position),
    [api, selected?.id],
  );
  const pendingRound = rounds.find((round) => round.status === "ready");
  const pending = pendingRound !== undefined;

  // While two versions await a decision, the code tab can show either one in
  // context. The choice starts at "None" for every new pair.
  const [codeVersion, setCodeVersion] = useState<CodeVersion>("none");
  const [codeVersionFor, setCodeVersionFor] = useState(pendingRound?.id);
  if (pendingRound?.id !== codeVersionFor) {
    setCodeVersionFor(pendingRound?.id);
    setCodeVersion("none");
  }
  const browsing: Position | null =
    pendingRound === undefined || codeVersion === "none" ? null : codeVersion;
  const [focus, setFocus] = useState<{ path: string; nonce: number } | null>(null);

  const loadTree = useCallback((path: string) => api.tree(path, browsing), [api, browsing]);
  const loadFile = useCallback((path: string) => api.file(path, browsing), [api, browsing]);
  const merged = rounds.filter(
    (round) => round.decision !== null && round.decision.choice !== "reject",
  ).length;
  const revision = `${String(merged)}:${pendingRound?.id ?? ""}:${browsing ?? "none"}`;

  const tabs: { value: Tab; label: string; icon: React.JSX.Element; mobileOnly?: boolean }[] = [
    {
      value: "chat",
      label: "Assistant",
      icon: <MessagesSquare className="size-3.5" />,
      mobileOnly: true,
    },
    { value: "task", label: "Task", icon: <FileText className="size-3.5" /> },
    { value: "code", label: "Code", icon: <Code2 className="size-3.5" /> },
    { value: "review", label: "Review", icon: <GitCompareArrows className="size-3.5" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <Logo />
        <span className="hidden h-5 w-px bg-line sm:block" />
        <span className="hidden min-w-0 truncate text-[13.5px] font-medium text-muted sm:block">
          {session.title}
        </span>
        <span className="flex-1" />
        <Badge className="hidden md:inline-flex">{session.assistant}</Badge>
        <ThemeToggle />
        <Button
          size="sm"
          onClick={() => {
            setConfirmFinish(true);
          }}
        >
          Finish
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cx(
            "min-h-0 w-full shrink-0 flex-col border-r border-line bg-bg lg:flex lg:w-[400px] xl:w-[440px]",
            tab === "chat" ? "flex" : "hidden",
          )}
        >
          <ChatPanel
            session={session}
            api={api}
            selectedRoundId={selected?.id ?? null}
            onOpenRound={(id) => {
              setSelectedRoundId(id);
              setTab("review");
            }}
          />
        </aside>

        <main className={cx("min-w-0 flex-1 flex-col", tab === "chat" ? "hidden lg:flex" : "flex")}>
          <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
            {tabs.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setTab(item.value);
                }}
                className={cx(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition",
                  item.mobileOnly === true && "lg:hidden",
                  tab === item.value ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
                )}
              >
                {item.icon}
                {item.label}
                {item.value === "review" && pending && (
                  <span className="size-1.5 rounded-full bg-b" />
                )}
              </button>
            ))}
            {session.terminal && (
              <button
                type="button"
                title="Terminal (Ctrl+`)"
                aria-pressed={terminalOpen}
                onClick={() => {
                  setTerminalOpen(!terminalOpen);
                }}
                className={cx(
                  "ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition",
                  terminalOpen ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
                )}
              >
                <SquareTerminal className="size-3.5" />
                Terminal
              </button>
            )}
          </nav>
          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "task" && (
              <div className="h-full overflow-y-auto">
                <div className="mx-auto max-w-3xl px-6 py-8">
                  <h1 className="mb-4 text-[20px] font-semibold tracking-tight">{session.title}</h1>
                  <Markdown className="text-[14px]">{session.brief}</Markdown>
                </div>
              </div>
            )}
            {tab === "code" && (
              <CodeBrowser
                loadTree={loadTree}
                loadFile={loadFile}
                revision={revision}
                focus={focus}
                toolbar={
                  pending ? <CodeVersionBar value={codeVersion} onChange={setCodeVersion} /> : null
                }
              />
            )}
            {(tab === "review" || tab === "chat") &&
              (selected === undefined ? (
                <EmptyState
                  icon={<GitCompareArrows className="size-5" />}
                  title="Nothing to review yet"
                >
                  Describe a change in the chat and press Generate. Two versions will appear here.
                </EmptyState>
              ) : (
                <ReviewPanel
                  key={selected.id}
                  round={selected}
                  loadFiles={loadFiles}
                  decide={{
                    tags: JUSTIFICATION_TAGS,
                    requireNote: session.requireNote,
                    submit: async (input) => {
                      await api.decide(selected.id, input);
                    },
                  }}
                  onCancel={() => {
                    void api.cancelRound(selected.id);
                  }}
                  onRetry={() => {
                    void api.generate(selected.request).then(({ id }) => {
                      setSelectedRoundId(id);
                    });
                  }}
                  onOpenInContext={(position, path) => {
                    setCodeVersion(position);
                    setFocus({ path, nonce: Date.now() });
                    setTab("code");
                  }}
                />
              ))}
          </div>
          {session.terminal && terminalOpen && (
            <TerminalPanel
              token={token}
              pending={pending}
              onHide={() => {
                setTerminalOpen(false);
              }}
            />
          )}
        </main>
      </div>

      <Dialog
        open={confirmFinish}
        onClose={() => {
          setConfirmFinish(false);
        }}
        title="Finish the exercise?"
        description="You won't be able to make further changes. Your interviewer will go through your choices with you."
        footer={
          <>
            <Button
              onClick={() => {
                setConfirmFinish(false);
              }}
            >
              Keep working
            </Button>
            <Button
              variant="primary"
              loading={finishing}
              onClick={() => {
                setFinishing(true);
                void api.finish().finally(() => {
                  setFinishing(false);
                  setConfirmFinish(false);
                });
              }}
            >
              Finish
            </Button>
          </>
        }
      />
    </div>
  );
}

export function CandidatePage({ token }: { token: string }): React.JSX.Element {
  const api = useMemo(() => candidateApi(token), [token]);
  const [initial, setInitial] = useState<CandidateSession | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    api
      .session()
      .then(setInitial)
      .catch((failure: unknown) => {
        setFatal(
          failure instanceof ApiError && failure.status === 404
            ? "This link isn't valid."
            : errorMessage(failure),
        );
      });
  }, [api]);

  const live = useLive(initial === null ? null : api.eventsUrl, CandidateSession);
  const session = live.data ?? initial;

  useEffect(() => {
    document.title = session === null ? "Twofold" : `${session.title} · Twofold`;
  }, [session]);

  if (fatal !== null) {
    return (
      <Centered>
        <EmptyState icon={<CircleAlert className="size-5" />} title={fatal}>
          Check the link your interviewer sent you.
        </EmptyState>
      </Centered>
    );
  }
  if (session === null) {
    return (
      <Centered>
        <Spinner className="size-5 text-faint" />
      </Centered>
    );
  }

  let content: React.JSX.Element;
  switch (session.status) {
    case "provisioning":
      content = (
        <Centered>
          <div className="flex flex-col items-center text-center">
            <LogoMark animated className="size-12" />
            <h1 className="mt-5 text-[17px] font-semibold">Preparing your workspace</h1>
            <p className="mt-1 text-[13px] text-muted">
              This takes a moment. The page updates by itself.
            </p>
          </div>
        </Centered>
      );
      break;
    case "failed":
      content = (
        <Centered>
          <EmptyState
            icon={<CircleAlert className="size-5" />}
            title="This session couldn't be set up"
          >
            Let your interviewer know — they can see what went wrong.
          </EmptyState>
        </Centered>
      );
      break;
    case "ready":
      content = <Welcome session={session} api={api} />;
      break;
    case "active":
      content = <Workspace session={session} api={api} token={token} />;
      break;
    case "finished":
      content = <Finished session={session} />;
      break;
  }

  return (
    <div className="h-full">
      {content}
      {!live.connected && initial !== null && session.status === "active" && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-muted shadow-card">
          <WifiOff className="size-3.5" /> Reconnecting…
        </div>
      )}
    </div>
  );
}
