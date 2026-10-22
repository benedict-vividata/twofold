import { FileText, Globe, ListTodo, Pencil, Search, Sparkles, SquareTerminal } from "lucide-react";
import type { Activity, ActivityKind } from "../../shared/model";

const ICONS: Record<ActivityKind, React.JSX.Element> = {
  read: <FileText className="size-3" />,
  search: <Search className="size-3" />,
  edit: <Pencil className="size-3" />,
  command: <SquareTerminal className="size-3" />,
  web: <Globe className="size-3" />,
  plan: <ListTodo className="size-3" />,
  other: <Sparkles className="size-3" />,
};

export function ActivityLine({ activity }: { activity: Activity }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-faint">
      <span className="flex size-4.5 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-muted">
        {ICONS[activity.kind]}
      </span>
      <span className="truncate" title={activity.label}>
        {activity.label}
      </span>
    </div>
  );
}

/** Consecutive activity lines folded behind a count once there are many. */
export function ActivityGroup({ items }: { items: readonly Activity[] }): React.JSX.Element {
  const visible = items.slice(-3);
  const hidden = items.length - visible.length;
  return (
    <div className="flex flex-col gap-1">
      {hidden > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[11.5px] text-faint hover:text-muted">
            + {hidden} earlier step{hidden === 1 ? "" : "s"}
          </summary>
          <div className="mt-1 flex flex-col gap-1">
            {items.slice(0, hidden).map((activity, index) => (
              <ActivityLine key={`${activity.at}-${String(index)}`} activity={activity} />
            ))}
          </div>
        </details>
      )}
      {visible.map((activity, index) => (
        <ActivityLine key={`${activity.at}-${String(index + hidden)}`} activity={activity} />
      ))}
    </div>
  );
}
