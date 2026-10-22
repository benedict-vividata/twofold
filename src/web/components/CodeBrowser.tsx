import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FileContent, TreeEntry, TreeListing } from "../../shared/model";
import { ApiError, errorMessage } from "../api";
import { CodeMirror } from "./code/CodeMirror";
import { ErrorNote, Spinner, cx } from "./ui";

interface Props {
  loadTree: (path: string) => Promise<TreeListing>;
  loadFile: (path: string) => Promise<FileContent>;
  /** Changes whenever the code being shown changes, to drop anything cached. */
  revision: string;
  /** Opens a file (expanding its folders) whenever the nonce changes. */
  focus?: { path: string; nonce: number } | null;
  toolbar?: ReactNode;
}

const CHANGE_LETTER = { added: "A", modified: "M", renamed: "R" } as const;

function ChangeMark({ change }: { change: TreeEntry["change"] }): React.JSX.Element | null {
  if (change === null) return null;
  if (change === "contains") {
    return (
      <span className="ml-auto size-1.5 shrink-0 rounded-full bg-ok/70" title="Contains changes" />
    );
  }
  return (
    <span
      className="ml-auto shrink-0 font-mono text-[10.5px] font-semibold text-ok"
      title={change === "added" ? "Added" : change === "renamed" ? "Renamed" : "Modified"}
    >
      {CHANGE_LETTER[change]}
    </span>
  );
}

function TreeNode({
  entry,
  depth,
  children,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  entry: TreeEntry;
  depth: number;
  children: ReadonlyMap<string, TreeEntry[]>;
  expanded: ReadonlySet<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}): React.JSX.Element {
  const isOpen = expanded.has(entry.path);
  const kids = children.get(entry.path);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (entry.type === "dir") onToggle(entry.path);
          else onSelect(entry.path);
        }}
        style={{ paddingLeft: `${String(8 + depth * 14)}px` }}
        className={cx(
          "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12.5px] transition",
          selected === entry.path
            ? "bg-surface-3 font-medium text-ink"
            : entry.change === "added"
              ? "text-ok hover:bg-surface-2"
              : "text-muted hover:bg-surface-2 hover:text-ink",
        )}
      >
        {entry.type === "dir" ? (
          <>
            <ChevronRight
              className={cx("size-3 shrink-0 text-faint transition", isOpen && "rotate-90")}
            />
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-faint" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-faint" />
            )}
          </>
        ) : (
          <>
            <span className="size-3 shrink-0" />
            <File className="size-3.5 shrink-0 text-faint" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
        <ChangeMark change={entry.change} />
      </button>
      {entry.type === "dir" &&
        isOpen &&
        (kids === undefined ? (
          <div style={{ paddingLeft: `${String(30 + depth * 14)}px` }} className="py-1">
            <Spinner className="size-3 text-faint" />
          </div>
        ) : (
          kids.map((kid) => (
            <TreeNode
              key={kid.path}
              entry={kid}
              depth={depth + 1}
              children={children}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        ))}
    </>
  );
}

/** The folders a path lives in: `a/b/c.ts` → `a`, `a/b`. */
function ancestors(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function CodeBrowser({
  loadTree,
  loadFile,
  revision,
  focus,
  toolbar,
}: Props): React.JSX.Element {
  // Listings are cached under `${revision}:${path}`, so new code simply misses the cache.
  const [listings, setListings] = useState<Map<string, TreeEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(focus == null ? [] : ancestors(focus.path)),
  );
  const [selected, setSelected] = useState<string | null>(focus?.path ?? null);
  const [file, setFile] = useState<{ key: string; content: FileContent | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handledFocus, setHandledFocus] = useState(focus?.nonce ?? null);
  const inflight = useRef(new Set<string>());

  // A request to open a file: select it and open the folders above it.
  if (focus != null && focus.nonce !== handledFocus) {
    setHandledFocus(focus.nonce);
    setSelected(focus.path);
    setExpanded(new Set([...expanded, ...ancestors(focus.path)]));
  }

  // Load the root and every open folder that isn't cached for this revision.
  useEffect(() => {
    for (const path of ["", ...expanded]) {
      const key = `${revision}:${path}`;
      if (listings.has(key) || inflight.current.has(key)) continue;
      inflight.current.add(key);
      loadTree(path)
        .then((listing) => {
          setListings((current) => new Map(current).set(key, listing.entries));
          if (path !== "") return;
          setError(null);
          setSelected((current) => {
            if (current !== null) return current;
            const readme = listing.entries.find(
              (entry) => entry.type === "file" && /^readme/i.test(entry.name),
            );
            return readme?.path ?? null;
          });
        })
        .catch((failure: unknown) => {
          // A folder that doesn't exist in this version is simply empty.
          if (path !== "" && failure instanceof ApiError) {
            setListings((current) => new Map(current).set(key, []));
          } else if (path === "") {
            setError(errorMessage(failure));
          }
        })
        .finally(() => {
          inflight.current.delete(key);
        });
    }
  }, [expanded, listings, revision, loadTree]);

  const fileKey = selected === null ? null : `${revision}:${selected}`;
  useEffect(() => {
    if (selected === null || fileKey === null) return undefined;
    let cancelled = false;
    loadFile(selected)
      .then((content) => {
        if (!cancelled) setFile({ key: fileKey, content });
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 404)
          setFile({ key: fileKey, content: null });
        else setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, fileKey, loadFile]);

  const toggle = (path: string): void => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const current = new Map<string, TreeEntry[]>();
  for (const [key, entries] of listings) {
    if (key.startsWith(`${revision}:`)) current.set(key.slice(revision.length + 1), entries);
  }
  const root = current.get("");
  const shown = file?.key === fileKey ? file : null;
  const changeCount = shown?.content?.changes?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <nav
          className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-2"
          aria-label="Files"
        >
          {root === undefined ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-4 text-faint" />
            </div>
          ) : (
            root.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                children={current}
                expanded={expanded}
                selected={selected}
                onToggle={toggle}
                onSelect={setSelected}
              />
            ))
          )}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {error !== null && (
            <div className="p-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
          {selected === null ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-faint">
              Choose a file
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 font-mono text-[12px] text-muted">
                <span className="min-w-0 truncate">{selected}</span>
                {changeCount > 0 && (
                  <span className="ml-auto shrink-0 font-sans text-[11.5px] text-ok">
                    {changeCount} {changeCount === 1 ? "change" : "changes"}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-surface">
                {shown === null ? (
                  <div className="flex justify-center py-10">
                    <Spinner className="size-4 text-faint" />
                  </div>
                ) : shown.content === null ? (
                  <p className="p-4 text-[13px] text-muted">
                    This file doesn't exist in this version of the code.
                  </p>
                ) : shown.content.binary ? (
                  <p className="p-4 text-[13px] text-muted">Binary file — not shown.</p>
                ) : shown.content.tooLarge ? (
                  <p className="p-4 text-[13px] text-muted">Too large to display.</p>
                ) : (
                  <CodeMirror
                    path={shown.content.path}
                    doc={shown.content.content ?? ""}
                    changes={shown.content.changes}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
