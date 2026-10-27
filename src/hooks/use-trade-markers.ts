import { useEffect, useRef, type RefObject } from "react";
import {
  createSeriesMarkers,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { TradeMarker } from "@/components/chart/chart-workbench";
import type { ChartSettings } from "@/lib/chart-settings";

const TV = {
  down: "#f23645",
  longEntry: "#2962ff",
  exit: "#e040fb",
};

/**
 * Attaches entry/exit arrow markers to the primary series using LWC v5 plugin API.
 */
export function useTradeMarkers(
  candlestickRef: RefObject<ISeriesApi<SeriesType> | null>,
  tradeMarkers: readonly TradeMarker[] | undefined,
  tradingSettings: ChartSettings["trading"],
  seriesType?: string,
): void {
  const markersRef = useRef<{
    series: ISeriesApi<SeriesType>;
    plugin: ISeriesMarkersPluginApi<Time>;
  } | null>(null);

  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (markersRef.current?.series !== candle) {
      markersRef.current = { series: candle, plugin: createSeriesMarkers(candle, []) };
    }
    const markersPlugin = markersRef.current.plugin;
    const { showExecutionMarks, showExecutionLabels } = tradingSettings;
    if (tradeMarkers === undefined || tradeMarkers.length === 0 || !showExecutionMarks) {
      markersPlugin.setMarkers([]);
      return;
    }

    const markerData = tradeMarkers.map((m) => {
      const isLong = m.direction === "long";
      const isBuy = m.type === "entry" ? isLong : !isLong;
      return {
        time: Math.floor(m.time / 1000) as Time,
        position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.type === "entry" ? (isLong ? TV.longEntry : TV.down) : TV.exit,
        shape: isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
        text: !showExecutionLabels ? "" : m.type === "entry" ? (isLong ? "Long" : "Short") : "Close",
        size: 0.5,
      };
    });

    markerData.sort((a, b) => (a.time as number) - (b.time as number));
    markersPlugin.setMarkers(markerData);
  }, [candlestickRef, tradeMarkers, tradingSettings, seriesType]);
}
