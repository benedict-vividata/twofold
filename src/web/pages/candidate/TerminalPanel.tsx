import { ChevronDown, RotateCcw, SquareTerminal, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalTarget } from "../../../shared/model";
import { TerminalView, type TerminalStatus } from "../../components/TerminalView";
import { Button, IconButton, Spinner, cx } from "../../components/ui";

const HEIGHT_KEY = "twofold.terminalHeight";
const MIN_HEIGHT = 140;

function storedHeight(): number {
  try {
    const value = Number.parseInt(localStorage.getItem(HEIGHT_KEY) ?? "", 10);
    return Number.isFinite(value) ? value : 300;
  } catch (_error) {
    return 300;
  }
}

const TARGET_LABELS: Record<TerminalTarget, string> = { merged: "Merged", a: "A", b: "B" };

/**
 * The terminal panel at the bottom of the workspace: one shell on the merged
 * code, and one on each version while a pair awaits a decision.
 */
export function TerminalPanel({
  token,
  pending,
  onHide,
}: {
  token: string;
  /** Whether versions A and B are waiting for a decision. */
  pending: boolean;
  onHide: () => void;
}): React.JSX.Element {
  const [target, setTarget] = useState<TerminalTarget>("merged");
  const [opened, setOpened] = useState<TerminalTarget[]>(["merged"]);
  const [statuses, setStatuses] = useState<Partial<Record<TerminalTarget, TerminalStatus>>>({});
  const [restarts, setRestarts] = useState<Record<TerminalTarget, number>>({
    merged: 0,
    a: 0,
    b: 0,
  });
  const [height, setHeight] = useState(storedHeight);
  const panel = useRef<HTMLDivElement>(null);

  // A and B go away once the pair is decided; so do their shells.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) {
      setOpened(["merged"]);
      setTarget("merged");
    }
  }

  const select = (next: TerminalTarget): void => {
    setTarget(next);
    if (!opened.includes(next)) setOpened([...opened, next]);
  };

  const reportStatus = useCallback((which: TerminalTarget, status: TerminalStatus) => {
    setStatuses((current) => ({ ...current, [which]: status }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch (_error) {
      // Not remembered; that's fine.
    }
  }, [height]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const parent = panel.current?.parentElement;
    const max = Math.max(MIN_HEIGHT, (parent?.clientHeight ?? 800) - 120);
    const move = (moveEvent: PointerEvent): void => {
      setHeight(Math.min(max, Math.max(MIN_HEIGHT, startHeight + startY - moveEvent.clientY)));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const status = statuses[target];
  const targets: TerminalTarget[] = pending ? ["merged", "a", "b"] : ["merged"];

  return (
    <div
      ref={panel}
      style={{ height }}
      className="relative flex shrink-0 flex-col border-t border-line bg-surface"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the terminal"
        onPointerDown={startDrag}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
      />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <SquareTerminal className="ml-1 mr-1 size-3.5 text-faint" />
        {targets.map((which) => (
          <button
            key={which}
            type="button"
            onClick={() => {
              select(which);
            }}
            className={cx(
              "inline-flex h-6.5 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition",
              target === which ? "bg-surface-3 text-ink" : "text-muted hover:text-ink",
            )}
          >
            {which !== "merged" && (
              <span className={cx("size-2 rounded-full", which === "a" ? "bg-a" : "bg-b")} />
            )}
            {TARGET_LABELS[which]}
          </button>
        ))}
        <span className="ml-2 hidden min-w-0 truncate text-[11.5px] text-faint md:inline">
          {target === "merged" ? "Your merged code." : `Version ${target.toUpperCase()} applied.`}{" "}
          Changes made here aren't submitted.
        </span>
        <span className="flex-1" />
        {(status?.state === "preparing" || status?.state === "connecting") && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
            <Spinner className="size-3" />
            {status.state === "preparing" ? "Preparing…" : status.message || "Connecting…"}
          </span>
        )}
        <IconButton
          label="Restart on a fresh copy of the code"
          className="size-7"
          onClick={() => {
            setRestarts({ ...restarts, [target]: restarts[target] + 1 });
          }}
        >
          <RotateCcw className="size-3.5" />
        </IconButton>
        <IconButton label="Hide the terminal (Ctrl+`)" className="size-7" onClick={onHide}>
          <ChevronDown className="size-4" />
        </IconButton>
      </div>

      {(status?.state === "stale" || status?.state === "error" || status?.state === "closed") && (
        <div className="flex shrink-0 items-center gap-3 border-b border-transparent bg-warn-soft px-3 py-1.5 text-[12px] text-warn">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{status.message}</span>
          {status.state !== "closed" && (
            <Button
              size="sm"
              onClick={() => {
                setRestarts({ ...restarts, [target]: restarts[target] + 1 });
              }}
            >
              Restart
            </Button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {opened.map((which) => (
          <div
            key={which}
            className={cx("absolute inset-0", which === target ? "block" : "hidden")}
          >
            <TerminalView
              token={token}
              target={which}
              visible={which === target}
              restart={restarts[which]}
              onStatus={(next) => {
                reportStatus(which, next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
