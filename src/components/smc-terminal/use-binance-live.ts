import { useEffect, useRef, useState } from "react";
import {
  fetchHistoricalBars, fetchTickSize, openMarketStream, type ChartInterval,
} from "@/lib/public-binance-feed";
import { fetchSnapshot } from "@/lib/depth-feed-browser";
import type { Bar, MarketEvent } from "./terminal-types";
import { buildIntraBarPath } from "./terminal-simulation";

interface LiveFeedCallbacks {
  onHistoricalLoaded: (bars: Bar[], book: Map<number, number>, tick: number) => void;
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

function parseDepthBook(
  bids: readonly (readonly [string, string])[],
  asks: readonly (readonly [string, string])[],
  tick: number,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const [pStr, qStr] of [...bids, ...asks]) {
    const p = parseFloat(pStr);
    const q = parseFloat(qStr);
    if (!Number.isNaN(p) && !Number.isNaN(q)) {
      const idx = Math.round(p / tick);
      map.set(idx, (map.get(idx) || 0) + q);
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
    let tick = 0;

    const loadInitialData = async () => {
      try {
        const [rawBars, depth, tickSize] = await Promise.all([
          fetchHistoricalBars(symbol, interval, 200),
          fetchSnapshot(symbol, 100),
          fetchTickSize(symbol),
        ]);
        tick = tickSize;
        if (isDisposed) return;
        const converted = convertBars(rawBars);
        const book = parseDepthBook(depth.bids, depth.asks, tick);
        cbRef.current.onHistoricalLoaded(converted, book, tick);
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

    const depthPollInterval = setInterval(async () => {
      if (isDisposed || tick === 0) return;
      try {
        const depth = await fetchSnapshot(symbol, 100);
        if (!isDisposed) {
          const book = parseDepthBook(depth.bids, depth.asks, tick);
          cbRef.current.onHistoricalLoaded([], book, tick);
        }
      } catch {
        // Depth poll error
      }
    }, 4000);

    return () => {
      isDisposed = true;
      clearInterval(depthPollInterval);
      closeStream();
    };
  }, [symbol, timeframe, isLiveMode]);

  return { isConnected };
}
