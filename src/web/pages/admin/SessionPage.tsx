import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  GitCompareArrows,
  Lightbulb,
  MapPin,
  PencilLine,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  AdminSessionView,
  HARNESS_LABELS,
  PAIR_KIND_LABELS,
  type AgentRun,
  type CandidateRound,
  type Position,
  type Round,
  type Session,
  type Variant,
} from "../../../shared/model";
import { outcome } from "../../../shared/outcome";
import { adminApi, errorMessage, useLive } from "../../api";
import { ActivityLine } from "../../components/Activity";
import { Markdown } from "../../components/Markdown";
import { MessageView } from "../../components/MessageView";
import { CheckPill, ReviewPanel } from "../../components/ReviewPanel";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Spinner,
  VersionMark,
  buttonClass,
  cx,
  type Tone,
} from "../../components/ui";
import { clock, duration, plural, redactUrl } from "../../lib/format";
import { SessionStatusBadge } from "./status";

/** The candidate's shape of a round, for the shared review panel. */
function toReviewRound(round: Round): CandidateRound {
  return {
    type: "round",
    id: round.id,
    number: round.number,
    request: round.request,
    createdAt: round.createdAt,
    status: round.status,
    phase: round.phase,
    error: round.error,
    variants:
      round.variants === null
        ? null
        : {
            a: { stats: round.variants.a.stats, check: round.variants.a.check },
            b: { stats: round.variants.b.stats, check: round.variants.b.check },
          },
    decision:
      round.decision === null
        ? null
        : {
            choice: round.decision.choice,
            tags: round.decision.tags,
            note: round.decision.note,
            editedFiles: round.decision.edited?.files ?? [],
            decidedAt: round.decision.decidedAt,
          },
  };
}

function roleTone(variant: Variant): Tone {
  switch (variant.role) {
    case "reference":
      return "ok";
    case "degraded":
      return "warn";
    case "stance":
      return "info";
  }
}

function RoleBadge({ variant }: { variant: Variant }): React.JSX.Element {
  const text =
    variant.role === "reference"
      ? "Reference"
      : variant.role === "degraded"
        ? (variant.degradation?.name ?? "Degraded")
        : (variant.stance?.label ?? "Stance");
  return <Badge tone={roleTone(variant)}>{text}</Badge>;
}

function outcomeTone(round: Round): Tone {
  const decision = round.decision;
  if (decision === null || round.variants === null) return "neutral";
  if (decision.choice === "reject") return round.pairKind === "both-flawed" ? "ok" : "info";
  if (round.pairKind === "degraded")
    return round.variants[decision.choice].role === "reference" ? "ok" : "warn";
  return "neutral";
}

function VariantSummary({
  position,
  variant,
  chosen,
}: {
  position: Position;
  variant: Variant;
  chosen: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-2.5",
        chosen
          ? position === "a"
            ? "border-a/50 bg-a-soft/40"
            : "border-b/50 bg-b-soft/40"
          : "border-line bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <VersionMark position={position} size="sm" />
        <RoleBadge variant={variant} />
        {chosen && <Check className={cx("size-3.5", position === "a" ? "text-a" : "text-b")} />}
        <span className="ml-auto font-mono text-[11px] text-muted tabular-nums">
          <span className="text-ok">+{variant.stats.additions}</span>{" "}
          <span className="text-bad">−{variant.stats.deletions}</span> ·{" "}
          {plural(variant.stats.files, "file")}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <CheckPill status={variant.check.status} />
      </div>
    </div>
  );
}

