// VS Code–style change marks: a thin bar beside lines a version added or
// changed, and a small notch where it removed lines. Nothing touches the text
// itself, so the code reads exactly as it will once merged.
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { LineChange } from "../../../shared/model";

type Mark = "added" | "modified" | "deleted-below" | "deleted-above";

class ChangeMarker extends GutterMarker {
  constructor(readonly mark: Mark) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof ChangeMarker && other.mark === this.mark;
  }

  override toDOM(): Node {
    const element = document.createElement("div");
    element.className = `cm-change-mark cm-change-${this.mark}`;
    return element;
  }
}

const MARKERS: Record<Mark, ChangeMarker> = {
  added: new ChangeMarker("added"),
  modified: new ChangeMarker("modified"),
  "deleted-below": new ChangeMarker("deleted-below"),
  "deleted-above": new ChangeMarker("deleted-above"),
};

/** One mark per line; a changed line wins over a deletion next to it. */
function marksByLine(changes: readonly LineChange[], lines: number): Map<number, Mark> {
  const marks = new Map<number, Mark>();
  for (const change of changes) {
    if (change.kind !== "deleted") continue;
    if (change.from === 0) marks.set(1, "deleted-above");
    else if (change.from <= lines) marks.set(change.from, "deleted-below");
  }
  for (const change of changes) {
    if (change.kind === "deleted") continue;
    for (let line = change.from; line <= Math.min(change.to, lines); line += 1) {
      marks.set(line, change.kind);
    }
  }
  return marks;
}

export function changeGutter(changes: readonly LineChange[]): Extension {
  return [
    gutter({
      class: "cm-change-gutter",
      markers: (view) => {
        const doc = view.state.doc;
        const marks = marksByLine(changes, doc.lines);
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const line of [...marks.keys()].sort((a, b) => a - b)) {
          const mark = marks.get(line);
          if (mark !== undefined)
            builder.add(doc.line(line).from, doc.line(line).from, MARKERS[mark]);
        }
        return builder.finish();
      },
    }),
    EditorView.editorAttributes.of({ class: "cm-has-changes" }),
  ];
}

/** The first line worth showing when a file opens: the first change. */
export function firstChangedLine(changes: readonly LineChange[]): number | null {
  const lines = changes.map((change) => Math.max(1, change.from));
  return lines.length === 0 ? null : Math.min(...lines);
}
