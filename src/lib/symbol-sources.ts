import { BINANCE_REST_URL } from "@/lib/binance-endpoints";
import type { Instrument } from "@nemesis-oss/dhanhq-sdk";
import { getDhanClient } from "@/lib/dhan-client";
import type { SymbolCategory, SymbolExchange, SymbolOption } from "@/lib/symbol-catalog";

/**
 * Every tradable instrument behind the symbol search: Binance spot, CoinDCX and Dhan.
 * Server-side only. The market lists are large, so each is fetched once and kept for an hour;
 * Dhan caches its own scrip master.
 */

const MARKET_LIST_TTL_MS = 3_600_000;
const COINDCX_MARKETS_URL = "https://api.coindcx.com/exchange/v1/markets_details";
const PER_SOURCE_LIMIT = 40;
// Dhan returns matches in file order, so over-fetch and rank before cutting to PER_SOURCE_LIMIT.
const DHAN_FETCH_LIMIT = 400;
// The quotes people trade first, so "DOGE / USDT" is listed before "DOGE / U".
const QUOTE_ORDER: readonly string[] = ["USDT", "USDC", "FDUSD", "INR", "BTC", "ETH", "BNB"];

// "All" leaves out derivatives: a stock has thousands of option contracts that would bury it.
const DHAN_SEGMENTS: Readonly<Record<Exclude<SymbolCategory, "crypto">, readonly string[]>> = {
  all: ["IDX_I", "NSE_EQ", "BSE_EQ"],
  index: ["IDX_I"],
  stock: ["NSE_EQ", "BSE_EQ"],
  derivative: ["NSE_FNO", "BSE_FNO", "MCX_COMM", "NSE_COMM"],
};

interface Market { readonly base: string; readonly quote: string; readonly id: string; readonly name?: string }

const cached = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let hit: { readonly at: number; readonly value: T } | undefined;
  return async () => {
    if (hit === undefined || Date.now() - hit.at > MARKET_LIST_TTL_MS) hit = { at: Date.now(), value: await load() };
    return hit.value;
  };
};

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
};

