import { useEffect, useRef, useState } from "react";
import {
  fetchHistoricalBars, fetchTickSize, openMarketStream, type ChartInterval,
} from "@/lib/public-binance-feed";
import { subscribeBook, type BookSubscription } from "@/lib/depth-feed-browser";
import type { BookView } from "@/lib/depth-walls";
import type { Bar, MarketEvent } from "./terminal-types";
import { buildIntraBarPath } from "./terminal-simulation";

interface LiveFeedCallbacks {
  onHistoricalLoaded: (bars: Bar[], tick: number) => void;
  onBook: (book: Map<number, number>, tick: number) => void;
  onLiveTrade: (price: number, quantity: number, aggressor: "buy" | "sell") => void;
  onLiveKline: (bar: Bar) => void;
  onTapeEvent: (event: MarketEvent) => void;
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

function bookToTickMap(book: BookView, tick: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const side of ["bid", "ask"] as const) {
    for (const [price, quantity] of book.levels(side)) {
      const idx = Math.round(price / tick);
      map.set(idx, (map.get(idx) ?? 0) + quantity);
    }
  }
  return map;
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
    let flushTimer: ReturnType<typeof setInterval> | undefined;

    const startBookStream = (tick: number) => {
      let latest: BookView | undefined;
      bookSub = subscribeBook(symbol, BOOK_WINDOW_PCT, (state) => {
        latest = state.status === "live" ? state.book : undefined;
      });
      flushTimer = setInterval(() => {
        if (isDisposed || latest === undefined) return;
        cbRef.current.onBook(bookToTickMap(latest, tick), tick);
        latest = undefined;
      }, BOOK_FLUSH_MS);
    };

    const loadInitialData = async () => {
      try {
        const [rawBars, tick] = await Promise.all([
          fetchHistoricalBars(symbol, interval, 200),
          fetchTickSize(symbol),
        ]);
        if (isDisposed) return;
        cbRef.current.onHistoricalLoaded(convertBars(rawBars), tick);
        startBookStream(tick);
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
        cbRef.current.onLiveTrade(price, trade.quantity, trade.aggressor);
      },
    });

    return () => {
      isDisposed = true;
      clearInterval(flushTimer);
      bookSub?.unsubscribe();
      closeStream();
    };
  }, [symbol, timeframe, isLiveMode]);

  return { isConnected };
}
