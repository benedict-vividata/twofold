import { unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
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

    const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
    let cancelled = false;
    void languageFor(path).then((support) => {
      if (!cancelled && support !== null) view.dispatch({ effects: language.reconfigure(support) });
    });
    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [path, doc, original, editable]);

  return <div ref={host} className={className} />;
}