const binanceMarkets = cached(async (): Promise<readonly Market[]> => {
  const info = await getJson<{ symbols: { symbol: string; status: string; baseAsset: string; quoteAsset: string }[] }>(
    `${BINANCE_REST_URL}/api/v3/exchangeInfo?permissions=SPOT`,
  );
  return info.symbols
    .filter((s) => s.status === "TRADING")
    .map((s) => ({ id: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
});

const coindcxMarkets = cached(async (): Promise<readonly Market[]> => {
  const rows = await getJson<{ pair: string; status: string; target_currency_short_name: string; base_currency_short_name: string; target_currency_name?: string }[]>(
    COINDCX_MARKETS_URL,
  );
  return rows
    .filter((r) => r.status === "active")
    .map((r) => ({ id: r.pair, base: r.target_currency_short_name, quote: r.base_currency_short_name, name: r.target_currency_name }));
});

/** Best matches first: the exact coin, then coins starting with the query, then anything containing it. */
const matchMarkets = (markets: readonly Market[], query: string): Market[] => {
  const q = query.toUpperCase();
  const rank = (m: Market): number => {
    if (m.base === q) return 0;
    if (m.base.startsWith(q)) return 1;
    return m.id.includes(q) || m.name?.toUpperCase().includes(q) === true ? 2 : 3;
  };
  const quoteRank = (m: Market): number => (QUOTE_ORDER.includes(m.quote) ? QUOTE_ORDER.indexOf(m.quote) : QUOTE_ORDER.length);
  return markets.filter((m) => rank(m) < 3).sort((a, b) => rank(a) - rank(b) || quoteRank(a) - quoteRank(b)).slice(0, PER_SOURCE_LIMIT);
};

const binanceOption = (m: Market): SymbolOption => ({
  ticker: m.id, displayName: `${m.base} / ${m.quote}`, provider: "binance", exchange: "BINANCE", category: "crypto", binanceSymbol: m.id,
});

const coindcxOption = (m: Market): SymbolOption => ({
  ticker: `CDCX:${m.id}`,
  displayName: `${m.base} / ${m.quote}${m.name === undefined ? "" : ` · ${m.name}`}`,
  provider: "coindcx", exchange: "COINDCX", category: "crypto",
  // Not a Binance feed: this only names the market for higher-timeframe lookups.
  binanceSymbol: `${m.base}${m.quote}`, coindcxPair: m.id,
});

const dhanExchange = (exchange: string | undefined): SymbolExchange => (exchange === "BSE" || exchange === "MCX" ? exchange : "NSE");

const dhanCategory = (segment: string): SymbolOption["category"] =>
  segment === "IDX_I" ? "index" : segment.endsWith("_EQ") ? "stock" : "derivative";

const dhanOption = (i: Instrument): SymbolOption | undefined => {
  const segment = i.exchangeSegment;
  const name = i.symbolName;
  if (segment === undefined || name === undefined) return undefined;
  const exchange = dhanExchange(i.exchange);
  const category = dhanCategory(segment);
  // Option and future contracts share a symbol name (every MCX GOLD contract is "GOLD"), so the contract's
  // own display name identifies it; stocks and indices use the plain symbol, like the built-in tickers.
  const ticker = category === "derivative" ? `${exchange}:${i.displayName ?? name}` : `${exchange}:${i.underlyingSymbol || name}`;
  return { ticker, displayName: i.displayName ?? name, provider: "dhan", exchange, category, binanceSymbol: "BTCUSDT", dhanSecurityId: i.securityId, dhanSegment: segment };
};

/** Exact symbol first, then symbols starting with the query, then the shortest names. */
const rankDhan = (found: readonly SymbolOption[], query: string): SymbolOption[] => {
  const q = query.toUpperCase();
  const rank = (s: SymbolOption): number => {
    const name = s.ticker.slice(s.ticker.indexOf(":") + 1).toUpperCase();
    const display = s.displayName.toUpperCase();
    if (name === q || display === q) return 0;
    return name.startsWith(q) || display.startsWith(q) ? 1 : 2;
  };
  return [...found].sort((a, b) => rank(a) - rank(b) || a.displayName.length - b.displayName.length).slice(0, PER_SOURCE_LIMIT);
};

/** Two instruments can share a name (two "NIFTY 500" indices); the later one gets its security id, so tickers stay unique keys. */
const uniqueTickers = (options: readonly SymbolOption[]): SymbolOption[] => {
  const seen = new Set<string>();
  return options.map((option) => {
    if (!seen.has(option.ticker)) { seen.add(option.ticker); return option; }
    return { ...option, ticker: `${option.ticker} #${option.dhanSecurityId}` };
  });
};

const searchDhan = async (query: string, category: Exclude<SymbolCategory, "crypto">): Promise<SymbolOption[]> => {
  const client = await getDhanClient();
  const found = await client.instruments.search(query, { segments: [...DHAN_SEGMENTS[category]], limit: DHAN_FETCH_LIMIT });
  // The scrip master can list one instrument under more than one row.
  const distinct = new Map(found.flatMap((i) => dhanOption(i) ?? []).map((o) => [`${o.dhanSegment}:${o.dhanSecurityId}`, o] as const));
  return uniqueTickers(rankDhan([...distinct.values()], query));
};

export interface SymbolSearchResult { readonly symbols: readonly SymbolOption[]; readonly warnings: readonly string[] }

/** Search every provider at once; a provider that fails costs its results and adds a warning, not the whole search. */
export const searchAllSymbols = async (query: string, category: SymbolCategory): Promise<SymbolSearchResult> => {
  const wantsCrypto = category === "all" || category === "crypto";
  const wantsDhan = category !== "crypto";
  const jobs: { readonly name: string; readonly run: () => Promise<SymbolOption[]> }[] = [
    ...(wantsCrypto ? [
      { name: "Binance", run: async () => matchMarkets(await binanceMarkets(), query).map(binanceOption) },
      { name: "CoinDCX", run: async () => matchMarkets(await coindcxMarkets(), query).map(coindcxOption) },
    ] : []),
    ...(wantsDhan ? [{ name: "Dhan", run: () => searchDhan(query, category as Exclude<SymbolCategory, "crypto">) }] : []),
  ];
  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const warnings = settled.flatMap((r, i) => (r.status === "rejected"
    ? [`${jobs[i]!.name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`]
    : []));
  return { symbols: settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])), warnings };
};