function RunLog({ run }: { run: AgentRun }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const elapsed =
    run.endedAt === null
      ? null
      : duration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime());
  const tone: Tone =
    run.status === "done"
      ? "ok"
      : run.status === "running"
        ? "info"
        : run.status === "failed"
          ? "bad"
          : "neutral";
  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2"
      >
        <ChevronRight className={cx("size-3.5 text-faint transition", open && "rotate-90")} />
        <span className="font-medium">{run.label}</span>
        <Badge tone={tone}>
          {run.status === "running" ? <Spinner className="size-3" /> : null}
          {run.status}
        </Badge>
        <span className="ml-auto text-[11.5px] text-faint">
          {plural(run.activity.length, "step")}
          {elapsed !== null && ` · ${elapsed}`}
          {run.costUsd !== null && ` · $${run.costUsd.toFixed(2)}`}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {run.activity.length === 0 ? (
              <span className="text-[12px] text-faint">No tool activity.</span>
            ) : (
              run.activity.map((activity, index) => (
                <ActivityLine key={`${activity.at}-${String(index)}`} activity={activity} />
              ))
            )}
          </div>
          {run.error !== null && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-bad-soft p-2 font-mono text-[11px] text-bad">
              {run.error}
            </pre>
          )}
          {run.finalText !== "" && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 font-mono text-[11px] text-muted">
              {run.finalText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function RoundCard({
  round,
  onView,
  onCancel,
}: {
  round: Round;
  onView: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [showRuns, setShowRuns] = useState(false);
  const variants = round.variants;
  const decision = round.decision;
  const positions: Position[] = ["a", "b"];
  const points = [
    ...new Set(
      variants === null
        ? []
        : positions.flatMap((position) => [
            ...(variants[position].degradation?.talkingPoints ?? []),
            ...(variants[position].stance?.talkingPoints ?? []),
          ]),
    ),
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5">
        <GitCompareArrows className="size-3.5 text-muted" />
        <span className="text-[13px] font-semibold">Round {round.number}</span>
        <Badge>{PAIR_KIND_LABELS[round.pairKind]}</Badge>
        {round.status === "generating" && (
          <Badge tone="info" icon={<Spinner className="size-3" />}>
            {round.phase}
          </Badge>
        )}
        {round.status === "ready" && <Badge tone="b">Awaiting decision</Badge>}
        {round.status === "failed" && <Badge tone="bad">Failed</Badge>}
        {round.status === "cancelled" && <Badge>Cancelled</Badge>}
        <span className="ml-auto text-[11.5px] text-faint">{clock(round.createdAt)}</span>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <blockquote className="border-l-2 border-line-strong pl-3 text-[13.5px] leading-relaxed">
          {round.request}
        </blockquote>

        {round.error !== null && <ErrorNote>{round.error}</ErrorNote>}

        {variants !== null && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {positions.map((position) => (
              <VariantSummary
                key={position}
                position={position}
                variant={variants[position]}
                chosen={decision?.choice === position}
              />
            ))}
          </div>
        )}

        {variants !== null &&
          positions.map((position) => {
            const flaw = variants[position].degradation;
            const stance = variants[position].stance;
            if (flaw !== null) {
              return (
                <div key={position} className="rounded-lg bg-warn-soft/60 px-3.5 py-3 text-[13px]">
                  <div className="flex items-center gap-2 font-medium">
                    <VersionMark position={position} size="sm" /> {flaw.name}
                  </div>
                  {flaw.summary !== "" && (
                    <p className="mt-1.5 leading-relaxed text-muted">{flaw.summary}</p>
                  )}
                  {flaw.locations.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {flaw.locations.map((location, index) => (
                        <li key={index} className="flex items-start gap-1.5 text-[12px] text-muted">
                          <MapPin className="mt-0.5 size-3 shrink-0 text-faint" />
                          <span>
                            <code className="font-mono text-[11.5px] text-ink">
                              {location.file}
                              {location.line === null ? "" : `:${String(location.line)}`}
                            </code>{" "}
                            — {location.note}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            }
            if (stance !== null && stance.summary !== "") {
              return (
                <div key={position} className="rounded-lg bg-info-soft/60 px-3.5 py-3 text-[13px]">
                  <div className="flex items-center gap-2 font-medium">
                    <VersionMark position={position} size="sm" /> {stance.label}
                  </div>
                  <p className="mt-1.5 leading-relaxed text-muted">{stance.summary}</p>
                </div>
              );
            }
            return null;
          })}

        {decision !== null && (
          <div className="rounded-lg border border-line px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {decision.choice === "reject" ? (
                <span className="flex size-5.5 items-center justify-center rounded-md bg-surface-3 text-muted">
                  <X className="size-3.5" />
                </span>
              ) : (
                <VersionMark position={decision.choice} />
              )}
              <Badge tone={outcomeTone(round)}>{outcome(round)}</Badge>
              {decision.edited !== null && (
                <span title={decision.edited.files.join("\n")}>
                  <Badge tone="warn" icon={<PencilLine className="size-3" />}>
                    edited {plural(decision.edited.files.length, "file")} by hand
                  </Badge>
                </span>
              )}
              {decision.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
              <span className="ml-auto text-[11.5px] text-faint">{clock(decision.decidedAt)}</span>
            </div>
            {decision.note !== "" && (
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">
                “{decision.note}”
              </p>
            )}
          </div>
        )}

        {points.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">
              <Lightbulb className="size-3.5" /> Ask about
            </div>
            <ul className="flex flex-col gap-1 text-[13px] text-muted">
              {points.map((point) => (
                <li key={point} className="flex gap-2">
                  <span className="text-faint">•</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {variants !== null && (
            <Button size="sm" icon={<GitCompareArrows className="size-3.5" />} onClick={onView}>
              View versions
            </Button>
          )}
          {round.runs.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowRuns(!showRuns);
              }}
            >
              {showRuns ? "Hide" : "Show"} generation log ({round.runs.length})
            </Button>
          )}
          {round.status === "generating" && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Square className="size-3" />}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
        </div>

        {showRuns && (
          <div className="flex flex-col gap-1.5">
            {round.runs.map((run) => (
              <RunLog key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-[11.5px] font-medium uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[12.5px]">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}

function CopyLink({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <code
        className="block truncate rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11.5px] text-muted"
        title={url}
      >
        {url}
      </code>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a href={url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
          <ExternalLink className="size-3.5" /> Open
        </a>
      </div>
    </div>
  );
}

function describeRepo(session: Session): string {
  const repo = session.config.repo;
  switch (repo.kind) {
    case "sample":
      return `Sample · ${repo.name}`;
    case "git":
      return redactUrl(repo.url);
    case "local":
      return `Local · ${repo.path}`;
  }
}

function Sidebar({
  session,
  candidateUrl,
}: {
  session: Session;
  candidateUrl: string;
}): React.JSX.Element {
  const rounds = session.timeline.flatMap((item) => (item.type === "round" ? [item] : []));
  const [showBaseline, setShowBaseline] = useState(false);
  const config = session.config;
  return (
    <div className="flex flex-col gap-4">
      {(session.status === "ready" || session.status === "active") && (
        <SideCard title="Candidate link">
          <CopyLink url={candidateUrl} />
          <p className="mt-2 text-[11.5px] text-faint">
            Anyone with this link can work in the session.
          </p>
        </SideCard>
      )}

      {rounds.length > 0 && (
        <SideCard title="At a glance">
          <ul className="flex flex-col gap-2">
            {rounds.map((round) => (
              <li key={round.id} className="flex items-start gap-2 text-[12.5px]">
                <span className="w-5 shrink-0 font-mono text-[11px] text-faint">
                  {round.number}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{round.request}</span>
                  <span className="text-muted">{outcome(round)}</span>
                </span>
              </li>
            ))}
          </ul>
        </SideCard>
      )}

      <SideCard title="Setup">
        <div className="divide-y divide-line">
          <Row label="Repository">{describeRepo(session)}</Row>
          {(config.repo.kind === "git" || config.repo.kind === "local") &&
            config.repo.ref !== "" && <Row label="Ref">{config.repo.ref}</Row>}
          {session.baseCommit !== null && (
            <Row label="Base">
              <code className="font-mono text-[11.5px]">{session.baseCommit.slice(0, 10)}</code>
            </Row>
          )}
          <Row label="Assistant">
            {HARNESS_LABELS[config.harness.kind]}
            {config.harness.model !== "" && ` · ${config.harness.model}`}
            {config.harness.effort !== "" && ` · ${config.harness.effort}`}
          </Row>
          {config.commands.setup !== "" && (
            <Row label="Setup">
              <code className="font-mono text-[11.5px]">{config.commands.setup}</code>
            </Row>
          )}
          <Row label="Check">
            {config.commands.check === "" ? (
              <span className="text-faint">none</span>
            ) : (
              <code className="font-mono text-[11.5px]">{config.commands.check}</code>
            )}
          </Row>
          {session.baseline !== null && (
            <Row label="Baseline">
              <button
                type="button"
                onClick={() => {
                  setShowBaseline(!showBaseline);
                }}
              >
                <CheckPill status={session.baseline.status} />
              </button>
            </Row>
          )}
          <Row label="Justification">{config.requireNote ? "required" : "optional"}</Row>
        </div>
        {showBaseline && session.baseline !== null && (
          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] text-muted">
            {session.baseline.output}
          </pre>
        )}
      </SideCard>

      {config.privateNotes.trim() !== "" && (
        <SideCard title="Your notes">
          <Markdown className="text-[13px]">{config.privateNotes}</Markdown>
        </SideCard>
      )}
    </div>
  );
}

export function SessionPage({ id }: { id: string }): React.JSX.Element {
  const [, navigate] = useLocation();
  const [initial, setInitial] = useState<AdminSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .session(id)
      .then(setInitial)
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
      });
  }, [id]);

  const live = useLive(initial === null ? null : adminApi.eventsUrl(id), AdminSessionView);
  const view = live.data ?? initial;
  const session = view?.session;

  useEffect(() => {
    if (session !== undefined) {
      document.title = `${session.config.candidateName || session.config.title} · Twofold`;
    }
  }, [session]);

  const viewingRound = session?.timeline.find(
    (item) => item.type === "round" && item.id === viewing,
  );

  useEffect(() => {
    if (viewing === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setViewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [viewing]);
  const loadFiles = useCallback(
    (position: Position) => adminApi.variant(id, viewing ?? "", position),
    [id, viewing],
  );

  if (error !== null) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10">
        <EmptyState icon={<CircleAlert className="size-5" />} title="Couldn't load this session">
          {error}
        </EmptyState>
      </div>
    );
  }
  if (view === null || session === undefined) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-5 text-faint" />
      </div>
    );
  }

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(label);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-8">
      <Link
        href="/sessions"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" /> Sessions
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-tight">
              {session.config.candidateName === ""
                ? "Unnamed candidate"
                : session.config.candidateName}
            </h1>
            <SessionStatusBadge status={session.status} />
          </div>
          <p className="mt-0.5 text-[13.5px] text-muted">{session.config.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={adminApi.reportUrl(id)} className={buttonClass("secondary")}>
            <Download className="size-3.5" /> Report
          </a>
          <Link href={`/sessions/new?from=${id}`} className={buttonClass("ghost")}>
            <RotateCcw className="size-3.5" /> Reuse setup
          </Link>
          {session.status === "active" && (
            <Button
              loading={busy === "finish"}
              onClick={() => void run("finish", () => adminApi.finish(id))}
            >
              End session
            </Button>
          )}
          <Button
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {(session.status === "provisioning" || session.status === "failed") && (
        <Card className="mt-6 p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {session.status === "provisioning" ? (
              <Spinner className="size-3.5" />
            ) : (
              <CircleAlert className="size-4 text-bad" />
            )}
            {session.statusDetail}
          </div>
          {session.provisionLog !== "" && (
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-muted">
              {session.provisionLog}
            </pre>
          )}
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {session.timeline.length === 0 ? (
            <Card>
              <EmptyState icon={<GitCompareArrows className="size-5" />} title="Nothing yet">
                {session.status === "ready"
                  ? "Send the candidate their link. Their conversation and every round appear here as they happen."
                  : "The conversation and every round appear here as they happen."}
              </EmptyState>
            </Card>
          ) : (
            session.timeline.map((item) =>
              item.type === "message" ? (
                <div key={item.id} className={cx("px-1", item.role === "assistant" && "pr-6")}>
                  <div className="mb-1.5 text-[11.5px] font-medium text-faint">
                    {item.role === "candidate" ? "Candidate" : "Assistant"} ·{" "}
                    {clock(item.createdAt)}
                  </div>
                  <MessageView message={item} compact />
                </div>
              ) : (
                <RoundCard
                  key={item.id}
                  round={item}
                  onView={() => {
                    setViewing(item.id);
                  }}
                  onCancel={() => void run("cancel", () => adminApi.cancelRound(id, item.id))}
                />
              ),
            )
          )}
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Sidebar session={session} candidateUrl={view.candidateUrl} />
        </aside>
      </div>

      {viewingRound?.type === "round" && viewingRound.variants !== null && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:p-6">
          <div className="flex w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-pop">
            <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
              <span className="text-[13px] font-medium">What the candidate saw</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<X className="size-3.5" />}
                onClick={() => {
                  setViewing(null);
                }}
              >
                Close
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ReviewPanel
                round={toReviewRound(viewingRound)}
                loadFiles={loadFiles}
                labels={{
                  a: <RoleBadge variant={viewingRound.variants.a} />,
                  b: <RoleBadge variant={viewingRound.variants.b} />,
                }}
              />
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
        }}
        title="Delete this session?"
        description="The conversation, every version and the workspace are removed. Download the report first if you want to keep it."
        footer={
          <>
            <Button
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === "delete"}
              onClick={() =>
                void run("delete", async () => {
                  await adminApi.remove(id);
                  navigate("/sessions");
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
