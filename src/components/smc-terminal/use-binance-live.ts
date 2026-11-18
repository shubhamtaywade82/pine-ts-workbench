import { useEffect, useRef, useState } from "react";
import {
  fetchHistoricalBars, fetchTickSize, openMarketStream, type ChartInterval,
} from "@/lib/public-binance-feed";
import { subscribeBook, subscribeDepthWalls, type BookSubscription, type WallsSubscription } from "@/lib/depth-feed-browser";
import { wallOptionsFor, type BookView, type Wall, type WallFrame } from "@/lib/depth-walls";
import { LevelActivity, type ActivityLevel, type LevelFlow } from "@/lib/level-activity";
import type { Bar, MarketEvent } from "./terminal-types";
import { buildIntraBarPath } from "./terminal-simulation";

interface LiveFeedCallbacks {
  onHistoricalLoaded: (bars: Bar[], tick: number) => void;
  onBook: (book: Map<number, number>, tick: number, activity: ReadonlyMap<number, LevelFlow>) => void;
  onLiveTrade: (price: number, quantity: number, aggressor: "buy" | "sell") => void;
  onLiveKline: (bar: Bar) => void;
  onTapeEvent: (event: Omit<MarketEvent, "bar">) => void;
}

const TF_TO_INTERVAL: Record<number, ChartInterval> = {
  1: "1m", 5: "5m", 15: "15m", 60: "1h",
};

function convertBars(rawBars: Awaited<ReturnType<typeof fetchHistoricalBars>>): Bar[] {
  return rawBars.map((b) => {
    const o = b.open;
    const h = b.high;
    const l = b.low;
    const c = b.close;
    return {
      t: b.time, o, h, l, c, v: b.volume, buyR: c >= o ? 0.6 : 0.4,
      path: buildIntraBarPath({ o, c, h, l }),
    };
  });
}

// Depth diffs arrive every ~100ms; repainting walls at 4Hz keeps them live without churning React state.
const BOOK_FLUSH_MS = 250;
// Half-width around mid, in percent, that the shared depth feed must cover.
const BOOK_WINDOW_PCT = 1;

const MAX_TRACKED_WALLS = 10;

function levelsOf(book: BookView, side: "bid" | "ask", tick: number): ActivityLevel[] {
  const merged = new Map<number, number>();
  for (const [price, quantity] of book.levels(side)) {
    const idx = Math.round(price / tick);
    merged.set(idx, (merged.get(idx) ?? 0) + quantity);
  }
  return [...merged].map(([key, quantity]) => ({ key, quantity }));
}

function toTickMap(bids: ActivityLevel[], asks: ActivityLevel[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const { key, quantity } of [...bids, ...asks]) map.set(key, (map.get(key) ?? 0) + quantity);
  return map;
}

type WallEvent = Omit<MarketEvent, "bar">;
export interface TrackedWall { wall: Wall; wasPulled: boolean; wasTested: boolean }

const wallEvent = (type: WallEvent["type"], wall: Wall): WallEvent =>
  ({ type, price: wall.price, size: wall.quantity, side: wall.side });

const isPulledStatus = (wall: Wall): boolean => wall.status === "removed" || wall.status === "reduced";

/** A vanished wall is "broken" only if price traded through it; otherwise it just fell out of the top list. */
const hasPriceCrossed = (wall: Wall, mid: number): boolean =>
  wall.side === "bid" ? mid < wall.price : mid > wall.price;

