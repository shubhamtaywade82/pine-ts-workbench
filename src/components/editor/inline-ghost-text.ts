import { StateEffect, StateField, Prec } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, WidgetType, keymap } from "@codemirror/view";

interface GhostSuggestion {
  readonly text: string;
  readonly pos: number;
}

export const setGhostText = StateEffect.define<GhostSuggestion | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "opacity-40 italic font-mono text-muted-foreground select-none pointer-events-none";
    span.textContent = this.text;
    return span;
  }
}

export const ghostTextField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostText)) return effect.value;
    }
    // Any document or selection change clears the current ghost text.
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (val) => {
      if (!val || val.text.length === 0) return Decoration.none;
      const widget = Decoration.widget({ widget: new GhostWidget(val.text), side: 1 });
      return Decoration.set([widget.range(val.pos)]);
    }),
});

function acceptGhostText(view: EditorView): boolean {
  const current = view.state.field(ghostTextField, false);
  if (!current || current.text.length === 0) return false;
  view.dispatch({
    changes: { from: current.pos, insert: current.text },
    selection: { anchor: current.pos + current.text.length },
    effects: setGhostText.of(null),
  });
  return true;
}

function dismissGhostText(view: EditorView): boolean {
  const current = view.state.field(ghostTextField, false);
  if (!current) return false;
  view.dispatch({ effects: setGhostText.of(null) });
  return true;
}

const ghostKeymap = Prec.highest(
  keymap.of([
    { key: "Tab", run: acceptGhostText },
    { key: "Escape", run: dismissGhostText },
  ]),
);

export function createGhostTextExtension(enabled = true) {
  if (!enabled) return [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;
    if (timer) clearTimeout(timer);

    const pos = update.state.selection.main.head;
    const doc = update.state.doc;
    const line = doc.lineAt(pos);
    if (line.text.trim().length === 0) return;

    timer = setTimeout(async () => {
      try {
        const prefix = doc.sliceString(Math.max(0, pos - 500), pos);
        const res = await fetch("/api/ai/inline-completion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; completion?: string };
        if (data.ok && data.completion && data.completion.length > 0) {
          update.view.dispatch({ effects: setGhostText.of({ text: data.completion, pos }) });
        }
      } catch {
        // Ghost text fails silently
      }
    }, 280);
  });

  return [ghostTextField, ghostKeymap, updateListener];
}
