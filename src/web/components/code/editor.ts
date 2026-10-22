// Shared CodeMirror setup: the look, and the extensions every editor gets.
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";

const look = EditorView.theme({
  "&": { height: "auto" },
  ".cm-scroller": { overflow: "auto" },
});

export function baseExtensions(options: { editable: boolean }): Extension[] {
  const extensions: Extension[] = [
    look,
    lineNumbers(),
    drawSelection(),
    syntaxHighlighting(classHighlighter),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...searchKeymap]),
    EditorState.tabSize.of(2),
  ];
  if (options.editable) {
    extensions.push(
      history(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      keymap.of([...historyKeymap, indentWithTab]),
    );
  } else {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  }
  return extensions;
}
