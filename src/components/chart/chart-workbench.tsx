"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import type { Bar } from "@nemesis-oss/pine-ts";
import { ChartLegend, writeLiveOhlc } from "@/components/chart/chart-legend";
import { useCandleSeries, type CandleFrame } from "@/hooks/use-candle-series";
import { INTERVAL_MS, type BinanceSymbol, type ChartInterval } from "@/lib/public-binance-feed";
import { LastPricePrimitive } from "@/components/chart/last-price-primitive";
import { ScriptDrawingsPrimitive, type ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { PriceScaleMenu } from "@/components/chart/price-scale-menu";
import { useOverlaySeries } from "@/hooks/use-overlay-series";
import { useTradeMarkers } from "@/hooks/use-trade-markers";
import { useDepthWalls } from "@/hooks/use-depth-walls";
import { useChartDrawings } from "@/hooks/use-chart-drawings";
import { DrawingToolbar } from "@/components/chart/drawing-toolbar";
import { DEFAULT_CHART_SETTINGS, toCandleOptions, toChartOptions, type ChartSettings } from "@/lib/chart-settings";

export interface ChartOverlay {
  readonly instanceId: string;
  readonly indicatorId: string;
  readonly indicatorName: string;
  readonly color: string;
  readonly data: readonly { time: number; value?: number }[];
  readonly isLevel?: boolean;
  readonly ownerId?: string;
  readonly isHidden?: boolean;
}

export type IndicatorAction = "toggle-visibility" | "settings" | "remove";

const TV = {
  background: "#131722",
  grid: "#1e222d",
  text: "#b2b5be",
  border: "#2a2e39",
  crosshair: "#9598a1",
  crosshairLabel: "#363a45",
};

const LOAD_OLDER_THRESHOLD_BARS = 30;
const AVERAGE_VOLUME_BARS = 20;

export interface ChartSubPane {
  readonly paneId: string;
  readonly title: string;
  readonly overlays: readonly ChartOverlay[];
}

export interface TradeMarker {
  readonly time: number;
  readonly type: "entry" | "exit";
  readonly direction: "long" | "short";
  readonly price: number;
  readonly profit?: number;
}

export interface ChartWorkbenchProps {
  readonly bars: readonly Bar[];
  readonly subscribeBars?: (listener: (bars: readonly Bar[]) => void) => () => void;
  readonly mainOverlays: readonly ChartOverlay[];
  readonly subPanes: readonly ChartSubPane[];
  readonly tradeMarkers?: readonly TradeMarker[];
  readonly drawings?: readonly ChartDrawing[];
  readonly settings?: ChartSettings;
  readonly onSettingsChange?: (settings: ChartSettings) => void;
  readonly onOpenSettings?: () => void;
  readonly title: string;
  readonly interval: ChartInterval;
  readonly onNeedOlderBars?: () => void;
  readonly onIndicatorAction?: (ownerId: string, action: IndicatorAction) => void;
  readonly depthSymbol?: BinanceSymbol;
}

export function ChartWorkbench({
  bars, subscribeBars, mainOverlays, subPanes, tradeMarkers, drawings,
  settings = DEFAULT_CHART_SETTINGS, onSettingsChange, onOpenSettings,
  title, interval, onNeedOlderBars, onIndicatorAction, depthSymbol,
}: ChartWorkbenchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Custom">>>(new Map());
  const subPaneSeriesRef = useRef<Map<string, ISeriesApi<"Custom">>>(new Map());
  const drawingsRef = useRef<{ series: ISeriesApi<"Candlestick">; primitive: ScriptDrawingsPrimitive } | null>(null);
  const lastPriceRef = useRef<{ series: ISeriesApi<"Candlestick">; primitive: LastPricePrimitive } | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [paneHeights, setPaneHeights] = useState<number[]>([]);
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
        panes: { separatorColor: TV.border, separatorHoverColor: TV.crosshairLabel },
      },
      grid: { vertLines: { color: TV.grid }, horzLines: { color: TV.grid } },
      crosshair: {
        mode: 0,
        vertLine: { color: TV.crosshair, width: 1, style: 3, labelBackgroundColor: TV.crosshairLabel },
        horzLine: { color: TV.crosshair, width: 1, style: 3, labelBackgroundColor: TV.crosshairLabel },
      },
      rightPriceScale: { borderColor: TV.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: TV.border, timeVisible: true, secondsVisible: false, rightOffset: 10 },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;
    chart.subscribeCrosshairMove((param) => {
      setHoverTime(param.time === undefined ? null : (param.time as number) * 1000);
    });

    const resize = () => {
      if (containerRef.current === null) return;
      chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      setPaneHeights(chart.panes().map((pane) => pane.getHeight()));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      drawingsRef.current?.series.detachPrimitive(drawingsRef.current.primitive);
      drawingsRef.current = null;
      chart.remove();
      chartRef.current = null;
      overlaySeriesRef.current.clear();
      subPaneSeriesRef.current.clear();
    };
  }, []);

  const liveOhlcRef = useRef<HTMLSpanElement>(null);
  const onCandleFrame = useCallback((frame: CandleFrame) => {
    if (liveOhlcRef.current !== null) writeLiveOhlc(liveOhlcRef.current, frame);
    lastPriceRef.current?.primitive.setFrame(frame);
  }, []);
  const candlestickRef = useCandleSeries(chartRef, bars, INTERVAL_MS[interval], onCandleFrame, subscribeBars);

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

  // Trade execution markers.
  useTradeMarkers(candlestickRef, tradeMarkers, settings.trading);

  // Visual options and last price style.
  useEffect(() => {
    const chart = chartRef.current;
    chart?.applyOptions(toChartOptions(settings));
    const candle = candlestickRef.current;
    candle?.applyOptions(toCandleOptions(settings));
    if (candle !== null && lastPriceRef.current?.series !== candle) {
      const primitive = new LastPricePrimitive();
      candle.attachPrimitive(primitive);
      lastPriceRef.current = { series: candle, primitive };
    }
    lastPriceRef.current?.primitive.setStyle({
      isVisible: settings.scales.showLastPriceLine, upColor: settings.candles.upColor, downColor: settings.candles.downColor,
    });
    requestAnimationFrame(() => setLeftScaleWidth(settings.scales.placement === "left" ? (chart?.priceScale("left").width() ?? 0) : 0));
  }, [settings, candlestickRef, bars.length === 0]);

  useEffect(() => {
    const closed = bars.slice(-AVERAGE_VOLUME_BARS - 1, -1);
    const total = closed.reduce((sum, bar) => sum + bar.volume, 0);
    lastPriceRef.current?.primitive.setAverageVolume(closed.length > 0 ? total / closed.length : 0);
  }, [bars]);

  // Script drawings (SMC boxes, lines, labels).
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

  // Live order book walls.
  useDepthWalls(candlestickRef, depthSymbol, settings.trading);

  // User interactive drawing tools (trendline, ray, fibonacci, rectangle, measure).
  const { activeTool, setActiveTool, drawings: userDrawings, clearDrawings, isDrawing } = useChartDrawings(
    chartRef, candlestickRef, bars, INTERVAL_MS[interval],
  );

  useOverlaySeries(
    chartRef,
    { mainOverlays, subPanes, overlaySeriesRef, subPaneSeriesRef, placement: settings.scales.placement },
    setPaneHeights,
  );

  return (
    <div className={`relative h-full w-full ${activeTool !== "cursor" ? "cursor-crosshair" : ""}`}>
      <div ref={containerRef} className="h-full w-full" />
      <DrawingToolbar
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        onClearDrawings={clearDrawings}
        drawingCount={userDrawings.length}
      />
      {isDrawing && (
        <div className="pointer-events-none absolute left-12 top-12 z-20 rounded bg-[#1e222d]/90 px-2 py-1 text-[11px] text-[#2962ff] shadow border border-[#2a2e39]">
          Click to finish drawing (Esc to cancel)
        </div>
      )}
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
