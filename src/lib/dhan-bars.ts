import { DhanHQProvider, type Bar } from "@nemesis-oss/pine-ts";
import { getDhanClient } from "@/lib/dhan-client";

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

/** Historical bars for a Dhan symbol, session-anchored (NSE 09:15 IST) like TradingView. */
export const fetchDhanBars = async (instrument: DhanInstrumentRef, interval: string, limit: number): Promise<readonly Bar[]> => {
  const timeframe = DHAN_TIMEFRAMES[interval];
  if (timeframe === undefined) throw new RangeError(`Dhan has no ${interval} candles`);
  return (await getProvider()).getHistoricalBars({ symbol: `${instrument.segment}:${instrument.securityId}`, timeframe, limit });
};
