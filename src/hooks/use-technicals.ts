"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchHistoricalBars, type BinanceSymbol, type ChartInterval } from "@/lib/public-binance-feed";
import { computeTechnicals, type Technicals } from "@/lib/technicals";

// 200-bar MAs need 200 bars, plus room for warm-up of smoothed oscillators.
const DEFAULT_HISTORY_BARS = 500;
const DEFAULT_REFRESH_MS = 30_000;

export interface UseTechnicalsOptions {
  readonly historyBars?: number;
  readonly refreshMs?: number;
  readonly fetchBars?: typeof fetchHistoricalBars;
  readonly compute?: typeof computeTechnicals;
}

export interface UseTechnicalsResult {
  readonly technicals: Technicals | null;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly reload: () => void;
}

/**
 * Periodically fetches historical candles and evaluates TradingView technical ratings.
 */
export function useTechnicals(
  symbol: BinanceSymbol,
  interval: ChartInterval,
  options: UseTechnicalsOptions = {},
): UseTechnicalsResult {
  const {
    historyBars = DEFAULT_HISTORY_BARS,
    refreshMs = DEFAULT_REFRESH_MS,
    fetchBars = fetchHistoricalBars,
    compute = computeTechnicals,
  } = options;

  const [technicals, setTechnicals] = useState<Technicals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [trigger, setTrigger] = useState(0);

  const reload = useCallback(() => {
    setTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);

    const load = async () => {
      try {
        const bars = await fetchBars(symbol, interval, historyBars);
        const result = await compute(bars);
        if (!isCurrent) return;
        setTechnicals(result);
        setError(null);
      } catch (err) {
        if (!isCurrent) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    setTechnicals(null);
    void load();

    // Skip polling timer if refreshMs is zero or negative (e.g. in test environments).
    if (refreshMs <= 0) return () => { isCurrent = false; };

    const timer = setInterval(() => void load(), refreshMs);
    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [symbol, interval, historyBars, refreshMs, fetchBars, compute, trigger]);

  return { technicals, error, isLoading, reload };
}
