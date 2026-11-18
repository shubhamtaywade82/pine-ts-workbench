import { TF_MS, type TerminalParams } from "./terminal-types";

// Bump when a saved shape stops being compatible; old data is then ignored instead of misread.
const STORAGE_KEY = "smc-terminal:v1";

export interface PersistedTerminal {
  params: TerminalParams;
  tf: number;
  isSoundOn: boolean;
  isLiveFeed: boolean;
}

/** Keeps a saved value only if it has the same type as the default; new params then fall back cleanly. */
function mergeParams(defaults: TerminalParams, saved: unknown): TerminalParams {
  if (typeof saved !== "object" || saved === null) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = (saved as Record<string, unknown>)[key];
    if (typeof value === typeof fallback) merged[key] = value;
  }
  return merged as unknown as TerminalParams;
}

export function loadTerminalState(defaults: PersistedTerminal): PersistedTerminal {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Record<keyof PersistedTerminal, unknown>>;
    return {
      params: mergeParams(defaults.params, saved.params),
      tf: typeof saved.tf === "number" && saved.tf in TF_MS ? saved.tf : defaults.tf,
      isSoundOn: typeof saved.isSoundOn === "boolean" ? saved.isSoundOn : defaults.isSoundOn,
      isLiveFeed: typeof saved.isLiveFeed === "boolean" ? saved.isLiveFeed : defaults.isLiveFeed,
    };
  } catch {
    return defaults;
  }
}

export function saveTerminalState(state: PersistedTerminal): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be full or blocked (private mode); the terminal still works, just without memory.
  }
}
