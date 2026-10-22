import { ArrowLeft, Bot, FlaskConical, GitBranch, HardDrive, Package } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  DEFAULT_MIX,
  HARNESS_LABELS,
  type DegradationCategory,
  type Environment,
  type HarnessKind,
  type PairMix,
  type SessionConfig,
  type SessionConfigInput,
} from "../../../shared/model";
import { adminApi, errorMessage } from "../../api";
import { Markdown } from "../../components/Markdown";
import {
  Button,
  Card,
  Dot,
  ErrorNote,
  Field,
  Input,
  Segmented,
  Select,
  Spinner,
  Textarea,
  Toggle,
  buttonClass,
  cx,
} from "../../components/ui";

type RepoKind = "sample" | "git" | "local";

interface Draft {
  candidateName: string;
  title: string;
  brief: string;
  privateNotes: string;
  repoKind: RepoKind;
  gitUrl: string;
  gitRef: string;
  fullHistory: boolean;
  localPath: string;
  localRef: string;
  harness: HarnessKind;
  model: string;
  effort: string;
  setup: string;
  check: string;
  timeoutSeconds: number;
  mix: PairMix;
  degradations: string[];
  requireNote: boolean;
}

const CATEGORY_LABELS: Record<DegradationCategory, string> = {
  design: "Design",
  maintainability: "Maintainability",
  correctness: "Correctness",
  performance: "Performance",
  testing: "Testing",
};

const MIX_ROWS: { key: keyof PairMix; label: string; description: string; colour: string }[] = [
  {
    key: "degraded",
    label: "Reference vs. degraded",
    description: "The best version against a copy with one flaw worked in.",
    colour: "bg-a",
  },
  {
    key: "tradeoff",
    label: "Trade-off",
    description: "Two sound versions that resolve a design tension differently.",
    colour: "bg-b",
  },
  {
    key: "bothFlawed",
    label: "Both flawed",
    description: "Two copies of the reference, each with a different flaw.",
    colour: "bg-warn",
  },
  {
    key: "control",
    label: "Control",
    description: "The same version on both sides. Does the candidate notice?",
    colour: "bg-faint",
  },
];

function draftFromConfig(config: SessionConfig): Draft {
  const repo = config.repo;
  return {
    candidateName: "",
    title: config.title,
    brief: config.brief,
    privateNotes: config.privateNotes,
    repoKind: repo.kind,
    gitUrl: repo.kind === "git" ? repo.url : "",
    gitRef: repo.kind === "git" ? repo.ref : "",
    fullHistory: repo.kind === "git" ? repo.fullHistory : false,
    localPath: repo.kind === "local" ? repo.path : "",
    localRef: repo.kind === "local" ? repo.ref : "",
    harness: config.harness.kind,
    model: config.harness.model,
    effort: config.harness.effort,
    setup: config.commands.setup,
    check: config.commands.check,
    timeoutSeconds: config.commands.timeoutSeconds,
    mix: config.mix,
    degradations: config.degradations,
    requireNote: config.requireNote,
  };
}

function freshDraft(environment: Environment): Draft {
  const sample = environment.samples[0];
  const signedIn = environment.harnesses.find(
    (harness) => harness.kind !== "mock" && harness.authenticated,
  );
  return {
    candidateName: "",
    title: sample?.title ?? "",
    brief: sample?.brief ?? "",
    privateNotes: "",
    repoKind: "sample",
    gitUrl: "",
    gitRef: "",
    fullHistory: false,
    localPath: environment.localRepos[0] ?? "",
    localRef: "",
    harness: signedIn?.kind ?? "claude",
    model: "",
    effort: "",
    setup: "",
    check: sample?.check ?? "",
    timeoutSeconds: 600,
    mix: DEFAULT_MIX,
    degradations: environment.degradations.map((entry) => entry.id),
    requireNote: true,
  };
}

