import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { IPriceLine, ISeriesApi, SeriesType } from "lightweight-charts";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import { subscribeDepthWalls, type DepthWallsUpdate, type WallsSubscription } from "@/lib/depth-feed";
import { wallOptionsFor } from "@/lib/depth-walls";
import { DepthWallsPrimitive } from "@/components/chart/depth-walls-primitive";
import type { ChartSettings } from "@/lib/chart-settings";

const BID_COLOR = "#089981";
const ASK_COLOR = "#f23645";

/** Attaches live depth wall bubbles and Bid/Ask horizontal price lines to the series. */
export function useDepthWalls(
  candlestickRef: RefObject<ISeriesApi<SeriesType> | null>,
  depthSymbol: BinanceSymbol | undefined,
  tradingSettings: ChartSettings["trading"],
  seriesType?: string,
): void {
  const depthWallsRef = useRef<{ series: ISeriesApi<SeriesType>; primitive: DepthWallsPrimitive } | null>(null);
  const wallsSubscriptionRef = useRef<WallsSubscription | null>(null);
  const bidLineRef = useRef<IPriceLine | null>(null);
  const askLineRef = useRef<IPriceLine | null>(null);

  const { showOrderBookWalls, showBidAskLines, wallWindowPct, minWallNotional } = tradingSettings;
  const wallOptions = useMemo(() => wallOptionsFor(wallWindowPct, minWallNotional), [wallWindowPct, minWallNotional]);
  const wallOptionsRef = useRef(wallOptions);

  const clearLines = (target?: ISeriesApi<SeriesType> | null) => {
    const s = target ?? depthWallsRef.current?.series;
    if (!s) return;
    if (bidLineRef.current) { try { s.removePriceLine(bidLineRef.current); } catch { /* detached */ } bidLineRef.current = null; }
    if (askLineRef.current) { try { s.removePriceLine(askLineRef.current); } catch { /* detached */ } askLineRef.current = null; }
  };

  const syncLines = (series: ISeriesApi<SeriesType>, update: DepthWallsUpdate) => {
    const { bestBid, bestAsk } = update.frame ?? {};
    if (!showBidAskLines || bestBid === undefined || bestAsk === undefined) { clearLines(series); return; }
    if (bidLineRef.current === null) {
      bidLineRef.current = series.createPriceLine({
        price: bestBid, color: BID_COLOR, lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: "Bid", axisLabelColor: BID_COLOR, axisLabelTextColor: "#ffffff",
      });
    } else {
      bidLineRef.current.applyOptions({ price: bestBid });
    }
    if (askLineRef.current === null) {
      askLineRef.current = series.createPriceLine({
        price: bestAsk, color: ASK_COLOR, lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: "Ask", axisLabelColor: ASK_COLOR, axisLabelTextColor: "#ffffff",
      });
    } else {
      askLineRef.current.applyOptions({ price: bestAsk });
    }
  };

  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (depthWallsRef.current?.series !== candle) {
      clearLines(depthWallsRef.current?.series);
      const primitive = new DepthWallsPrimitive();
      primitive.setStyle(tradingSettings.depthWallStyle);
      candle.attachPrimitive(primitive);
      depthWallsRef.current = { series: candle, primitive };
    }
    const { primitive } = depthWallsRef.current;
    if ((!showOrderBookWalls && !showBidAskLines) || depthSymbol === undefined) {
      primitive.setUpdate(undefined);
      clearLines(candle);
      return;
    }
    const subscription = subscribeDepthWalls(depthSymbol, wallOptionsRef.current, (update) => {
      primitive.setUpdate(showOrderBookWalls ? update : undefined);
      syncLines(candle, update);
    });
    wallsSubscriptionRef.current = subscription;
    return () => {
      subscription.unsubscribe();
      wallsSubscriptionRef.current = null;
      primitive.setUpdate(undefined);
      clearLines(candle);
    };
  }, [candlestickRef, depthSymbol, showOrderBookWalls, showBidAskLines, seriesType]);

  useEffect(() => {
    wallOptionsRef.current = wallOptions;
    wallsSubscriptionRef.current?.setOptions(wallOptions);
  }, [wallOptions]);

  useEffect(() => {
    depthWallsRef.current?.primitive.setStyle(tradingSettings.depthWallStyle);
  }, [tradingSettings.depthWallStyle]);
}
