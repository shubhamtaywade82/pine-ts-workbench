"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
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
import { ScriptDrawingsPrimitive, type ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { PriceScaleMenu } from "@/components/chart/price-scale-menu";
import { useOverlaySeries } from "@/hooks/use-overlay-series";
import { DEFAULT_CHART_SETTINGS, toCandleOptions, toChartOptions, type ChartSettings } from "@/lib/chart-settings";

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
  readonly data: readonly { time: number; value?: number }[];
  /** Horizontal level (e.g. RSI 70/30) — drawn thin and dashed, no price label. */
  readonly isLevel?: boolean;
  /** The indicator this plot belongs to (one legend row per owner); defaults to `instanceId`. */
  readonly ownerId?: string;
  /** Hidden via the legend: the series stays (so the legend keeps its row) but isn't drawn. */
  readonly isHidden?: boolean;
}

/** Legend row actions, as on TradingView: eye, gear, ×. */
export type IndicatorAction = "toggle-visibility" | "settings" | "remove";

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

const LOAD_OLDER_THRESHOLD_BARS = 30;

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
  /** Bars to plot as the main candlestick series (React snapshot, ~1/s). */
  readonly bars: readonly Bar[];
  /** Per-frame live bars from the stream, so ticks bypass React. */
  readonly subscribeBars?: (listener: (bars: readonly Bar[]) => void) => () => void;
  /** Overlays on the main price pane (e.g. SMA, EMA, BB bands). */
  readonly mainOverlays: readonly ChartOverlay[];
  /** Sub-panes for oscillators (RSI, MACD, OBV). */
  readonly subPanes: readonly ChartSubPane[];
  /** Trade markers (entry/exit arrows) from the strategy backtest. Wave 21. */
  readonly tradeMarkers?: readonly TradeMarker[];
  /** Editor-script drawings (SMC lines and boxes) on the price pane. */
  readonly drawings?: readonly ChartDrawing[];
  /** Appearance shared by all charts (Settings dialog / price-scale menu). */
  readonly settings?: ChartSettings;
  readonly onSettingsChange?: (settings: ChartSettings) => void;
  /** "More settings…" in the price-scale menu. */
  readonly onOpenSettings?: () => void;
  /** Legend heading, e.g. "BTC / USDT · 1m". */
  readonly title: string;
  /** Bar interval — drives the countdown to the candle close. */
  readonly interval: ChartInterval;
  /** Called when the user scrolls near the oldest loaded candle, to lazy-load older history. */
  readonly onNeedOlderBars?: () => void;
  /** Eye / gear / × clicked on an indicator's legend row (`ownerId` of its overlays). */
  readonly onIndicatorAction?: (ownerId: string, action: IndicatorAction) => void;
}

/**
 * LWC v5 chart with pan/zoom/crosshair baked in. Maintains a main
 * candlestick series + main-pane line series (one per overlay) + sub-pane
 * line series (one per overlay per sub-pane). The LWC v5 API uses
 * `chart.addSeries(LineSeries, options)` (function-style, not the old
 * `chart.addLineSeries`).
 */
export function ChartWorkbench({
  bars, subscribeBars, mainOverlays, subPanes, tradeMarkers, drawings, settings = DEFAULT_CHART_SETTINGS, onSettingsChange, onOpenSettings, title, interval, onNeedOlderBars, onIndicatorAction,
}: ChartWorkbenchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Custom">>>(new Map());
  const subPaneSeriesRef = useRef<Map<string, ISeriesApi<"Custom">>>(new Map());
  // LWC v5 markers plugin, bound to the candle series it was created on.
  const markersRef = useRef<{ series: ISeriesApi<"Candlestick">; plugin: ISeriesMarkersPluginApi<Time> } | null>(null);
  const drawingsRef = useRef<{ series: ISeriesApi<"Candlestick">; primitive: ScriptDrawingsPrimitive } | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [paneHeights, setPaneHeights] = useState<number[]>([]);
  // With the price scale on the left, the legend starts after it instead of under it.
  const [leftScaleWidth, setLeftScaleWidth] = useState(0);

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
      // A primitive left attached would request redraws of the removed chart ("Object is disposed").
      drawingsRef.current?.series.detachPrimitive(drawingsRef.current.primitive);
      drawingsRef.current = null;
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
  const candlestickRef = useCandleSeries(chartRef, bars, INTERVAL_MS[interval], onCandleFrame, subscribeBars);

  // Logical index 0 is the oldest loaded bar; asking a little before the user reaches it
  // means the older page usually arrives before blank space scrolls into view.
  const onNeedOlderRef = useRef(onNeedOlderBars);
  useEffect(() => { onNeedOlderRef.current = onNeedOlderBars; }, [onNeedOlderBars]);
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    const onRangeChange = (range: { from: number } | null) => {
      if (range !== null && range.from < LOAD_OLDER_THRESHOLD_BARS) onNeedOlderRef.current?.();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
  }, []);

  // Update trade markers (entry/exit arrows) on the candlestick series. Wave 21.
  // Uses LWC v5's createSeriesMarkers API (series.setMarkers was removed in v5).
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (markersRef.current?.series !== candle) {
      markersRef.current = { series: candle, plugin: createSeriesMarkers(candle, []) };
    }
    const markersPlugin = markersRef.current.plugin;
    const { showExecutionMarks, showExecutionLabels } = settings.trading;
    if (tradeMarkers === undefined || tradeMarkers.length === 0 || !showExecutionMarks) {
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
        text: !showExecutionLabels ? "" : m.type === "entry" ? (isLong ? "Long" : "Short") : "Close",
        size: 0.5,
      };
    });
    // LWC requires markers sorted by time ascending.
    markerData.sort((a, b) => (a.time as number) - (b.time as number));
    markersPlugin.setMarkers(markerData);
  }, [tradeMarkers, settings.trading]);

  useEffect(() => {
    const chart = chartRef.current;
    chart?.applyOptions(toChartOptions(settings));
    candlestickRef.current?.applyOptions(toCandleOptions(settings));
    // Scale widths settle on LWC's next paint.
    requestAnimationFrame(() => setLeftScaleWidth(settings.scales.placement === "left" ? (chart?.priceScale("left").width() ?? 0) : 0));
  }, [settings, candlestickRef, bars.length === 0]);

  // The primitive is bound to the candle series, which is recreated with the chart.
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (drawingsRef.current?.series !== candle) {
      const primitive = new ScriptDrawingsPrimitive();
      candle.attachPrimitive(primitive);
      drawingsRef.current = { series: candle, primitive };
    }
    drawingsRef.current.primitive.setDrawings(drawings ?? []);
  }, [drawings, candlestickRef]);

  useOverlaySeries(
    chartRef,
    { mainOverlays, subPanes, overlaySeriesRef, subPaneSeriesRef, placement: settings.scales.placement },
    setPaneHeights,
  );

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {onSettingsChange !== undefined && (
        <div className="absolute bottom-1 right-1 z-20">
          <PriceScaleMenu settings={settings} onChange={onSettingsChange} onMoreSettings={() => onOpenSettings?.()} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: leftScaleWidth }}>
      <ChartLegend
        statusLine={settings.statusLine}
        title={title} bars={bars} mainOverlays={mainOverlays} subPanes={subPanes}
        hoverTime={hoverTime} paneHeights={paneHeights} liveOhlcRef={liveOhlcRef}
        onIndicatorAction={onIndicatorAction}
      />
      </div>
    </div>
  );
}
