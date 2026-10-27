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
