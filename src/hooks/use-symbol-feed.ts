"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { countBarGaps, mergeBar, useLiveBars, type LiveBars, type LiveStatus } from "@/hooks/use-live-bars";
import { INTERVAL_MS, type ChartInterval } from "@/lib/public-binance-feed";
import { countSessionGaps, IST_OFFSET_MS, isSessionClosed } from "@/lib/session-bars";
import { startPolling } from "@/lib/visible-polling";
import type { SymbolOption } from "@/lib/symbol-catalog";

const HISTORY_BARS = 1000;
/** Dhan and CoinDCX have no per-bar push here, so the forming bar is refreshed by polling the newest few bars. */
const POLL_MS = 5_000;
/** While the newest bar stops changing (a closed market, a quiet stock) polling slows to this; it pauses with the tab. */
const QUIET_POLL_MS = 60_000;
/** How often the "age of the last update" label is refreshed; it does not need to tick every second. */
const AGE_TICK_MS = 5_000;
const POLL_BARS = 3;

/** A REST candle source for providers without a socket: where to fetch, and what to call it. */
interface PolledSource {
  readonly label: string;
  /** Trades in sessions with a close (NSE, BSE, MCX): stale tails and overnight breaks are not data problems. */
  readonly isSessionMarket: boolean;
  /** Request URL up to the interval; the history size is appended. */
  readonly endpoint: string;
}

const pollSourceOf = (symbol: SymbolOption, interval: ChartInterval): PolledSource | undefined => {
  if (symbol.provider === "dhan") {
    const { dhanSegment: segment = "", dhanSecurityId: securityId = "" } = symbol;
    return {
      label: "DhanHQ",
      isSessionMarket: true,
      endpoint: `/api/dhan/bars?${new URLSearchParams({ segment, securityId, interval })}`,
    };
  }
  if (symbol.provider === "coindcx") {
    const pair = symbol.coindcxPair ?? "";
    return {
      label: "CoinDCX",
      isSessionMarket: false,
      endpoint: `/api/coindcx/candles?${new URLSearchParams({ pair, interval })}`,
    };
  }
  return undefined;
};

interface FetchedBars { readonly bars: readonly Bar[]; readonly closedSince: number | undefined }

const fetchBars = async (endpoint: string, limit: number): Promise<FetchedBars> => {
  const res = await fetch(`${endpoint}&limit=${limit}`);
  const body = (await res.json()) as { ok: boolean; bars?: readonly Bar[]; closedSince?: number; error?: string };
  if (!body.ok || body.bars === undefined) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { bars: body.bars, closedSince: body.closedSince };
};

/**
 * Candles from a REST source: one history load, then the newest bars are re-polled every few
 * seconds. Same shape as `useLiveBars` so ChartCell can use either. Idle while `source` is undefined.
 */
function usePolledBars(source: PolledSource | undefined, name: string, interval: ChartInterval): LiveBars & { readonly isMarketClosed: boolean } {
  const [bars, setBars] = useState<readonly Bar[]>([]);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastTickAt, setLastTickAt] = useState<number | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [hasClosed, setHasClosed] = useState(false);
  const workingRef = useRef<readonly Bar[]>([]);
  const listenersRef = useRef(new Set<(bars: readonly Bar[]) => void>());
  const endpoint = source?.endpoint;
  const isSession = source?.isSessionMarket ?? false;
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
        publish(history.bars);
        setHasClosed(history.closedSince !== undefined);
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
        publish(fresh.bars.reduce(mergeBar, workingRef.current));
        setHasClosed(fresh.closedSince !== undefined);
        setStatus("live");
        setError(null);
        setLastTickAt(Date.now());
      } catch (err) {
        if (!cancelled) setStatus("reconnecting");
        console.warn(`[${label} bars] poll failed`, err);
      }
    };

    const newest = (bars: readonly Bar[]): string => { const bar = bars.at(-1); return `${bars.length}:${bar?.time}:${bar?.close}:${bar?.volume}`; };
    const run = async (): Promise<boolean> => {
      const before = newest(workingRef.current);
      await (workingRef.current.length === 0 ? load() : poll());
      return newest(workingRef.current) !== before;
    };
    const stop = startPolling({ run, baseMs: POLL_MS, maxMs: QUIET_POLL_MS });
    return () => { cancelled = true; stop(); };
  }, [endpoint, label, name, interval, publish]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), AGE_TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Older history isn't paged yet: the chart opens with the latest HISTORY_BARS.
  const loadOlder = useCallback(() => undefined, []);
  const subscribeTrades = useCallback(() => () => undefined, []);

  const intervalMs = INTERVAL_MS[interval];
  const lastTickAgeMs = lastTickAt === undefined ? undefined : nowTick - lastTickAt;
  const health = {
    lastTickAgeMs,
    // A quiet feed polls as slowly as QUIET_POLL_MS, so only a gap well beyond that means the feed is stale.
    isStale: status === "live" && lastTickAgeMs !== undefined && lastTickAgeMs > Math.max(intervalMs * 3, QUIET_POLL_MS * 2),
    gapCount: bars.length < 2 ? 0 : isSession ? countSessionGaps(bars, intervalMs, IST_OFFSET_MS) : countBarGaps(bars, intervalMs),
    lastBarTime: bars.at(-1)?.time,
  };

  const isMarketClosed = isSession && isSessionClosed({ hasClosed, lastBarTime: bars.at(-1)?.time, now: nowTick, intervalMs });
  return { bars, status, error, health, loadOlder, subscribe, subscribeTrades, isMarketClosed };
}

/** Candles for any symbol, from whichever provider it belongs to: Binance live socket, Dhan or CoinDCX polled. */
export function useSymbolFeed(symbol: SymbolOption, interval: ChartInterval): LiveBars & { readonly feedName: string; readonly isMarketClosed: boolean } {
  const polled = pollSourceOf(symbol, interval);
  const binance = useLiveBars(symbol.binanceSymbol, interval, polled === undefined);
  const other = usePolledBars(polled, symbol.displayName, interval);
  return polled === undefined ? { ...binance, feedName: "Binance", isMarketClosed: false } : { ...other, feedName: polled.label };
}
