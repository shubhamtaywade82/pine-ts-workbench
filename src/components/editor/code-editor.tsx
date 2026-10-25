"use client";

import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** A compile/runtime error to underline; line and column are 1-based. */
export interface CodeError {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface CodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: CodeError | null;
}

// Colours follow TradingView's dark Pine Editor.
const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#131722", color: "#d1d4dc", fontSize: "13px" },
  ".cm-content": { fontFamily: "Menlo, Consolas, 'Courier New', monospace", caretColor: "#d1d4dc" },
  ".cm-gutters": { backgroundColor: "#131722", color: "#50535e", border: "none" },
  ".cm-activeLine": { backgroundColor: "#1e222d" },
  ".cm-activeLineGutter": { backgroundColor: "#1e222d", color: "#b2b5be" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#2962ff40" },
  ".cm-cursor": { borderLeftColor: "#d1d4dc" },
  ".cm-tooltip": { backgroundColor: "#1e222d", border: "1px solid #2a2e39", color: "#d1d4dc" },
}, { dark: true });

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#787b86", fontStyle: "italic" },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.modifier], color: "#ff6b81" },
  { tag: [tags.string, tags.special(tags.string)], color: "#4caf50" },
  { tag: [tags.number, tags.bool, tags.null], color: "#ff9800" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#42a5f5" },
  { tag: [tags.typeName, tags.className], color: "#26c6da" },
  { tag: tags.propertyName, color: "#d1d4dc" },
  { tag: tags.operator, color: "#b2b5be" },
]);

/** TradingView-styled TypeScript editor: line numbers, highlighting, error underline. */
export function CodeEditor({ value, onChange, error }: CodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  // Built once: a changing extension list would reconfigure the editor on every render.
  const extensions = useMemo(() => [
    javascript({ typescript: true }),
    syntaxHighlighting(highlightStyle),
    editorTheme,
    lintGutter(),
  ], []);

  useEffect(() => {
    const view = editorRef.current?.view;
    if (view === undefined) return;
    view.dispatch(setDiagnostics(view.state, error === null ? [] : [toDiagnostic(view, error)]));
  }, [error, value]);

  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      onChange={onChange}
      theme="none"
      height="100%"
      className="h-full"
      extensions={extensions}
      basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true }}
    />
  );
}

/** Underlines from the error position to the end of that line. */
const toDiagnostic = (view: EditorView, error: CodeError) => {
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(error.line, 1), doc.lines));
  const from = Math.min(line.from + Math.max(error.column - 1, 0), line.to);
  return { from, to: Math.max(line.to, from), severity: "error" as const, message: error.message };
};
