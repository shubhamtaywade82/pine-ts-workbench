import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { ISeriesApi } from "lightweight-charts";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { subscribeDepthWalls, type WallsSubscription } from "@/lib/depth-feed";
import { wallOptionsFor } from "@/lib/depth-walls";
import { DepthWallsPrimitive } from "@/components/chart/depth-walls-primitive";
import type { ChartSettings } from "@/lib/chart-settings";

/**
 * Attaches and updates live depth wall bubbles on the candlestick series.
 */
export function useDepthWalls(
  candlestickRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  depthSymbol: BinanceSymbol | undefined,
  tradingSettings: ChartSettings["trading"],
): void {
  const depthWallsRef = useRef<{ series: ISeriesApi<"Candlestick">; primitive: DepthWallsPrimitive } | null>(null);
  const wallsSubscriptionRef = useRef<WallsSubscription | null>(null);

  const { showOrderBookWalls, wallWindowPct, minWallNotional } = tradingSettings;
  const wallOptions = useMemo(
    () => wallOptionsFor(wallWindowPct, minWallNotional),
    [wallWindowPct, minWallNotional],
  );
  const wallOptionsRef = useRef(wallOptions);

  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (depthWallsRef.current?.series !== candle) {
      const primitive = new DepthWallsPrimitive();
      candle.attachPrimitive(primitive);
      depthWallsRef.current = { series: candle, primitive };
    }
    const { primitive } = depthWallsRef.current;
    if (!showOrderBookWalls || depthSymbol === undefined) {
      primitive.setUpdate(undefined);
      return;
    }
    const subscription = subscribeDepthWalls(depthSymbol, wallOptionsRef.current, (update) => primitive.setUpdate(update));
    wallsSubscriptionRef.current = subscription;
    return () => {
      subscription.unsubscribe();
      wallsSubscriptionRef.current = null;
      // Never leave one symbol's walls on another symbol's chart.
      primitive.setUpdate(undefined);
    };
  }, [candlestickRef, depthSymbol, showOrderBookWalls]);

  // Window and minimum changes apply to the live subscription without reopening websocket.
  useEffect(() => {
    wallOptionsRef.current = wallOptions;
    wallsSubscriptionRef.current?.setOptions(wallOptions);
  }, [wallOptions]);
}
