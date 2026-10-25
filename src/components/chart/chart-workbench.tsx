"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@nemesis-oss/pine-ts";
import { ChartLegend, writeLiveOhlc } from "@/components/chart/chart-legend";
import { useCandleSeries, type CandleFrame } from "@/hooks/use-candle-series";
import { INTERVAL_MS, type ChartInterval } from "@/lib/public-binance-feed";

/**
 * A single indicator overlay applied to the chart.
 * `instanceId` distinguishes multiple instances of the same indicator
 * (e.g. two SMAs with different lengths).
 */
export interface ChartOverlay {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly indicatorName: string;
  readonly color: string;
  readonly data: readonly { time: number; value: number }[];
  /** Horizontal level (e.g. RSI 70/30) — drawn thin and dashed, no price label. */
  readonly isLevel?: boolean;
}

// TradingView's dark-theme palette, so the chart reads like the real thing.
const TV = {
  background: "#131722",
  grid: "#1e222d",
  text: "#b2b5be",
  border: "#2a2e39",
  down: "#f23645",
  crosshair: "#9598a1",
  crosshairLabel: "#363a45",
  longEntry: "#2962ff",
  exit: "#e040fb",
};

const lineOptions = (overlay: ChartOverlay) => ({
  color: overlay.color,
  lineWidth: 1 as const,
  lineStyle: overlay.isLevel ? 2 : 0, // 2 = Dashed
  priceLineVisible: false,
  crosshairMarkerVisible: !overlay.isLevel,
});

/**
 * A pane (sub-chart) below the main price pane. Used for oscillators like
 * RSI / MACD / OBV. Each pane has its own y-axis.
 */
export interface ChartSubPane {
  readonly paneId: string;
  readonly title: string;
  readonly overlays: readonly ChartOverlay[];
}

/** A trade marker — entry or exit point visualized on the chart. */
export interface TradeMarker {
  /** Bar time in milliseconds. */
  readonly time: number;
  /** "entry" or "exit". */
  readonly type: "entry" | "exit";
  /** "long" or "short". */
  readonly direction: "long" | "short";
  /** Price at the trade. */
  readonly price: number;
  /** P&L for this trade (undefined for entries). */
  readonly profit?: number;
}

export interface ChartWorkbenchProps {
  /** Bars to plot as the main candlestick series. */
  readonly bars: readonly Bar[];
  /** Overlays on the main price pane (e.g. SMA, EMA, BB bands). */
  readonly mainOverlays: readonly ChartOverlay[];
  /** Sub-panes for oscillators (RSI, MACD, OBV). */
  readonly subPanes: readonly ChartSubPane[];
  /** Trade markers (entry/exit arrows) from the strategy backtest. Wave 21. */
  readonly tradeMarkers?: readonly TradeMarker[];
  /** Legend heading, e.g. "BTC / USDT · 1m". */
  readonly title: string;
  /** Bar interval — drives the countdown to the candle close. */
  readonly interval: ChartInterval;
}

/**
 * LWC v5 chart with pan/zoom/crosshair baked in. Maintains a main
 * candlestick series + main-pane line series (one per overlay) + sub-pane
 * line series (one per overlay per sub-pane). The LWC v5 API uses
 * `chart.addSeries(LineSeries, options)` (function-style, not the old
 * `chart.addLineSeries`).
 */
