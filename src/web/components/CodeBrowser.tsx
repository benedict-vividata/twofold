import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileContent, TreeEntry, TreeListing } from "../../shared/model";
import { errorMessage } from "../api";
import { CodeMirror } from "./code/CodeMirror";
import { ErrorNote, Spinner, cx } from "./ui";

interface Props {
  loadTree: (path: string) => Promise<TreeListing>;
  loadFile: (path: string) => Promise<FileContent>;
  /** Changes whenever the code changes, to drop anything cached. */
  revision: string;
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

export function CodeBrowser({ loadTree, loadFile, revision }: Props): React.JSX.Element {
  const [children, setChildren] = useState<Map<string, TreeEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expandedRef = useRef(expanded);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // Listings are cached per revision, so a new revision simply misses the cache.
  const key = useCallback((path: string) => `${revision}:${path}`, [revision]);
  const loadDir = useCallback(
    async (path: string): Promise<TreeEntry[]> => {
      const listing = await loadTree(path);
      setChildren((current) => new Map(current).set(key(path), listing.entries));
      setError(null);
      return listing.entries;
    },
    [loadTree, key],
  );

  // Load the root, and re-open directories that were open before the code changed.
  useEffect(() => {
    let cancelled = false;
    for (const path of ["", ...expandedRef.current]) {
      loadTree(path)
        .then((listing) => {
          if (cancelled) return;
          setChildren((current) => new Map(current).set(`${revision}:${path}`, listing.entries));
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
          if (!cancelled && path === "") setError(errorMessage(failure));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [revision, loadTree]);

  useEffect(() => {
    if (selected === null) return undefined;
    let cancelled = false;
    void loadFile(selected)
      .then((content) => {
        if (!cancelled) setFile(content);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, loadFile, revision]);

  const toggle = (path: string): void => {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!children.has(key(path))) {
        void loadDir(path).catch((failure: unknown) => {
          setError(errorMessage(failure));
        });
      }
    }
    setExpanded(next);
  };

  const root = children.get(key(""));
  const childrenNow = new Map<string, TreeEntry[]>();
  for (const [cacheKey, entries] of children) {
    if (cacheKey.startsWith(`${revision}:`))
      childrenNow.set(cacheKey.slice(revision.length + 1), entries);
  }
  return (
    <div className="flex h-full min-h-0">
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
              children={childrenNow}
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
            <div className="border-b border-line bg-surface px-4 py-2 font-mono text-[12px] text-muted">
              {selected}
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-surface">
              {file?.path !== selected ? (
                <div className="flex justify-center py-10">
                  <Spinner className="size-4 text-faint" />
                </div>
              ) : file.binary ? (
                <p className="p-4 text-[13px] text-muted">Binary file — not shown.</p>
              ) : file.tooLarge ? (
                <p className="p-4 text-[13px] text-muted">Too large to display.</p>
              ) : (
                <CodeMirror path={file.path} doc={file.content ?? ""} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
