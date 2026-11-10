import type { BinanceSymbol } from "./public-binance-feed";

export type SymbolCategory = "all" | "crypto" | "index" | "stock";
export type SymbolExchange = "BINANCE" | "NSE" | "BSE";

export interface SymbolOption {
  readonly ticker: string;
  readonly displayName: string;
  readonly provider: "binance" | "dhan";
  readonly exchange: SymbolExchange;
  readonly category: Exclude<SymbolCategory, "all">;
  /** Present when provider is "binance". */
  readonly binanceSymbol: BinanceSymbol;
  /** Present when provider is "dhan". */
  readonly dhanSecurityId?: string;
  readonly dhanSegment?: string;
}

export const SYMBOL_CATALOG: readonly SymbolOption[] = [
  // Crypto (Binance)
  { ticker: "BTCUSDT", displayName: "BTC / USDT", provider: "binance", exchange: "BINANCE", category: "crypto", binanceSymbol: "BTCUSDT" },
  { ticker: "ETHUSDT", displayName: "ETH / USDT", provider: "binance", exchange: "BINANCE", category: "crypto", binanceSymbol: "ETHUSDT" },
  { ticker: "SOLUSDT", displayName: "SOL / USDT", provider: "binance", exchange: "BINANCE", category: "crypto", binanceSymbol: "SOLUSDT" },
  { ticker: "BNBUSDT", displayName: "BNB / USDT", provider: "binance", exchange: "BINANCE", category: "crypto", binanceSymbol: "BNBUSDT" },
  // Indian Equities & Indices (DhanHQ)
  { ticker: "NSE:NIFTY50", displayName: "NIFTY 50", provider: "dhan", exchange: "NSE", category: "index", binanceSymbol: "BTCUSDT", dhanSecurityId: "13", dhanSegment: "IDX_I" },
  { ticker: "NSE:BANKNIFTY", displayName: "BANK NIFTY", provider: "dhan", exchange: "NSE", category: "index", binanceSymbol: "BTCUSDT", dhanSecurityId: "25", dhanSegment: "IDX_I" },
  { ticker: "BSE:SENSEX", displayName: "SENSEX", provider: "dhan", exchange: "BSE", category: "index", binanceSymbol: "BTCUSDT", dhanSecurityId: "51", dhanSegment: "IDX_I" },
  { ticker: "NSE:RELIANCE", displayName: "Reliance Industries", provider: "dhan", exchange: "NSE", category: "stock", binanceSymbol: "BTCUSDT", dhanSecurityId: "2885", dhanSegment: "NSE_EQ" },
  { ticker: "NSE:TCS", displayName: "Tata Consultancy Services", provider: "dhan", exchange: "NSE", category: "stock", binanceSymbol: "BTCUSDT", dhanSecurityId: "11536", dhanSegment: "NSE_EQ" },
  { ticker: "NSE:INFY", displayName: "Infosys Ltd", provider: "dhan", exchange: "NSE", category: "stock", binanceSymbol: "BTCUSDT", dhanSecurityId: "1594", dhanSegment: "NSE_EQ" },
  { ticker: "NSE:HDFCBANK", displayName: "HDFC Bank Ltd", provider: "dhan", exchange: "NSE", category: "stock", binanceSymbol: "BTCUSDT", dhanSecurityId: "1333", dhanSegment: "NSE_EQ" },
  { ticker: "NSE:ICICIBANK", displayName: "ICICI Bank Ltd", provider: "dhan", exchange: "NSE", category: "stock", binanceSymbol: "BTCUSDT", dhanSecurityId: "4963", dhanSegment: "NSE_EQ" },
  { ticker: "NSE:TATAMOTORS", displayName: "Tata Motors Ltd", provider: "dhan", exchange: "NSE", category: "stock", binanceSymbol: "BTCUSDT", dhanSecurityId: "3456", dhanSegment: "NSE_EQ" },
];

export const DEFAULT_WATCHLIST: readonly string[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "NSE:NIFTY50",
  "NSE:RELIANCE",
];

const WATCHLIST_STORAGE_KEY = "pine-ts-workbench-watchlist";

export function findSymbol(tickerOrSymbol: string): SymbolOption | undefined {
  const normalized = tickerOrSymbol.toUpperCase().trim();
  return (
    SYMBOL_CATALOG.find((s) => s.ticker.toUpperCase() === normalized) ??
    SYMBOL_CATALOG.find((s) => s.binanceSymbol.toUpperCase() === normalized)
  );
}

export function searchSymbols(
  query: string,
  category: SymbolCategory = "all",
): readonly SymbolOption[] {
  const q = query.toLowerCase().trim();
  return SYMBOL_CATALOG.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (q === "") return true;
    return (
      item.ticker.toLowerCase().includes(q) ||
      item.displayName.toLowerCase().includes(q) ||
      item.exchange.toLowerCase().includes(q)
    );
  });
}

// ---------------------------------------------------------------------------
// Fuzzy search + recents + favorites (P0 symbol search)
// ---------------------------------------------------------------------------

/**
 * Subsequence fuzzy score for a query against a target (higher = better).
 * Exact prefix > word-boundary > contiguous substring > scattered subsequence.
 * Returns -1 when the query is not a subsequence of the target at all.
 */
