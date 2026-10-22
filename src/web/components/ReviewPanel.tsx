import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Columns2,
  PencilLine,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CandidateRound,
  CheckStatus,
  Choice,
  Position,
  VariantFiles,
} from "../../shared/model";
import { errorMessage } from "../api";
import { duration, plural } from "../lib/format";
import { canEdit, VariantDiff } from "./code/VariantDiff";
import { LogoMark } from "./Logo";
import {
  Badge,
  Button,
  Dialog,
  ErrorNote,
  Segmented,
  Spinner,
  Textarea,
  VersionMark,
  cx,
} from "./ui";

export interface DecisionInput {
  choice: Choice;
  tags: string[];
  note: string;
  edits: { path: string; content: string }[];
}

interface Props {
  round: CandidateRound;
  loadFiles: (position: Position) => Promise<VariantFiles>;
  /** The interviewer's view: what each version really was. */
  labels?: Record<Position, ReactNode>;
  /** Present when the viewer may decide. */
  decide?: {
    tags: readonly string[];
    requireNote: boolean;
    submit: (input: DecisionInput) => Promise<void>;
  };
  onRetry?: () => void;
  onCancel?: () => void;
}

type View = "split" | Position;

function useWide(query = "(min-width: 1180px)"): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => {
      setWide(media.matches);
    };
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, [query]);
  return wide;
}

function useElapsed(since: string, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return duration(now - new Date(since).getTime());
}

export function CheckPill({ status }: { status: CheckStatus }): React.JSX.Element | null {
  if (status === "skipped") return null;
  if (status === "passed") {
    return (
      <Badge tone="ok" icon={<CircleCheck className="size-3" />}>
        Checks pass
      </Badge>
    );
  }
  return (
    <Badge tone="bad" icon={<CircleAlert className="size-3" />}>
      Checks fail
    </Badge>
  );
}

function VersionHeader({
  position,
  round,
  files,
  label,
}: {
  position: Position;
  round: CandidateRound;
  files: VariantFiles | undefined;
  label?: ReactNode;
}): React.JSX.Element | null {
  const variant = round.variants?.[position];
  const [showOutput, setShowOutput] = useState(false);
  if (variant === undefined) return null;
  const chosen = round.decision?.choice === position;
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <VersionMark position={position} />
        <span className="text-[14px] font-semibold">Version {position.toUpperCase()}</span>
        {label}
        {chosen && (
          <Badge tone={position} icon={<Check className="size-3" />}>
            Chosen
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11.5px] text-muted tabular-nums">
            {plural(files?.files.length ?? variant.stats.files, "file")} ·{" "}
            <span className="text-ok">+{variant.stats.additions}</span>{" "}
            <span className="text-bad">−{variant.stats.deletions}</span>
          </span>
          <button
            type="button"
            className={cx(variant.check.status === "skipped" && "hidden")}
            onClick={() => {
              setShowOutput(!showOutput);
            }}
            title="Show check output"
          >
            <CheckPill status={variant.check.status} />
          </button>
        </span>
      </div>
      {showOutput && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {variant.check.output.trim() === "" ? "(no output)" : variant.check.output}
        </pre>
      )}
    </div>
  );
}

