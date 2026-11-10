import type { RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import type { BinanceSymbol, ChartInterval, LiveTrade } from "@/lib/public-binance-feed";
import type { ChartSettings } from "@/lib/chart-settings";
import { useDepthWalls } from "@/hooks/use-depth-walls";
import { useDomLadder } from "@/hooks/use-dom-ladder";
import { useFootprint } from "@/hooks/use-footprint";
import { useLiquidityHeatmap } from "@/hooks/use-liquidity-heatmap";

export interface OrderFlowLayersOptions {
  readonly seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  readonly depthSymbol: BinanceSymbol | undefined;
  readonly trading: ChartSettings["trading"];
  readonly seriesType: string;
  readonly interval: ChartInterval;
  readonly subscribeTrades?: (listener: (trade: LiveTrade) => void) => () => void;
}

/** Attaches the live order-book and footprint layers to one candle series. */
export function useOrderFlowLayers(options: OrderFlowLayersOptions): void {
  const { seriesRef, depthSymbol, trading, seriesType, interval, subscribeTrades } = options;
  useDepthWalls(seriesRef, depthSymbol, trading, seriesType);
  useDomLadder(seriesRef, depthSymbol, trading, { seriesType, subscribeTrades });
  useLiquidityHeatmap(seriesRef, depthSymbol, trading, seriesType);
  useFootprint({ seriesRef, symbol: depthSymbol, interval, trading, subscribeTrades, seriesType });
}