/** Turns frame-to-frame wall changes into tape events: new, tested, pulled, broken. */
export function diffWalls(tracked: Map<string, TrackedWall>, frame: WallFrame): WallEvent[] {
  const events: WallEvent[] = [];
  const current = new Map<string, Wall>();
  for (const wall of [...frame.bids, ...frame.asks]) current.set(`${wall.side}:${wall.price}`, wall);
  for (const [key, wall] of current) {
    const seen = tracked.get(key);
    if (!seen) events.push(wallEvent("wall", wall));
    const pulledNow = isPulledStatus(wall);
    if (pulledNow && !seen?.wasPulled) events.push(wallEvent("pull", wall));
    const testedNow = wall.status === "tested";
    if (testedNow && !seen?.wasTested) events.push(wallEvent("held", wall));
    tracked.set(key, { wall, wasPulled: pulledNow, wasTested: testedNow || (seen?.wasTested ?? false) });
  }
  for (const [key, { wall }] of tracked) {
    if (current.has(key)) continue;
    if (hasPriceCrossed(wall, frame.mid)) events.push(wallEvent("brk", wall));
    tracked.delete(key);
  }
  return events;
}

export function useBinanceLive(
  symbol: string,
  timeframe: number,
  isLiveMode: boolean,
  callbacks: LiveFeedCallbacks,
) {
  const [isConnected, setIsConnected] = useState(false);
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  });

  useEffect(() => {
    if (!isLiveMode || typeof window === "undefined") {
      setIsConnected(false);
      return undefined;
    }

    let isDisposed = false;
    const interval = TF_TO_INTERVAL[timeframe] || "5m";
    let bookSub: BookSubscription | undefined;
    let wallsSub: WallsSubscription | undefined;
    let tick = 0;
    const activity = new LevelActivity();
    let flushTimer: ReturnType<typeof setInterval> | undefined;

    const startBookStream = () => {
      let latest: BookView | undefined;
      const trackedWalls = new Map<string, TrackedWall>();
      wallsSub = subscribeDepthWalls(symbol, wallOptionsFor(BOOK_WINDOW_PCT, 0, MAX_TRACKED_WALLS), (update) => {
        if (isDisposed || update.frame === undefined) return;
        for (const event of diffWalls(trackedWalls, update.frame)) cbRef.current.onTapeEvent(event);
      });
      bookSub = subscribeBook(symbol, BOOK_WINDOW_PCT, (state) => {
        latest = state.status === "live" ? state.book : undefined;
      });
      flushTimer = setInterval(() => {
        if (isDisposed || latest === undefined) return;
        const bids = levelsOf(latest, "bid", tick);
        const asks = levelsOf(latest, "ask", tick);
        const now = Date.now();
        activity.observeBook(now, bids, asks);
        cbRef.current.onBook(toTickMap(bids, asks), tick, activity.levels(now));
        latest = undefined;
      }, BOOK_FLUSH_MS);
    };

    const loadInitialData = async () => {
      try {
        const [rawBars, tickSize] = await Promise.all([
          fetchHistoricalBars(symbol, interval, 200),
          fetchTickSize(symbol),
        ]);
        if (isDisposed) return;
        tick = tickSize;
        cbRef.current.onHistoricalLoaded(convertBars(rawBars), tick);
        startBookStream();
        setIsConnected(true);
      } catch {
        // Failed to load historical klines or depth
      }
    };

    void loadInitialData();

    const closeStream = openMarketStream(symbol, interval, {
      onOpen: () => setIsConnected(true),
      onClose: () => setIsConnected(false),
      onKline: (kline) => {
        if (isDisposed) return;
        const o = kline.open;
        const h = kline.high;
        const l = kline.low;
        const c = kline.close;
        const bar: Bar = {
          t: kline.time, o, h, l, c, v: kline.volume, buyR: c >= o ? 0.6 : 0.4,
          path: buildIntraBarPath({ o, c, h, l }),
        };
        cbRef.current.onLiveKline(bar);
      },
      onTrade: (trade) => {
        if (isDisposed) return;
        const price = trade.price;
        if (tick > 0) activity.observeTrade({ quantity: trade.quantity, aggressor: trade.aggressor, time: Date.now() }, Math.round(price / tick));
        cbRef.current.onLiveTrade(price, trade.quantity, trade.aggressor);
      },
    });

    return () => {
      isDisposed = true;
      clearInterval(flushTimer);
      bookSub?.unsubscribe();
      wallsSub?.unsubscribe();
      closeStream();
    };
  }, [symbol, timeframe, isLiveMode]);

  return { isConnected };
}
