"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { countBarGaps, mergeBar, useLiveBars, type LiveBars, type LiveStatus } from "@/hooks/use-live-bars";
import { INTERVAL_MS, type ChartInterval } from "@/lib/public-binance-feed";
import type { SymbolOption } from "@/lib/symbol-catalog";

const HISTORY_BARS = 1000;
/** Dhan and CoinDCX have no per-bar push here, so the forming bar is refreshed by polling the newest few bars. */
const POLL_MS = 5_000;
const POLL_BARS = 3;

/** A REST candle source for providers without a socket: where to fetch, and what to call it. */
interface PolledSource {
  readonly label: string;
  /** Request URL up to the interval; the history size is appended. */
  readonly endpoint: string;
}

const pollSourceOf = (symbol: SymbolOption, interval: ChartInterval): PolledSource | undefined => {
  if (symbol.provider === "dhan") {
    const { dhanSegment: segment = "", dhanSecurityId: securityId = "" } = symbol;
    return {
      label: "DhanHQ",
      endpoint: `/api/dhan/bars?${new URLSearchParams({ segment, securityId, interval })}`,
    };
  }
  if (symbol.provider === "coindcx") {
    const pair = symbol.coindcxPair ?? "";
    return {
      label: "CoinDCX",
      endpoint: `/api/coindcx/candles?${new URLSearchParams({ pair, interval })}`,
    };
  }
  return undefined;
};

const fetchBars = async (endpoint: string, limit: number): Promise<readonly Bar[]> => {
  const res = await fetch(`${endpoint}&limit=${limit}`);
  const body = (await res.json()) as { ok: boolean; bars?: readonly Bar[]; error?: string };
  if (!body.ok || body.bars === undefined) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.bars;
};

/**
 * Candles from a REST source: one history load, then the newest bars are re-polled every few
 * seconds. Same shape as `useLiveBars` so ChartCell can use either. Idle while `source` is undefined.
 */
function usePolledBars(source: PolledSource | undefined, name: string, interval: ChartInterval): LiveBars {
  const [bars, setBars] = useState<readonly Bar[]>([]);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<number | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const workingRef = useRef<readonly Bar[]>([]);
  const listenersRef = useRef(new Set<(bars: readonly Bar[]) => void>());
  const endpoint = source?.endpoint;
  const label = source?.label ?? "";

  const publish = useCallback((next: readonly Bar[]) => {
    workingRef.current = next;
    setBars(next);
    for (const listener of listenersRef.current) listener(next);
  }, []);

  const subscribe = useCallback((listener: (bars: readonly Bar[]) => void) => {
    listenersRef.current.add(listener);
    if (workingRef.current.length > 0) listener(workingRef.current);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  useEffect(() => {
    if (endpoint === undefined) return;
    let cancelled = false;
    workingRef.current = [];
    setBars([]);
    setStatus("loading");
    setError(null);

    const load = async () => {
      try {
        const history = await fetchBars(endpoint, HISTORY_BARS);
        if (cancelled) return;
        publish(history);
        setStatus("live");
        setLastTickAt(Date.now());
      } catch (err) {
        if (!cancelled) { setError(`Failed to load ${name} ${interval} from ${label}: ${err instanceof Error ? err.message : String(err)}`); setStatus("reconnecting"); }
      }
    };

    const poll = async () => {
      try {
        const fresh = await fetchBars(endpoint, POLL_BARS);
        if (cancelled || workingRef.current.length === 0) return;
        publish(fresh.reduce(mergeBar, workingRef.current));
        setStatus("live");
        setError(null);
        setLastTickAt(Date.now());
      } catch (err) {
        if (!cancelled) setStatus("reconnecting");
        console.warn(`[${label} bars] poll failed`, err);
      }
    };

    void load();
    const timer = setInterval(() => void (workingRef.current.length === 0 ? load() : poll()), POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [endpoint, label, name, interval, publish]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // Older history isn't paged yet: the chart opens with the latest HISTORY_BARS.
  const loadOlder = useCallback(() => undefined, []);
  const subscribeTrades = useCallback(() => () => undefined, []);

  const intervalMs = INTERVAL_MS[interval];
  const lastTickAgeMs = lastTickAt === undefined ? undefined : nowTick - lastTickAt;
  const health = {
    lastTickAgeMs,
    isStale: status === "live" && lastTickAgeMs !== undefined && lastTickAgeMs > Math.max(intervalMs * 3, POLL_MS * 3),
    gapCount: bars.length > 1 ? countBarGaps(bars, intervalMs) : 0,
    lastBarTime: bars.at(-1)?.time,
  };

  return { bars, status, error, health, loadOlder, subscribe, subscribeTrades };
}

/** Candles for any symbol, from whichever provider it belongs to: Binance live socket, Dhan or CoinDCX polled. */
export function useSymbolFeed(symbol: SymbolOption, interval: ChartInterval): LiveBars & { readonly feedName: string } {
  const polled = pollSourceOf(symbol, interval);
  const binance = useLiveBars(symbol.binanceSymbol, interval, polled === undefined);
  const other = usePolledBars(polled, symbol.displayName, interval);
  return polled === undefined ? { ...binance, feedName: "Binance" } : { ...other, feedName: polled.label };
}