export function ChartWorkbench({ bars, mainOverlays, subPanes, tradeMarkers, title, interval }: ChartWorkbenchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const subPaneSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // LWC v5 markers plugin, bound to the candle series it was created on.
  const markersRef = useRef<{ series: ISeriesApi<"Candlestick">; plugin: ISeriesMarkersPluginApi<Time> } | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [paneHeights, setPaneHeights] = useState<number[]>([]);

  // Initialize the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const chart = createChart(container, {
      layout: {
        background: { color: TV.background },
        textColor: TV.text,
        fontSize: 11,
        panes: {
          separatorColor: TV.border,
          separatorHoverColor: TV.crosshairLabel,
        },
      },
      grid: {
        vertLines: { color: TV.grid },
        horzLines: { color: TV.grid },
      },
      crosshair: {
        mode: 0, // Normal: free-moving like TradingView, not magnet-snapped.
        vertLine: { color: TV.crosshair, width: 1, style: 3, labelBackgroundColor: TV.crosshairLabel },
        horzLine: { color: TV.crosshair, width: 1, style: 3, labelBackgroundColor: TV.crosshairLabel },
      },
      rightPriceScale: {
        borderColor: TV.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: TV.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;
    chart.subscribeCrosshairMove((param) => {
      setHoverTime(param.time === undefined ? null : (param.time as number) * 1000);
    });

    // ResizeObserver to keep the chart sized to its container.
    const resize = () => {
      if (containerRef.current === null) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      setPaneHeights(chart.panes().map((pane) => pane.getHeight()));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      markersRef.current = null;
      overlaySeriesRef.current.clear();
      subPaneSeriesRef.current.clear();
    };
  }, []);

  const liveOhlcRef = useRef<HTMLSpanElement>(null);
  const onCandleFrame = useCallback((frame: CandleFrame) => {
    if (liveOhlcRef.current !== null) writeLiveOhlc(liveOhlcRef.current, frame);
  }, []);
  const candlestickRef = useCandleSeries(chartRef, bars, INTERVAL_MS[interval], onCandleFrame);

  // Update trade markers (entry/exit arrows) on the candlestick series. Wave 21.
  // Uses LWC v5's createSeriesMarkers API (series.setMarkers was removed in v5).
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (markersRef.current?.series !== candle) {
      markersRef.current = { series: candle, plugin: createSeriesMarkers(candle, []) };
    }
    const markersPlugin = markersRef.current.plugin;
    if (tradeMarkers === undefined || tradeMarkers.length === 0) {
      markersPlugin.setMarkers([]);
      return;
    }
    // TradingView-style: short labels, prices live in the trade list, not on the chart.
    const markerData = tradeMarkers.map((m) => {
      const isLong = m.direction === "long";
      const isBuy = m.type === "entry" ? isLong : !isLong;
      return {
        time: Math.floor(m.time / 1000) as Time,
        position: isBuy ? "belowBar" as const : "aboveBar" as const,
        color: m.type === "entry" ? (isLong ? TV.longEntry : TV.down) : TV.exit,
        shape: isBuy ? "arrowUp" as const : "arrowDown" as const,
        text: m.type === "entry" ? (isLong ? "Long" : "Short") : "Close",
        size: 0.5,
      };
    });
    // LWC requires markers sorted by time ascending.
    markerData.sort((a, b) => (a.time as number) - (b.time as number));
    markersPlugin.setMarkers(markerData);
  }, [tradeMarkers]);

  // Update the main-pane overlays.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    const known = new Set<string>();
    for (const overlay of mainOverlays) {
      known.add(overlay.instanceId);
      let series = overlaySeriesRef.current.get(overlay.instanceId);
      if (series === undefined) {
        series = chart.addSeries(LineSeries, { ...lineOptions(overlay), lastValueVisible: false });
        overlaySeriesRef.current.set(overlay.instanceId, series);
      } else {
        series.applyOptions(lineOptions(overlay));
      }
      series.setData(
        overlay.data.map((d) => ({
          time: Math.floor(d.time / 1000) as Time,
          value: d.value,
        })),
      );
    }
    // Remove series that are no longer present.
    for (const [id, series] of overlaySeriesRef.current.entries()) {
      if (!known.has(id)) {
        chart.removeSeries(series);
        overlaySeriesRef.current.delete(id);
      }
    }
  }, [mainOverlays]);

  // Update the sub-pane overlays.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    const known = new Set<string>();
    for (const pane of subPanes) {
      const paneIndex = subPanes.findIndex((p) => p.paneId === pane.paneId) + 1;
      for (const overlay of pane.overlays) {
        const key = `${pane.paneId}:${overlay.instanceId}`;
        known.add(key);
        let series = subPaneSeriesRef.current.get(key);
        if (series === undefined) {
          series = chart.addSeries(LineSeries, { ...lineOptions(overlay), lastValueVisible: !overlay.isLevel }, paneIndex);
          subPaneSeriesRef.current.set(key, series);
        } else {
          series.applyOptions(lineOptions(overlay));
        }
        series.setData(
          overlay.data.map((d) => ({
            time: Math.floor(d.time / 1000) as Time,
            value: d.value,
          })),
        );
      }
    }
    for (const [key, series] of subPaneSeriesRef.current.entries()) {
      if (!known.has(key)) {
        chart.removeSeries(series);
        subPaneSeriesRef.current.delete(key);
      }
    }
    // TradingView gives price ~75% of the height; LWC defaults to equal panes.
    chart.panes().forEach((pane, i) => pane.setStretchFactor(i === 0 ? 3 : 1));
    // Pane heights settle on LWC's next paint, not synchronously.
    requestAnimationFrame(() => setPaneHeights(chart.panes().map((pane) => pane.getHeight())));
  }, [subPanes]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <ChartLegend
        title={title} bars={bars} mainOverlays={mainOverlays} subPanes={subPanes}
        hoverTime={hoverTime} paneHeights={paneHeights} liveOhlcRef={liveOhlcRef}
      />
    </div>
  );
}
