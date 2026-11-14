import type { Bar, HtfBarLoader } from "@nemesis-oss/pine-ts";
import { fetchHtfBars, timeframeToChartInterval } from "@/lib/public-binance-feed";
import { groupSessionBars } from "@/lib/session-bars";
import type { SymbolOption } from "@/lib/symbol-catalog";

/**
 * Higher-timeframe candles for a script's `request.security`, from the same provider as the chart. A Dhan
 * chart used to get Binance's BTC candles here, which put BTC-priced levels on a stock's chart.
 */

export type HtfSource =
  | { readonly kind: "binance"; readonly symbol: string }
  | { readonly kind: "dhan"; readonly segment: string; readonly securityId: string }
  | { readonly kind: "coindcx"; readonly pair: string };

export const htfSourceOf = (symbol: SymbolOption): HtfSource => {
  if (symbol.provider === "dhan") return { kind: "dhan", segment: symbol.dhanSegment ?? "", securityId: symbol.dhanSecurityId ?? "" };
  if (symbol.provider === "coindcx") return { kind: "coindcx", pair: symbol.coindcxPair ?? "" };
  return { kind: "binance", symbol: symbol.binanceSymbol };
};

const CACHE_TTL_MS = 60_000;
const HISTORY_BARS = 1000;
/** Dhan has no 2h or 4h candles: they are grouped from hourly ones, so more of those are needed. */
const GROUPED_HOURLY_BARS = 2000;
const DHAN_NATIVE: ReadonlySet<string> = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "1d"]);
const DHAN_GROUPED: Readonly<Record<string, number>> = { "2h": 2, "4h": 4 };

const cache = new Map<string, { readonly at: number; readonly bars: Bar[] }>();

const fetchApiBars = async (url: string): Promise<Bar[] | undefined> => {
  const hit = cache.get(url);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.bars;
  try {
    const res = await fetch(url);
    const body = (await res.json()) as { ok: boolean; bars?: Bar[] };
    if (!body.ok || body.bars === undefined) return hit?.bars;
    cache.set(url, { at: Date.now(), bars: body.bars });
    return body.bars;
  } catch {
    return hit?.bars;
  }
};

const dhanBars = async (source: { readonly segment: string; readonly securityId: string }, interval: string): Promise<Bar[] | undefined> => {
  const groupSize = DHAN_GROUPED[interval];
  if (groupSize === undefined && !DHAN_NATIVE.has(interval)) return undefined;
  const params = new URLSearchParams({
    segment: source.segment, securityId: source.securityId,
    interval: groupSize === undefined ? interval : "1h",
    limit: String(groupSize === undefined ? HISTORY_BARS : GROUPED_HOURLY_BARS),
  });
  const bars = await fetchApiBars(`/api/dhan/bars?${params}`);
  return bars !== undefined && groupSize !== undefined ? groupSessionBars(bars, groupSize) : bars;
};

/** Loader for `getHtfBars`; undefined for a timeframe the provider cannot serve. Works in the browser and in the script worker. */
export const createHtfLoader = (source: HtfSource): HtfBarLoader => async (timeframe) => {
  const interval = timeframeToChartInterval(timeframe);
  if (interval === undefined) return undefined;
  if (source.kind === "binance") return fetchHtfBars(timeframe, source.symbol);
  if (source.kind === "coindcx") {
    return fetchApiBars(`/api/coindcx/candles?${new URLSearchParams({ pair: source.pair, interval, limit: String(HISTORY_BARS) })}`);
  }
  return dhanBars(source, interval);
};