function toConfig(draft: Draft): SessionConfigInput {
  const repo: SessionConfigInput["repo"] =
    draft.repoKind === "sample"
      ? { kind: "sample", name: "bookshelf" }
      : draft.repoKind === "git"
        ? {
            kind: "git",
            url: draft.gitUrl.trim(),
            ref: draft.gitRef.trim(),
            fullHistory: draft.fullHistory,
          }
        : { kind: "local", path: draft.localPath.trim(), ref: draft.localRef.trim() };
  return {
    candidateName: draft.candidateName.trim(),
    title: draft.title.trim(),
    brief: draft.brief.trim(),
    privateNotes: draft.privateNotes,
    repo,
    harness: { kind: draft.harness, model: draft.model.trim(), effort: draft.effort },
    commands: {
      setup: draft.setup.trim(),
      check: draft.check.trim(),
      timeoutSeconds: draft.timeoutSeconds,
    },
    mix: draft.mix,
    degradations: draft.degradations,
    requireNote: draft.requireNote,
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="grid gap-4 border-t border-line py-8 first:border-t-0 first:pt-2 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>
      </div>
      <Card className="flex flex-col gap-5 p-5">{children}</Card>
    </section>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  detail,
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex flex-1 items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition disabled:opacity-50",
        selected
          ? "border-ink/60 bg-surface-2 ring-1 ring-ink/40"
          : "border-line-strong hover:bg-surface-2",
      )}
    >
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[12px] text-muted">{detail}</span>
      </span>
    </button>
  );
}