function Generating({
  round,
  onCancel,
}: {
  round: CandidateRound;
  onCancel?: () => void;
}): React.JSX.Element {
  const elapsed = useElapsed(round.createdAt, true);
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <LogoMark animated className="size-14" />
      <h3 className="mt-6 text-[16px] font-semibold tracking-tight">Writing two versions</h3>
      <p className="mt-1 text-[13px] text-muted">
        {round.phase} · <span className="tabular-nums">{elapsed}</span>
      </p>
      <p className="mt-4 max-w-sm text-[12.5px] text-faint">
        This usually takes a few minutes. You can keep talking to the assistant in the meantime.
      </p>
      {onCancel !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-5"
          onClick={onCancel}
          icon={<X className="size-3.5" />}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}

function DecisionSummary({
  round,
  labels,
}: {
  round: CandidateRound;
  labels?: Record<Position, ReactNode>;
}): React.JSX.Element | null {
  const decision = round.decision;
  if (decision === null) return null;
  const rejected = decision.choice === "reject";
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {rejected ? (
          <>
            <span className="inline-flex size-5.5 items-center justify-center rounded-md bg-surface-3 text-muted">
              <X className="size-3.5" />
            </span>
            <span className="font-semibold">Both versions rejected</span>
          </>
        ) : (
          <>
            <VersionMark position={decision.choice === "a" ? "a" : "b"} />
            <span className="font-semibold">Version {decision.choice.toUpperCase()} accepted</span>
            {labels !== undefined && decision.choice !== "reject" && labels[decision.choice]}
          </>
        )}
        {decision.editedFiles.length > 0 && (
          <Badge tone="warn" icon={<PencilLine className="size-3" />}>
            edited {plural(decision.editedFiles.length, "file")}
          </Badge>
        )}
        {decision.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
      {decision.note !== "" && (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
          {decision.note}
        </p>
      )}
    </div>
  );
}

function DecisionDialog({
  choice,
  editCount,
  tags,
  requireNote,
  onClose,
  onEdit,
  onSubmit,
}: {
  choice: Choice | null;
  editCount: number;
  tags: readonly string[];
  requireNote: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onSubmit: (tags: string[], note: string) => Promise<void>;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rejecting = choice === "reject";
  const noteRequired = rejecting || requireNote;
  const canSubmit = !busy && (!noteRequired || note.trim() !== "");

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(selected, note);
      setSelected([]);
      setNote("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const title = rejecting ? (
    "Reject both versions"
  ) : (
    <span className="inline-flex items-center gap-2">
      Merge <VersionMark position={choice === "b" ? "b" : "a"} /> Version {choice?.toUpperCase()}
    </span>
  );

  return (
    <Dialog
      open={choice !== null}
      onClose={onClose}
      title={title}
      description={
        rejecting
          ? "Neither version is merged. Say what's wrong — then ask for what you want instead."
          : editCount > 0
            ? `Your edits to ${plural(editCount, "file")} are committed on top.`
            : "What made this the better change? What would you raise in review?"
      }
      footer={
        <>
          {!rejecting && onEdit !== undefined && editCount === 0 && (
            <Button
              variant="ghost"
              className="mr-auto"
              icon={<PencilLine className="size-3.5" />}
              onClick={onEdit}
            >
              Edit before merging
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={rejecting ? "primary" : choice === "b" ? "b" : "a"}
            loading={busy}
            disabled={!canSubmit}
            onClick={() => {
              void submit();
            }}
          >
            {rejecting ? "Reject both" : `Merge ${choice?.toUpperCase() ?? ""}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-[12.5px] font-medium text-muted">
            {rejecting ? "What's wrong" : "What decided it"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const on = selected.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSelected(on ? selected.filter((item) => item !== tag) : [...selected, tag]);
                  }}
                  className={cx(
                    "h-7 rounded-full border px-3 text-[12.5px] font-medium transition",
                    on
                      ? "border-transparent bg-primary text-primary-ink"
                      : "border-line-strong bg-surface text-muted hover:text-ink",
                  )}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label
            htmlFor="decision-note"
            className="mb-2 block text-[12.5px] font-medium text-muted"
          >
            {rejecting ? "Why neither?" : "Why this one?"}
            {!noteRequired && <span className="ml-1.5 font-normal text-faint">optional</span>}
          </label>
          <Textarea
            id="decision-note"
            rows={5}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSubmit)
                void submit();
            }}
            placeholder={
              rejecting
                ? "e.g. Both re-implement validation that already exists in validation.ts…"
                : "e.g. B duplicates the filtering logic; A keeps it in the store where the other queries live…"
            }
          />
        </div>
        {error !== null && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Dialog>
  );
}

export function ReviewPanel({
  round,
  loadFiles,
  labels,
  decide,
  onRetry,
  onCancel,
}: Props): React.JSX.Element {
  const wide = useWide();
  const [view, setView] = useState<View>("split");
  const [files, setFiles] = useState<Partial<Record<Position, VariantFiles>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Choice | null>(null);
  const [editing, setEditing] = useState<{
    position: Position;
    drafts: Map<string, string>;
  } | null>(null);

  const hasVariants = round.variants !== null;
  // The panel is keyed by round, so state starts fresh for each one.
  useEffect(() => {
    if (!hasVariants) return undefined;
    let cancelled = false;
    void Promise.all([loadFiles("a"), loadFiles("b")])
      .then(([a, b]) => {
        if (!cancelled) setFiles({ a, b });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [round.id, hasVariants, loadFiles]);

  const effectiveView: View =
    editing !== null ? editing.position : !wide && view === "split" ? "a" : view;

  const onDraft = useCallback((path: string, text: string) => {
    setEditing((current) => {
      if (current === null) return current;
      const drafts = new Map(current.drafts);
      drafts.set(path, text);
      return { ...current, drafts };
    });
  }, []);

  const edits = useMemo(() => {
    if (editing === null) return [];
    const original = files[editing.position]?.files ?? [];
    return original.flatMap((file) => {
      const draft = editing.drafts.get(file.path);
      return draft !== undefined && canEdit(file) && draft !== file.after
        ? [{ path: file.path, content: draft }]
        : [];
    });
  }, [editing, files]);

  const ready = round.status === "ready" && decide !== undefined;

  let body: ReactNode;
  if (round.status === "generating") {
    body = <Generating round={round} onCancel={onCancel} />;
  } else if (round.status === "failed" || round.status === "cancelled") {
    body = (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-xs">
          {round.status === "failed" ? (
            <CircleAlert className="size-5 text-bad" />
          ) : (
            <CircleDashed className="size-5" />
          )}
        </div>
        <h3 className="mt-4 text-[15px] font-semibold">
          {round.status === "failed" ? "No versions this time" : "Cancelled"}
        </h3>
        {round.error !== null && (
          <p className="mt-2 whitespace-pre-wrap text-left text-[13px] leading-relaxed text-muted">
            {round.error}
          </p>
        )}
        {onRetry !== undefined && (
          <Button className="mt-5" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  } else if (loadError !== null) {
    body = (
      <div className="p-6">
        <ErrorNote>{loadError}</ErrorNote>
      </div>
    );
  } else if (files.a === undefined || files.b === undefined) {
    body = (
      <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-muted">
        <Spinner /> Loading the versions…
      </div>
    );
  } else {
    const positions: Position[] = effectiveView === "split" ? ["a", "b"] : [effectiveView];
    body = (
      <div className="p-4 sm:p-5">
        <DecisionSummary round={round} labels={labels} />
        {editing !== null && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-transparent bg-warn-soft px-4 py-3 text-[13px] text-warn">
            <PencilLine className="size-4 shrink-0" />
            <span className="flex-1">
              Editing Version {editing.position.toUpperCase()}. Your changes are committed on top of
              it when you merge.
            </span>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
              }}
            >
              Discard edits
            </Button>
            <Button
              size="sm"
              variant={editing.position}
              onClick={() => {
                setDialog(editing.position);
              }}
            >
              Continue
            </Button>
          </div>
        )}
        <div className={cx("grid gap-5", positions.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {positions.map((position) => (
            <div key={position} className="min-w-0">
              <VersionHeader
                position={position}
                round={round}
                files={files[position]}
                label={labels?.[position]}
              />
              <VariantDiff
                files={files[position]?.files ?? []}
                editable={editing?.position === position}
                drafts={editing?.position === position ? editing.drafts : undefined}
                onDraft={editing?.position === position ? onDraft : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-faint">
            Round {round.number}
          </div>
          <p className="line-clamp-2 text-[13.5px] font-medium" title={round.request}>
            {round.request}
          </p>
        </div>
        {hasVariants && editing === null && round.status !== "generating" && (
          <Segmented<View>
            size="sm"
            value={effectiveView}
            onChange={setView}
            options={[
              ...(wide
                ? [
                    {
                      value: "split" as const,
                      label: <Columns2 className="size-3.5" aria-label="Side by side" />,
                    },
                  ]
                : []),
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ]}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>

      {ready && files.a !== undefined && editing === null && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:px-5">
          <span className="mr-auto text-[13px] font-medium text-muted">
            Which version would you merge?
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog("reject");
            }}
          >
            Reject both
          </Button>
          <Button
            variant="a"
            onClick={() => {
              setDialog("a");
            }}
          >
            Merge A
          </Button>
          <Button
            variant="b"
            onClick={() => {
              setDialog("b");
            }}
          >
            Merge B
          </Button>
        </div>
      )}

      {decide !== undefined && (
        <DecisionDialog
          key={dialog ?? "closed"}
          choice={dialog}
          editCount={edits.length}
          tags={decide.tags}
          requireNote={decide.requireNote}
          onClose={() => {
            setDialog(null);
          }}
          onEdit={
            dialog === "a" || dialog === "b"
              ? () => {
                  setEditing({ position: dialog, drafts: new Map() });
                  setDialog(null);
                }
              : undefined
          }
          onSubmit={async (tags, note) => {
            if (dialog === null) return;
            await decide.submit({
              choice: dialog,
              tags,
              note,
              edits: dialog !== "reject" && editing?.position === dialog ? edits : [],
            });
            setDialog(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