export const fuzzyScore = (query: string, target: string): number => {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q === "") return 0;
  if (t === q) return 1_000;
  if (t.startsWith(q)) return 800 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) {
    // Word-boundary hits ("re" → "RELIANCE" ticker over "reliance" inside prose).
    const boundary = idx === 0 || /[^a-z0-9]/.test(t[idx - 1]!);
    return (boundary ? 550 : 400) - idx;
  }
  // Scattered subsequence: "btu" matches "BTCUSDT" (B…T…U).
  let qi = 0;
  let gaps = 0;
  let last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      if (last >= 0) gaps += ti - last - 1;
      last = ti;
      qi += 1;
    }
  }
  if (qi < q.length) return -1;
  return 200 - gaps * 5;
};

const RECENTS_KEY = "pine-ts-workbench-recent-symbols";
const FAVORITES_KEY = "pine-ts-workbench-favorite-symbols";
const RECENTS_LIMIT = 8;

const readList = (key: string, fallback: readonly string[]): readonly string[] => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : fallback;
  } catch {
    return fallback;
  }
};

const writeList = (key: string, list: readonly string[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch { /* storage unavailable */ }
};

/** Most-recently-picked symbols (newest first), for the search dialog. */
export const loadRecentSymbols = (): readonly string[] => readList(RECENTS_KEY, []);

export const rememberSymbol = (ticker: string): readonly string[] => {
  const next = [ticker, ...readList(RECENTS_KEY, []).filter((t) => t !== ticker)].slice(0, RECENTS_LIMIT);
  writeList(RECENTS_KEY, next);
  return next;
};

/** Starred symbols, pinned above search results. */
export const loadFavoriteSymbols = (): readonly string[] => readList(FAVORITES_KEY, []);

export const toggleFavoriteSymbol = (ticker: string): readonly string[] => {
  const current = readList(FAVORITES_KEY, []);
  const next = current.includes(ticker)
    ? current.filter((t) => t !== ticker)
    : [...current, ticker];
  writeList(FAVORITES_KEY, next);
  return next;
};

/**
 * Ranked fuzzy search across the catalog (best match first). Favorites get a
 * flat boost so they surface when scores are otherwise close.
 */
export function fuzzySearchSymbols(
  query: string,
  category: SymbolCategory = "all",
  favorites: readonly string[] = [],
): readonly SymbolOption[] {
  const inCategory = SYMBOL_CATALOG.filter(
    (item) => category === "all" || item.category === category,
  );
  const q = query.trim();
  if (q === "") return inCategory;
  return inCategory
    .map((item) => {
      const best = Math.max(
        fuzzyScore(q, item.ticker),
        fuzzyScore(q, item.displayName),
      );
      if (best < 0) return null;
      // Favorites get a flat boost that outranks word-boundary differences.
      const boost = favorites.includes(item.ticker) ? 300 : 0;
      return { item, score: best + boost };
    })
    .filter((r): r is { item: SymbolOption; score: number } => r !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

export function loadWatchlist(): readonly string[] {
  if (typeof window === "undefined") return DEFAULT_WATCHLIST;
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (raw === null) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

export function saveWatchlist(tickers: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(tickers));
  } catch { /* localStorage unavailable */ }
}

interface SymbolFilter {
  readonly filterType: string;
  readonly tickSize?: string;
  readonly stepSize?: string;
}

interface ExchangeInfo {
  readonly symbols?: readonly { readonly symbol: string; readonly filters?: readonly SymbolFilter[] }[];
}

const positiveSize = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Tick and step from `PRICE_FILTER` and `LOT_SIZE`. Undefined when either size is missing. */
export const parseInstrumentFilters = (
  exchangeInfo: ExchangeInfo,
  symbol: string,
): { tickSize: number; stepSize: number } | undefined => {
  const filters = exchangeInfo.symbols?.find((row) => row.symbol === symbol)?.filters;
  if (filters === undefined) return undefined;
  const tickSize = positiveSize(filters.find((filter) => filter.filterType === "PRICE_FILTER")?.tickSize);
  const stepSize = positiveSize(filters.find((filter) => filter.filterType === "LOT_SIZE")?.stepSize);
  if (tickSize === undefined || stepSize === undefined) return undefined;
  return { tickSize, stepSize };
};

const EXCHANGE_INFO_URL = "https://data-api.binance.vision/api/v3/exchangeInfo";

export const fetchInstrumentFilters = async (
  symbol: string,
): Promise<{ tickSize: number; stepSize: number } | undefined> => {
  const res = await fetch(`${EXCHANGE_INFO_URL}?symbol=${symbol}`);
  if (!res.ok) return undefined;
  return parseInstrumentFilters((await res.json()) as ExchangeInfo, symbol);
};

const tickCache = new Map<string, Promise<number | undefined>>();

const settleTick = (symbol: string, tick: number | undefined): number | undefined => {
  if (tick === undefined) tickCache.delete(symbol);
  return tick;
};

/** Cached exchange tick. A miss is dropped so the next call tries the exchange again. */
export const loadTickSize = (symbol: string): Promise<number | undefined> => {
  const cached = tickCache.get(symbol);
  if (cached !== undefined) return cached;
  const pending = fetchInstrumentFilters(symbol)
    .then((filters) => settleTick(symbol, filters?.tickSize))
    .catch(() => settleTick(symbol, undefined));
  tickCache.set(symbol, pending);
  return pending;
};
