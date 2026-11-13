import type { SymbolCategory, SymbolOption } from "./symbol-catalog";

/**
 * Symbols found by search but not in the built-in catalog. Picking one stores it here, so a reload,
 * a saved layout or the watchlist can still open it without searching again.
 */

const CACHE_KEY = "pine-ts-workbench-remote-symbols";
const CACHE_LIMIT = 300;

const readCache = (): Record<string, SymbolOption> => {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, SymbolOption>) : {};
  } catch {
    return {};
  }
};

export const loadRemoteSymbol = (ticker: string): SymbolOption | undefined => readCache()[ticker];

/** Remembers a searched symbol; the oldest entries go first once the cache is full. */
export const rememberRemoteSymbol = (symbol: SymbolOption): void => {
  if (typeof window === "undefined") return;
  const { [symbol.ticker]: _replaced, ...others } = readCache();
  const kept = Object.entries(others).slice(-(CACHE_LIMIT - 1));
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries([...kept, [symbol.ticker, symbol]])));
  } catch { /* storage full or blocked: the symbol just is not remembered */ }
};

export interface RemoteSearch { readonly symbols: readonly SymbolOption[]; readonly warnings: readonly string[] }

/** Searches every provider through the server; a failed request comes back as a warning, never a throw. */
export const searchRemoteSymbols = async (query: string, category: SymbolCategory, signal: AbortSignal): Promise<RemoteSearch> => {
  try {
    const params = new URLSearchParams({ q: query, category });
    const res = await fetch(`/api/symbols?${params}`, { signal });
    const body = (await res.json()) as { ok: boolean; symbols?: SymbolOption[]; warnings?: string[]; error?: string };
    if (!body.ok) return { symbols: [], warnings: [body.error ?? `HTTP ${res.status}`] };
    return { symbols: body.symbols ?? [], warnings: body.warnings ?? [] };
  } catch (error) {
    if (signal.aborted) return { symbols: [], warnings: [] };
    return { symbols: [], warnings: [error instanceof Error ? error.message : String(error)] };
  }
};
