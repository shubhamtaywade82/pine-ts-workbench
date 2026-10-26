/**
 * "My scripts": the user's saved Pine Editor scripts, with version history,
 * favourites and recency, kept in localStorage. Pure state transitions
 * (`library` in, new `library` out) plus load/persist at the boundary.
 */

import type { StrategyOptions } from "@nemesis-oss/pine-ts";
import type { ChartInterval } from "@/lib/public-binance-feed";

export type ScriptKind = "indicator" | "strategy";

export type InputValue = number | string | boolean;

/** What TradingView keeps in a script's settings dialog; every field overrides the code's defaults. */
export interface ScriptSettings {
  /** Input values by input title (the override key). */
  readonly inputs: Readonly<Record<string, InputValue>>;
  /** Strategy declaration overrides (Properties tab). */
  readonly properties: StrategyOptions;
  /** Per-plot colour and visibility by plot id (Style tab). */
  readonly plotStyles: Readonly<Record<string, { readonly color?: string; readonly isHidden?: boolean }>>;
  /** Intervals the script draws on; undefined = all (Visibility tab). */
  readonly visibleIntervals?: readonly ChartInterval[];
}

export const EMPTY_SETTINGS: ScriptSettings = { inputs: {}, properties: {}, plotStyles: {} };

export interface ScriptVersion {
  readonly code: string;
  readonly savedAt: number;
}

export interface SavedScript {
  readonly id: string;
  readonly name: string;
  readonly kind: ScriptKind;
  /** Oldest first; the last entry is the current code. */
  readonly versions: readonly ScriptVersion[];
  readonly isFavorite: boolean;
  readonly openedAt: number;
  readonly settings?: ScriptSettings;
}

export type ScriptLibrary = readonly SavedScript[];

const STORAGE_KEY = "pine-ts-workbench-script-library";
const MAX_VERSIONS = 50;
export const RECENT_COUNT = 5;

export const currentCode = (script: SavedScript): string => script.versions.at(-1)?.code ?? "";

/** The script's kind and title as written: `defineStrategy("Name"` / `indicator("Name"`. */
export const describeCode = (code: string): { kind: ScriptKind; title: string | undefined } => {
  const strategy = /\bdefineStrategy\s*\(\s*(["'`])(.*?)\1/.exec(code);
  if (strategy !== null || /\bfunction\s+strategy\b/.test(code)) return { kind: "strategy", title: strategy?.[2] };
  const indicator = /\bindicator\s*\(\s*(["'`])(.*?)\1/.exec(code);
  return { kind: "indicator", title: indicator?.[2] };
};

/** A name not used by another script: "RSI", then "RSI 1", "RSI 2", ... like TradingView copies. */
export const uniqueName = (library: ScriptLibrary, base: string): string => {
  const taken = new Set(library.map((s) => s.name));
  if (!taken.has(base)) return base;
  let suffix = 1;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
};

export const createScript = (
  library: ScriptLibrary,
  { code, name, now, id }: { code: string; name?: string; now: number; id: string },
): ScriptLibrary => {
  const described = describeCode(code);
  const script: SavedScript = {
    id,
    name: uniqueName(library, name ?? described.title ?? "Untitled script"),
    kind: described.kind,
    versions: [{ code, savedAt: now }],
    isFavorite: false,
    openedAt: now,
  };
  return [...library, script];
};

const update = (library: ScriptLibrary, id: string, change: (script: SavedScript) => SavedScript): ScriptLibrary =>
  library.map((script) => (script.id === id ? change(script) : script));

/** Appends a version when the code changed; older versions beyond the cap are dropped. */
export const saveVersion = (library: ScriptLibrary, id: string, code: string, now: number): ScriptLibrary =>
  update(library, id, (script) => {
    if (currentCode(script) === code) return script;
    const versions = [...script.versions, { code, savedAt: now }].slice(-MAX_VERSIONS);
    return { ...script, kind: describeCode(code).kind, versions };
  });

export const renameScript = (library: ScriptLibrary, id: string, name: string): ScriptLibrary => {
  const trimmed = name.trim();
  if (trimmed === "") return library;
  const others = library.filter((s) => s.id !== id);
  return update(library, id, (script) => ({ ...script, name: uniqueName(others, trimmed) }));
};

export const toggleFavorite = (library: ScriptLibrary, id: string): ScriptLibrary =>
  update(library, id, (script) => ({ ...script, isFavorite: !script.isFavorite }));

export const markOpened = (library: ScriptLibrary, id: string, now: number): ScriptLibrary =>
  update(library, id, (script) => ({ ...script, openedAt: now }));

export const updateSettings = (library: ScriptLibrary, id: string, settings: ScriptSettings): ScriptLibrary =>
  update(library, id, (script) => ({ ...script, settings }));

export const deleteScript = (library: ScriptLibrary, id: string): ScriptLibrary => library.filter((s) => s.id !== id);

export const recentlyUsed = (library: ScriptLibrary): SavedScript[] =>
  [...library].sort((a, b) => b.openedAt - a.openedAt).slice(0, RECENT_COUNT);

export const loadLibrary = (): ScriptLibrary => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? [] : (JSON.parse(raw) as ScriptLibrary);
  } catch {
    return []; // Storage blocked or corrupt: start with an empty library.
  }
};

/** Returns false when browser storage refused the write (private mode, quota). */
export const persistLibrary = (library: ScriptLibrary): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
};
