import { DhanHQProvider, type Bar } from "@nemesis-oss/pine-ts";
import { getDhanClient } from "@/lib/dhan-client";
import { lastTradeTime } from "@/lib/session-bars";

/** Chart intervals the Dhan charts API can serve, mapped to pine-ts timeframes. */
const DHAN_TIMEFRAMES: Readonly<Record<string, string>> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "1d": "D",
};

export const isDhanInterval = (interval: string): boolean => interval in DHAN_TIMEFRAMES;

/** Segments the Dhan charts API serves, and the only ones the route accepts. */
const DHAN_SEGMENTS: ReadonlySet<string> = new Set(["IDX_I", "NSE_EQ", "BSE_EQ", "NSE_FNO", "BSE_FNO", "MCX_COMM", "NSE_COMM"]);

export interface DhanInstrumentRef { readonly segment: string; readonly securityId: string }

export const isDhanInstrument = (segment: string, securityId: string): boolean =>
  DHAN_SEGMENTS.has(segment) && /^\d+$/.test(securityId);

let provider: Promise<DhanHQProvider> | undefined;

// One provider per server process: it caches instrument lookups and the forming bar.
const getProvider = (): Promise<DhanHQProvider> =>
  (provider ??= getDhanClient().then((client) => new DhanHQProvider({ charts: client.charts, instruments: client.instruments })));

// The chart polls every few seconds; trading stops once a day, so a short cache loses nothing.
const STOPPED_AT_TTL_MS = 20_000;
// A full session of 1m bars, so the last real trade is found even long after the close.
const STOPPED_AT_LOOKBACK_BARS = 400;
const stoppedAtCache = new Map<string, { readonly at: number; readonly time: number | undefined }>();

/** When trading stopped, or undefined while the market is live (see `lastTradeTime`). */
const tradingStoppedAt = async (instrument: DhanInstrumentRef): Promise<number | undefined> => {
  const key = `${instrument.segment}:${instrument.securityId}`;
  const hit = stoppedAtCache.get(key);
  if (hit !== undefined && Date.now() - hit.at < STOPPED_AT_TTL_MS) return hit.time;
  const minutes = await (await getProvider()).getHistoricalBars({ symbol: key, timeframe: "1", limit: STOPPED_AT_LOOKBACK_BARS });
  const time = lastTradeTime(minutes);
  stoppedAtCache.set(key, { at: Date.now(), time });
  return time;
};

export interface DhanBars {
  readonly bars: readonly Bar[];
  /** Start of the last minute that really traded, once the market has closed; the bars end there. */
  readonly closedSince?: number;
}

/**
 * Historical bars for a Dhan instrument, session-anchored (NSE 09:15 IST) like TradingView. After the close
 * Dhan invents one bar per minute; those are cut off so the chart ends at the last real trade.
 */
export const fetchDhanBars = async (instrument: DhanInstrumentRef, interval: string, limit: number): Promise<DhanBars> => {
  const timeframe = DHAN_TIMEFRAMES[interval];
  if (timeframe === undefined) throw new RangeError(`Dhan has no ${interval} candles`);
  // A daily bar starts before any intraday cutoff, so daily history needs neither the cutoff nor the call behind it.
  const [bars, closedSince] = await Promise.all([
    (await getProvider()).getHistoricalBars({ symbol: `${instrument.segment}:${instrument.securityId}`, timeframe, limit }),
    interval === "1d" ? undefined : tradingStoppedAt(instrument),
  ]);
  return closedSince === undefined ? { bars } : { bars: bars.filter((b) => b.time <= closedSince), closedSince };
};
