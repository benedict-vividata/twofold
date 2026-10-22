import {
  ChevronRight,
  FileCode2,
  FileMinus2,
  FilePlus2,
  FileSymlink,
  ScanSearch,
} from "lucide-react";
import { useState } from "react";
import type { FileChange } from "../../../shared/model";
import { IconButton, cx } from "../ui";
import { CodeMirror } from "./CodeMirror";

const STATUS_ICON = {
  added: <FilePlus2 className="size-3.5 text-ok" />,
  deleted: <FileMinus2 className="size-3.5 text-bad" />,
  modified: <FileCode2 className="size-3.5 text-muted" />,
  renamed: <FileSymlink className="size-3.5 text-info" />,
} as const;

export function canEdit(file: FileChange): boolean {
  return file.status !== "deleted" && !file.binary && !file.tooLarge && file.after !== null;
}

function FileBody({
  file,
  editable,
  draft,
  onDraft,
}: {
  file: FileChange;
  editable: boolean;
  draft: string | undefined;
  onDraft?: (path: string, text: string) => void;
}): React.JSX.Element {
  // Captured when the body mounts, so typing never rebuilds the editor.
  const [initial] = useState(() => draft ?? file.after ?? "");

  if (file.binary)
    return <p className="px-4 py-3 text-[12.5px] text-muted">Binary file — not shown.</p>;
  if (file.tooLarge)
    return <p className="px-4 py-3 text-[12.5px] text-muted">Too large to display.</p>;
  return (
    <CodeMirror
      path={file.path}
      doc={initial}
      original={file.status === "added" ? null : (file.before ?? "")}
      editable={editable && canEdit(file)}
      onChange={
        onDraft === undefined
          ? undefined
          : (text) => {
              onDraft(file.path, text);
            }
      }
    />
  );
}

function FileCard({
  file,
  defaultOpen,
  editable,
  draft,
  onDraft,
  onOpenInContext,
}: {
  file: FileChange;
  defaultOpen: boolean;
  editable: boolean;
  draft: string | undefined;
  onDraft?: (path: string, text: string) => void;
  onOpenInContext?: (path: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
  const name = file.path.slice(slash + 1);
  const edited = draft !== undefined && draft !== file.after;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className={cx("group flex items-center", open && "border-b border-line")}>
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition hover:bg-surface-2"
        >
          <ChevronRight
            className={cx("size-3.5 shrink-0 text-faint transition", open && "rotate-90")}
          />
          {STATUS_ICON[file.status]}
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
            {file.oldPath !== null && <span className="text-faint">{file.oldPath} → </span>}
            <span className="text-muted">{dir}</span>
            <span className="font-medium text-ink">{name}</span>
          </span>
          {edited && (
            <span className="rounded bg-warn-soft px-1.5 text-[11px] font-medium text-warn">
              edited
            </span>
          )}
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
            <span className="text-ok">+{file.additions}</span>{" "}
            <span className="text-bad">−{file.deletions}</span>
          </span>
        </button>
        {onOpenInContext !== undefined && file.status !== "deleted" && (
          <IconButton
            label="Open in the code tab, in context"
            className="mr-1 size-7 shrink-0"
            onClick={() => {
              onOpenInContext(file.path);
            }}
          >
            <ScanSearch className="size-3.5" />
          </IconButton>
        )}
      </div>
      {open && <FileBody file={file} editable={editable} draft={draft} onDraft={onDraft} />}
    </div>
  );
}

export function VariantDiff({
  files,
  editable = false,
  drafts,
  onDraft,
  onOpenInContext,
}: {
  files: readonly FileChange[];
  editable?: boolean;
  drafts?: ReadonlyMap<string, string>;
  onDraft?: (path: string, text: string) => void;
  onOpenInContext?: (path: string) => void;
}): React.JSX.Element {
  if (files.length === 0)
    return <p className="px-1 py-6 text-center text-[13px] text-muted">No files changed.</p>;
  const openByDefault = files.length <= 8;
  return (
    <div className="flex flex-col gap-2.5">
      {files.map((file) => (
        <FileCard
          key={file.path}
          file={file}
          defaultOpen={openByDefault || editable}
          editable={editable}
          draft={drafts?.get(file.path)}
          onDraft={onDraft}
          onOpenInContext={onOpenInContext}
        />
      ))}
    </div>
  );
}