function MixEditor({
  mix,
  onChange,
}: {
  mix: PairMix;
  onChange: (mix: PairMix) => void;
}): React.JSX.Element {
  const total = mix.degraded + mix.tradeoff + mix.bothFlawed + mix.control;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
        {MIX_ROWS.map((row) =>
          mix[row.key] > 0 ? (
            <div
              key={row.key}
              className={row.colour}
              style={{ width: `${String((mix[row.key] / Math.max(total, 1)) * 100)}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-col divide-y divide-line">
        {MIX_ROWS.map((row) => (
          <div key={row.key} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
            <span className={cx("size-2.5 shrink-0 rounded-full", row.colour)} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{row.label}</div>
              <div className="text-[12px] text-muted">{row.description}</div>
            </div>
            <span className="w-10 text-right font-mono text-[12px] text-muted tabular-nums">
              {total === 0 ? "—" : `${String(Math.round((mix[row.key] / total) * 100))}%`}
            </span>
            <div className="w-20 shrink-0">
              <Input
                type="number"
                min={0}
                max={100}
                aria-label={`${row.label} weight`}
                value={mix[row.key]}
                onChange={(event) => {
                  const value = Math.max(
                    0,
                    Math.min(100, Number.parseInt(event.target.value, 10) || 0),
                  );
                  onChange({ ...mix, [row.key]: value });
                }}
                className="text-right"
              />
            </div>
          </div>
        ))}
      </div>
      {total === 0 && (
        <p className="text-[12px] text-bad">Give at least one kind of pair a weight.</p>
      )}
    </div>
  );
}

function DegradationPicker({
  environment,
  selected,
  onChange,
}: {
  environment: Environment;
  selected: string[];
  onChange: (ids: string[]) => void;
}): React.JSX.Element {
  const groups = useMemo(() => {
    const map = new Map<DegradationCategory, Environment["degradations"]>();
    for (const entry of environment.degradations)
      map.set(entry.category, [...(map.get(entry.category) ?? []), entry]);
    return [...map.entries()];
  }, [environment.degradations]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between text-[12.5px] text-muted">
        <span>
          {selected.length} of {environment.degradations.length} enabled
        </span>
        <span className="flex gap-3">
          <button
            type="button"
            className="font-medium hover:text-ink"
            onClick={() => {
              onChange(environment.degradations.map((entry) => entry.id));
            }}
          >
            All
          </button>
          <button
            type="button"
            className="font-medium hover:text-ink"
            onClick={() => {
              onChange([]);
            }}
          >
            None
          </button>
        </span>
      </div>
      {groups.map(([category, entries]) => (
        <div key={category}>
          <div className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-faint">
            {CATEGORY_LABELS[category]}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {entries.map((entry) => {
              const on = selected.includes(entry.id);
              return (
                <label
                  key={entry.id}
                  className={cx(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition",
                    on
                      ? "border-line-strong bg-surface"
                      : "border-line bg-surface-2/60 opacity-70 hover:opacity-100",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      onChange(
                        on ? selected.filter((id) => id !== entry.id) : [...selected, entry.id],
                      );
                    }}
                    className="mt-0.5 size-3.5 accent-[var(--text)]"
                  />
                  <span>
                    <span className="block text-[12.5px] font-medium">{entry.name}</span>
                    <span className="block text-[11.5px] leading-snug text-muted">
                      {entry.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function NewSessionPage(): React.JSX.Element {
  const [, navigate] = useLocation();
  const search = useSearch();
  const from = new URLSearchParams(search).get("from");
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [briefPreview, setBriefPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "New session · Twofold";
    void (async () => {
      try {
        const env = await adminApi.environment();
        setEnvironment(env);
        if (from !== null) {
          const view = await adminApi.session(from);
          setDraft(draftFromConfig(view.session.config));
        } else {
          setDraft(freshDraft(env));
        }
      } catch (failure) {
        setError(errorMessage(failure));
      }
    })();
  }, [from]);

  if (environment === null || draft === null) {
    return (
      <div className="flex justify-center py-24">
        {error === null ? (
          <Spinner className="size-5 text-faint" />
        ) : (
          <ErrorNote>{error}</ErrorNote>
        )}
      </div>
    );
  }

  const update = (patch: Partial<Draft>): void => {
    setDraft({ ...draft, ...patch });
  };
  const sample = environment.samples[0];
  const harness = environment.harnesses.find((entry) => entry.kind === draft.harness);
  const mixTotal =
    draft.mix.degraded + draft.mix.tradeoff + draft.mix.bothFlawed + draft.mix.control;
  const canSubmit =
    !busy &&
    draft.title.trim() !== "" &&
    draft.brief.trim() !== "" &&
    mixTotal > 0 &&
    draft.degradations.length > 0 &&
    (draft.repoKind !== "git" || draft.gitUrl.trim() !== "") &&
    (draft.repoKind !== "local" || draft.localPath.trim() !== "");

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await adminApi.create(toConfig(draft));
      navigate(`/sessions/${id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pb-28 pt-8">
      <Link
        href="/sessions"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" /> Sessions
      </Link>
      <h1 className="mt-3 text-[22px] font-semibold tracking-tight">New session</h1>
      <p className="mt-1 text-[13px] text-muted">
        Set up the repository and the task. The candidate gets a private link once it's ready.
      </p>

      <div className="mt-6">
        <Section
          title="Candidate & task"
          description="The candidate sees the title and brief. Markdown is supported."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Candidate name" htmlFor="candidate" optional>
              <Input
                id="candidate"
                value={draft.candidateName}
                placeholder="Ada Lovelace"
                onChange={(event) => {
                  update({ candidateName: event.target.value });
                }}
              />
            </Field>
            <Field label="Title" htmlFor="title">
              <Input
                id="title"
                value={draft.title}
                onChange={(event) => {
                  update({ title: event.target.value });
                }}
              />
            </Field>
          </div>
          <Field
            label="Brief"
            htmlFor="brief"
            hint="What to build, and any constraints. A little ambiguity gives you something to talk about."
          >
            <div className="flex justify-end">
              <Segmented
                size="sm"
                value={briefPreview ? "preview" : "write"}
                onChange={(value) => {
                  setBriefPreview(value === "preview");
                }}
                options={[
                  { value: "write", label: "Write" },
                  { value: "preview", label: "Preview" },
                ]}
              />
            </div>
            {briefPreview ? (
              <div className="min-h-48 rounded-lg border border-line bg-surface-2/50 p-4">
                <Markdown className="text-[13.5px]">{draft.brief}</Markdown>
              </div>
            ) : (
              <Textarea
                id="brief"
                rows={12}
                className="font-mono text-[12.5px]"
                value={draft.brief}
                onChange={(event) => {
                  update({ brief: event.target.value });
                }}
              />
            )}
          </Field>
        </Section>

        <Section
          title="Repository"
          description="Any Git repository works. It's fetched once; every version is a commit on top of it."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <ChoiceCard
              selected={draft.repoKind === "sample"}
              onSelect={() => {
                update({
                  repoKind: "sample",
                  ...(sample !== undefined && draft.check === "" ? { check: sample.check } : {}),
                });
              }}
              icon={<Package className="size-4" />}
              title="Built-in sample"
              detail="Bookshelf, a small Node API"
              disabled={sample === undefined}
            />
            <ChoiceCard
              selected={draft.repoKind === "git"}
              onSelect={() => {
                update({ repoKind: "git" });
              }}
              icon={<GitBranch className="size-4" />}
              title="Git URL"
              detail="GitHub, GitLab, anything"
            />
            <ChoiceCard
              selected={draft.repoKind === "local"}
              onSelect={() => {
                update({ repoKind: "local" });
              }}
              icon={<HardDrive className="size-4" />}
              title="Local"
              detail="A repo in the repos folder"
            />
          </div>

          {draft.repoKind === "git" && (
            <>
              <Field
                label="Repository URL"
                htmlFor="url"
                hint="https:// or ssh. For a private repo, include a read-only token in the URL; it is removed after fetching."
              >
                <Input
                  id="url"
                  placeholder="https://github.com/org/project.git"
                  value={draft.gitUrl}
                  onChange={(event) => {
                    update({ gitUrl: event.target.value });
                  }}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Branch, tag or commit"
                  htmlFor="ref"
                  optional
                  hint="Defaults to the default branch."
                >
                  <Input
                    id="ref"
                    placeholder="main"
                    value={draft.gitRef}
                    onChange={(event) => {
                      update({ gitRef: event.target.value });
                    }}
                  />
                </Field>
                <div className="pt-7">
                  <Toggle
                    checked={draft.fullHistory}
                    onChange={(value) => {
                      update({ fullHistory: value });
                    }}
                    label="Full history"
                    description="Lets the assistant use git log and blame. Slower for big repos."
                  />
                </div>
              </div>
            </>
          )}

          {draft.repoKind === "local" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Repository"
                htmlFor="local"
                hint={
                  environment.localRepos.length === 0
                    ? "Put a git repository in the repos folder next to compose.yaml."
                    : "Repositories in the repos folder."
                }
              >
                {environment.localRepos.length > 0 ? (
                  <Select
                    id="local"
                    value={draft.localPath}
                    onChange={(event) => {
                      update({ localPath: event.target.value });
                    }}
                  >
                    {environment.localRepos.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id="local"
                    placeholder="my-project"
                    value={draft.localPath}
                    onChange={(event) => {
                      update({ localPath: event.target.value });
                    }}
                  />
                )}
              </Field>
              <Field label="Branch, tag or commit" htmlFor="local-ref" optional>
                <Input
                  id="local-ref"
                  placeholder="HEAD"
                  value={draft.localRef}
                  onChange={(event) => {
                    update({ localRef: event.target.value });
                  }}
                />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_120px]">
            <Field
              label="Setup command"
              htmlFor="setup"
              optional
              hint="Runs once per workspace, e.g. npm ci"
            >
              <Input
                id="setup"
                className="font-mono text-[12.5px]"
                placeholder="npm ci"
                value={draft.setup}
                onChange={(event) => {
                  update({ setup: event.target.value });
                }}
              />
            </Field>
            <Field
              label="Check command"
              htmlFor="check"
              optional
              hint="Runs on every version, e.g. npm test"
            >
              <Input
                id="check"
                className="font-mono text-[12.5px]"
                placeholder="npm test"
                value={draft.check}
                onChange={(event) => {
                  update({ check: event.target.value });
                }}
              />
            </Field>
            <Field label="Timeout (s)" htmlFor="timeout">
              <Input
                id="timeout"
                type="number"
                min={10}
                max={3600}
                value={draft.timeoutSeconds}
                onChange={(event) => {
                  update({ timeoutSeconds: Number.parseInt(event.target.value, 10) || 600 });
                }}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Assistant"
          description="Runs on your Claude or ChatGPT subscription. It writes both versions and answers the candidate's questions."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            {environment.harnesses.map((entry) => (
              <ChoiceCard
                key={entry.kind}
                selected={draft.harness === entry.kind}
                onSelect={() => {
                  update({ harness: entry.kind, model: "", effort: "" });
                }}
                icon={
                  entry.kind === "mock" ? (
                    <FlaskConical className="size-4" />
                  ) : (
                    <Bot className="size-4" />
                  )
                }
                title={HARNESS_LABELS[entry.kind]}
                detail={
                  <span className="inline-flex items-center gap-1.5">
                    <Dot tone={entry.authenticated ? "ok" : entry.installed ? "warn" : "bad"} />
                    {entry.authenticated
                      ? "Ready"
                      : entry.installed
                        ? "Not signed in"
                        : "Not installed"}
                  </span>
                }
              />
            ))}
          </div>
          {harness !== undefined && !harness.authenticated && (
            <ErrorNote>
              {harness.label} isn't signed in on this server. Run{" "}
              <code className="font-mono">./twofold login {harness.kind}</code>, then re-check from
              the sessions page.
            </ErrorNote>
          )}
          {draft.harness !== "mock" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Model"
                htmlFor="model"
                optional
                hint="Leave blank for the assistant's default."
              >
                <Input
                  id="model"
                  list="model-suggestions"
                  value={draft.model}
                  placeholder="default"
                  onChange={(event) => {
                    update({ model: event.target.value });
                  }}
                />
                <datalist id="model-suggestions">
                  {harness?.models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </Field>
              <Field label="Reasoning effort" htmlFor="effort" optional>
                <Select
                  id="effort"
                  value={draft.effort}
                  onChange={(event) => {
                    update({ effort: event.target.value });
                  }}
                >
                  <option value="">Default</option>
                  {harness?.efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </Section>

        <Section
          title="Pairs"
          description="Each time the candidate generates, one kind of pair is drawn at random using these weights."
        >
          <MixEditor
            mix={draft.mix}
            onChange={(mix) => {
              update({ mix });
            }}
          />
        </Section>

        <Section
          title="Flaws"
          description="What a weaker version may get wrong. Each round uses one the change lends itself to, avoiding recent repeats."
        >
          <DegradationPicker
            environment={environment}
            selected={draft.degradations}
            onChange={(degradations) => {
              update({ degradations });
            }}
          />
        </Section>

        <Section title="Candidate experience" description="How decisions are recorded.">
          <Toggle
            checked={draft.requireNote}
            onChange={(value) => {
              update({ requireNote: value });
            }}
            label="Require a written justification"
            description="Tags are always optional. Rejecting both always needs a reason."
          />
        </Section>

        <Section
          title="Private notes"
          description="Only you see these: what to probe, the ambiguity you planted, the bar."
        >
          <Textarea
            rows={5}
            value={draft.privateNotes}
            placeholder="e.g. The brief doesn't say whether the response shape may change. Does the candidate notice it breaks existing clients?"
            onChange={(event) => {
              update({ privateNotes: event.target.value });
            }}
          />
        </Section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          {error !== null ? (
            <div className="min-w-0 flex-1">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : (
            <span className="flex-1" />
          )}
          <Link href="/sessions" className={buttonClass("ghost")}>
            Cancel
          </Link>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canSubmit}
            onClick={() => {
              void submit();
            }}
          >
            Create session
          </Button>
        </div>
      </div>
    </div>
  );
}
