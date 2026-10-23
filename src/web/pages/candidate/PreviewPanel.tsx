import { AppWindow, ArrowRight, ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { PreviewTarget, PreviewTargets, TerminalTarget } from "../../../shared/model";
import { errorMessage, type CandidateApi } from "../../api";
import { EmptyState, ErrorNote, IconButton, Segmented, Spinner, cx } from "../../components/ui";

interface Address {
  port: string;
  path: string;
}

const LABELS: Record<TerminalTarget, string> = { merged: "merged", a: "A", b: "B" };

function frameUrl(target: PreviewTarget, address: Address): string {
  const path = address.path.startsWith("/") ? address.path : `/${address.path}`;
  return `${target.origin}/__twofold/${encodeURIComponent(target.key)}/${address.port}${path}`;
}

/**
 * A browser on the servers the candidate starts in a terminal: one view for the
 * merged code and one for each pending version, each on its own origin.
 */
export function PreviewPanel({
  api,
  pendingRoundId,
}: {
  api: CandidateApi;
  /** The pair awaiting a decision, if any: A and B only exist while it does. */
  pendingRoundId: string | null;
}): React.JSX.Element {
  const [targets, setTargets] = useState<PreviewTargets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TerminalTarget>("merged");
  const [opened, setOpened] = useState<TerminalTarget[]>(["merged"]);
  const [addresses, setAddresses] = useState<Partial<Record<TerminalTarget, Address>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<TerminalTarget, Address>>>({});
  const [reloads, setReloads] = useState<Record<TerminalTarget, number>>({ merged: 0, a: 0, b: 0 });

  useEffect(() => {
    let cancelled = false;
    api
      .preview()
      .then((next) => {
        if (cancelled) return;
        setTargets(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [api, pendingRoundId]);

  // Once the pair is decided, A and B are gone.
  const available = (["merged", "a", "b"] as const).filter((target) => targets?.[target] != null);
  const current: TerminalTarget = available.some((target) => target === selected)
    ? selected
    : "merged";

  const select = (target: TerminalTarget): void => {
    setSelected(target);
    if (!opened.includes(target)) setOpened([...opened, target]);
  };

  if (error !== null) {
    return (
      <div className="p-6">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }
  if (targets === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-5 text-faint" />
      </div>
    );
  }
  const info = targets[current];
  if (info === null) {
    return (
      <EmptyState icon={<AppWindow className="size-5" />} title="No preview right now">
        Previews are available while the session is in progress.
      </EmptyState>
    );
  }

  const addressOf = (target: PreviewTarget): Address =>
    addresses[target.target] ?? { port: String(target.port), path: "/" };
  const address = addressOf(info);
  const draft = drafts[current] ?? address;
  const go = (): void => {
    const port = draft.port.trim();
    if (!/^\d{4,5}$/.test(port)) return;
    setAddresses({ ...addresses, [current]: { port, path: draft.path.trim() || "/" } });
    setReloads({ ...reloads, [current]: reloads[current] + 1 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Segmented<TerminalTarget>
          size="sm"
          value={current}
          onChange={select}
          options={available.map((target) => ({
            value: target,
            label:
              target === "merged" ? (
                "Merged"
              ) : (
                <>
                  <span className={cx("size-2 rounded-full", target === "a" ? "bg-a" : "bg-b")} />{" "}
                  {target.toUpperCase()}
                </>
              ),
          }))}
        />
        <form
          className="flex min-w-[16rem] flex-1 items-center rounded-lg border border-line-strong bg-surface-2/60 pl-2.5 font-mono text-[12px] focus-within:border-ring"
          onSubmit={(event) => {
            event.preventDefault();
            go();
          }}
        >
          <span className="text-faint">localhost:</span>
          <input
            aria-label="Port"
            inputMode="numeric"
            value={draft.port}
            onChange={(event) => {
              setDrafts({ ...drafts, [current]: { ...draft, port: event.target.value } });
            }}
            className="w-[5.5ch] bg-transparent py-1.5 outline-none"
          />
          <input
            aria-label="Path"
            value={draft.path}
            onChange={(event) => {
              setDrafts({ ...drafts, [current]: { ...draft, path: event.target.value } });
            }}
            className="min-w-0 flex-1 bg-transparent py-1.5 outline-none"
          />
          <button
            type="submit"
            className="px-2 text-faint hover:text-ink"
            aria-label="Go"
            title="Go"
          >
            <ArrowRight className="size-3.5" />
          </button>
        </form>
        <IconButton
          label="Reload"
          className="size-7"
          onClick={() => {
            setReloads({ ...reloads, [current]: reloads[current] + 1 });
          }}
        >
          <RotateCw className="size-3.5" />
        </IconButton>
        <a
          href={frameUrl(info, address)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in a new tab"
          aria-label="Open in a new tab"
          className="inline-flex size-7 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <p className="border-b border-line bg-surface px-3 py-1.5 text-[11.5px] text-faint">
        Shows a server running in the{" "}
        <span className="font-medium text-muted">{LABELS[current]}</span> terminal, which has{" "}
        <code className="font-mono">PORT={info.port}</code> set. Start it there, e.g.{" "}
        <code className="font-mono">npm start</code>.
      </p>
      <div className="relative min-h-0 flex-1 bg-white">
        {opened.flatMap((target) => {
          const entry = targets[target];
          if (entry === null || !available.some((candidate) => candidate === target)) return [];
          return [
            <iframe
              key={`${target}:${String(reloads[target])}`}
              title={`Preview of the ${LABELS[target]} server`}
              src={frameUrl(entry, addressOf(entry))}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
              className={cx(
                "absolute inset-0 size-full border-0",
                target === current ? "block" : "hidden",
              )}
            />,
          ];
        })}
      </div>
    </div>
  );
}
