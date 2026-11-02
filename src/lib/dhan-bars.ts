import { DhanHQProvider, type Bar } from "@nemesis-oss/pine-ts";
import { getDhanClient } from "@/lib/dhan-client";
import type { SymbolOption } from "@/lib/symbol-catalog";

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

/** pine-ts composite key "<exchangeSegment>:<securityId>". */
export const dhanSymbolKey = (symbol: SymbolOption): string => {
  if (symbol.provider !== "dhan" || !symbol.dhanSegment || !symbol.dhanSecurityId) {
    throw new RangeError(`${symbol.ticker} is not a Dhan symbol`);
  }
  return `${symbol.dhanSegment}:${symbol.dhanSecurityId}`;
};

let provider: Promise<DhanHQProvider> | undefined;

// One provider per server process: it caches instrument lookups and the forming bar.
const getProvider = (): Promise<DhanHQProvider> =>
  (provider ??= getDhanClient().then((client) => new DhanHQProvider({ charts: client.charts, instruments: client.instruments })));

/** Historical bars for a Dhan symbol, session-anchored (NSE 09:15 IST) like TradingView. */
export const fetchDhanBars = async (symbol: SymbolOption, interval: string, limit: number): Promise<readonly Bar[]> => {
  const timeframe = DHAN_TIMEFRAMES[interval];
  if (timeframe === undefined) throw new RangeError(`Dhan has no ${interval} candles`);
  return (await getProvider()).getHistoricalBars({ symbol: dhanSymbolKey(symbol), timeframe, limit });
};
