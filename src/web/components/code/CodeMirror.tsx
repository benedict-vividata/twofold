import { unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { LineChange } from "../../../shared/model";
import { changeGutter, firstChangedLine } from "./changeGutter";
import { baseExtensions } from "./editor";
import { languageFor } from "./languages";

interface Props {
  /** Used to pick a language. */
  path: string;
  doc: string;
  /** When given, the editor shows a unified diff against this text. */
  original?: string | null;
  editable?: boolean;
  onChange?: (text: string) => void;
  /** Marks in the gutter for lines that changed; the view opens at the first one. */
  changes?: readonly LineChange[] | null;
  className?: string;
}

/**
 * A CodeMirror view, owned imperatively. It is rebuilt when the document
 * identity changes (a different file or version) but not on every keystroke.
 */
export function CodeMirror({
  path,
  doc,
  original,
  editable = false,
  onChange,
  changes,
  className,
}: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return undefined;
    const language = new Compartment();
    const extensions: Extension[] = [
      ...baseExtensions({ editable }),
      language.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
      }),
    ];
    if (original !== undefined) extensions.push(EditorView.lineWrapping);
    if (original !== undefined && original !== null) {
      extensions.push(
        unifiedMergeView({
          original,
          highlightChanges: true,
          gutter: true,
          syntaxHighlightDeletions: true,
          mergeControls: false,
          collapseUnchanged: { margin: 3, minSize: 6 },
        }),
      );
    } else if (original === null) {
      // A new file: shown plainly, marked as added, rather than painted solid green.
      extensions.push(EditorView.editorAttributes.of({ class: "cm-added-file" }));
    }

    if (changes != null && changes.length > 0) extensions.push(changeGutter(changes));

    const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
    const first = changes == null ? null : firstChangedLine(changes);
    if (first !== null && first <= view.state.doc.lines) {
      const position = view.state.doc.line(first).from;
      view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "center" }) });
    }
    let cancelled = false;
    void languageFor(path).then((support) => {
      if (!cancelled && support !== null) view.dispatch({ effects: language.reconfigure(support) });
    });
    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [path, doc, original, editable, changes]);

  return <div ref={host} className={className} />;
}
