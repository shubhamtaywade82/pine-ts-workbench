"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { countBarGaps, mergeBar, type LiveBars, type LiveStatus } from "@/hooks/use-live-bars";
import { INTERVAL_MS, type ChartInterval } from "@/lib/public-binance-feed";

const HISTORY_BARS = 1000;
/** Dhan has no per-bar push here, so the forming bar is refreshed by polling the newest few bars. */
const POLL_MS = 5_000;
const POLL_BARS = 3;

const fetchBars = async (ticker: string, interval: string, limit: number): Promise<readonly Bar[]> => {
  const params = new URLSearchParams({ ticker, interval, limit: String(limit) });
  const res = await fetch(`/api/dhan/bars?${params}`);
  const body = (await res.json()) as { ok: boolean; bars?: readonly Bar[]; error?: string };
  if (!body.ok || body.bars === undefined) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.bars;
};

/**
 * DhanHQ candles for a catalog ticker (e.g. "NSE:NIFTY50"): one history load, then the newest
 * bars are re-polled every few seconds. Same shape as `useLiveBars` so ChartCell can use either.
 * `enabled=false` keeps the hook idle (Binance symbols).
 */
export function useDhanBars(ticker: string, interval: ChartInterval, enabled: boolean): LiveBars {
  const [bars, setBars] = useState<readonly Bar[]>([]);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<number | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const workingRef = useRef<readonly Bar[]>([]);
  const listenersRef = useRef(new Set<(bars: readonly Bar[]) => void>());

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
    if (!enabled) return;
    let cancelled = false;
    workingRef.current = [];
    setBars([]);
    setStatus("loading");
    setError(null);

    const load = async () => {
      try {
        publish(await fetchBars(ticker, interval, HISTORY_BARS));
        setStatus("live");
        setLastTickAt(Date.now());
      } catch (err) {
        if (!cancelled) { setError(`Failed to load ${ticker} ${interval} from Dhan: ${err instanceof Error ? err.message : String(err)}`); setStatus("reconnecting"); }
      }
    };

    const poll = async () => {
      try {
        const fresh = await fetchBars(ticker, interval, POLL_BARS);
        if (cancelled || workingRef.current.length === 0) return;
        publish(fresh.reduce(mergeBar, workingRef.current));
        setStatus("live");
        setError(null);
        setLastTickAt(Date.now());
      } catch (err) {
        if (!cancelled) setStatus("reconnecting");
        console.warn("[dhan bars] poll failed", err);
      }
    };

    void load();
    const timer = setInterval(() => void (workingRef.current.length === 0 ? load() : poll()), POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [ticker, interval, enabled, publish]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // Older history isn't paged yet: the chart opens with the latest HISTORY_BARS.
  const loadOlder = useCallback(() => undefined, []);

  const intervalMs = INTERVAL_MS[interval];
  const lastTickAgeMs = lastTickAt === undefined ? undefined : nowTick - lastTickAt;
  const health = {
    lastTickAgeMs,
    isStale: status === "live" && lastTickAgeMs !== undefined && lastTickAgeMs > Math.max(intervalMs * 3, POLL_MS * 3),
    gapCount: bars.length > 1 ? countBarGaps(bars, intervalMs) : 0,
    lastBarTime: bars.at(-1)?.time,
  };

  return { bars, status, error, health, loadOlder, subscribe };
}
