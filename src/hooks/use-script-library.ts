"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createScript, currentCode, deleteScript, loadLibrary, markOpened, persistLibrary, renameScript,
  saveVersion, toggleFavorite, updateSettings, EMPTY_SETTINGS,
  type ScriptKind, type ScriptLibrary, type SavedScript, type ScriptSettings,
} from "@/lib/script-library";

/** Code a "Create new" script starts from, per kind. */
export type ScriptTemplates = Readonly<Record<ScriptKind, string>>;

const newId = () => `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface ScriptLibraryState {
  readonly library: ScriptLibrary;
  readonly active: SavedScript | undefined;
  /** Editor contents, which may be ahead of the active script's saved code. */
  readonly draft: string;
  readonly isDirty: boolean;
  readonly setDraft: (code: string) => void;
  readonly save: () => boolean;
  readonly open: (id: string) => void;
  readonly copy: (name: string) => void;
  readonly rename: (name: string) => void;
  readonly createNew: (kind: ScriptKind) => void;
  readonly restoreVersion: (code: string) => void;
  readonly remove: (id: string) => void;
  readonly toggleFavorite: (id: string) => void;
  readonly settings: ScriptSettings;
  readonly setSettings: (settings: ScriptSettings) => void;
}

/**
 * The Pine Editor's script library. On first use it seeds the library from
 * `seed` (the scripts the editor kept before the library existed), so no work is lost.
 */
export function useScriptLibrary(templates: ScriptTemplates, seed: () => readonly string[]): ScriptLibraryState {
  const [library, setLibrary] = useState<ScriptLibrary>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  /** Returns false when browser storage refused the write. */
  const commit = useCallback((next: ScriptLibrary): boolean => {
    setLibrary(next);
    return persistLibrary(next);
  }, []);

  useEffect(() => {
    let loaded = loadLibrary();
    if (loaded.length === 0) {
      const now = Date.now();
      // Earlier seeds count as more recently opened, so the first one (the old indicator) opens.
      seed().forEach((code, i) => { loaded = createScript(loaded, { code, id: newId(), now: now - i }); });
      persistLibrary(loaded);
    }
    const latest = [...loaded].sort((a, b) => b.openedAt - a.openedAt)[0];
    setLibrary(loaded);
    setActiveId(latest?.id);
    setDraft(latest === undefined ? templates.indicator : currentCode(latest));
    // Load once on mount; templates and seed are static.
  }, []);

  const active = library.find((s) => s.id === activeId);
  const isDirty = active === undefined || currentCode(active) !== draft;

  const save = useCallback((): boolean => {
    const now = Date.now();
    if (active !== undefined) return commit(saveVersion(library, active.id, draft, now));
    const id = newId();
    setActiveId(id);
    return commit(createScript(library, { code: draft, id, now }));
  }, [active, library, draft, commit]);

  const open = useCallback((id: string) => {
    const script = library.find((s) => s.id === id);
    if (script === undefined) return;
    commit(markOpened(library, id, Date.now()));
    setActiveId(id);
    setDraft(currentCode(script));
  }, [library, commit]);

  const startScript = useCallback((code: string, name?: string) => {
    const id = newId();
    commit(createScript(library, { code, id, now: Date.now(), ...(name === undefined ? {} : { name }) }));
    setActiveId(id);
    setDraft(code);
  }, [library, commit]);

  return {
    library, active, draft, isDirty, setDraft, save, open,
    copy: (name) => startScript(draft, name),
    rename: (name) => { if (active !== undefined) commit(renameScript(library, active.id, name)); },
    createNew: (kind) => startScript(templates[kind]),
    restoreVersion: setDraft,
    remove: (id) => {
      commit(deleteScript(library, id));
      if (id === activeId) { setActiveId(undefined); setDraft(templates.indicator); }
    },
    toggleFavorite: (id) => commit(toggleFavorite(library, id)),
    settings: active?.settings ?? EMPTY_SETTINGS,
    setSettings: (settings) => { if (active !== undefined) commit(updateSettings(library, active.id, settings)); },
  };
}
