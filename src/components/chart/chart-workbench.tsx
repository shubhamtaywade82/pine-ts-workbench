"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@nemesis-oss/pine-ts";

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
}

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
}

/**
 * LWC v5 chart with pan/zoom/crosshair baked in. Maintains a main
 * candlestick series + main-pane line series (one per overlay) + sub-pane
 * line series (one per overlay per sub-pane). The LWC v5 API uses
 * `chart.addSeries(LineSeries, options)` (function-style, not the old
 * `chart.addLineSeries`).
 */
export function ChartWorkbench({ bars, mainOverlays, subPanes, tradeMarkers }: ChartWorkbenchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const subPaneSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // Lerp animation state for candle formation (Wave 23).
  const prevLastBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const animationRef = useRef<number | null>(null);
  // LWC v5 markers plugin (replaces series.setMarkers which was removed in v5).
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  // Initialize the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const chart = createChart(container, {
      layout: {
        background: { color: "#0e0e10" },
        textColor: "#d1d4dc",
        panes: {
          separatorColor: "#2b2b2b",
          separatorHoverColor: "#4a4a4a",
        },
      },
      grid: {
        vertLines: { color: "#1f1f22" },
        horzLines: { color: "#1f1f22" },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#888",
          width: 1,
          style: 3,
          labelBackgroundColor: "#444",
        },
        horzLine: {
          color: "#888",
          width: 1,
          style: 3,
          labelBackgroundColor: "#444",
        },
      },
      rightPriceScale: {
        borderColor: "#2b2b2b",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#2b2b2b",
        timeVisible: true,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;

    // ResizeObserver to keep the chart sized to its container.
    const resize = () => {
      if (containerRef.current === null) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candlestickRef.current = null;
      overlaySeriesRef.current.clear();
      subPaneSeriesRef.current.clear();
    };
  }, []);

  // Update the candlestick series when `bars` changes — with lerp animation
  // for the last (forming) candle. Wave 23.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    if (candlestickRef.current === null) {
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderUpColor: "#26a69a",
        borderDownColor: "#ef5350",
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });
      candlestickRef.current = candle;
      // Create the LWC v5 markers plugin attached to the candlestick series.
      markersRef.current = createSeriesMarkers(candle, []);
    }

    const candle = candlestickRef.current;
    const newLast = bars.length > 0 ? bars[bars.length - 1] : null;
    const prev = prevLastBarRef.current;

    // Cancel any ongoing animation.
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (newLast === null) {
      candle.setData([]);
      prevLastBarRef.current = null;
      return;
    }

    const newLastData = {
      time: Math.floor(newLast.time / 1000) as Time,
      open: newLast.open, high: newLast.high, low: newLast.low, close: newLast.close,
    };

    // Case 1: same candle (same time), different OHLC → lerp animation.
    if (
      prev !== null &&
      prev.time === newLast.time &&
      (prev.open !== newLast.open || prev.high !== newLast.high ||
        prev.low !== newLast.low || prev.close !== newLast.close)
    ) {
      const startTime = performance.now();
      const duration = 150; // ms — fast enough for real-time, slow enough to see
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      // easeOutCubic: snappy at start, smooth at end — feels like a forming candle.
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const e = ease(t);
        candle.update({
          time: newLastData.time,
          open: lerp(prev.open, newLast.open, e),
          high: lerp(prev.high, newLast.high, e),
          low: lerp(prev.low, newLast.low, e),
          close: lerp(prev.close, newLast.close, e),
        });
        if (t < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          animationRef.current = null;
          prevLastBarRef.current = { time: newLast.time, open: newLast.open, high: newLast.high, low: newLast.low, close: newLast.close };
        }
      };
      animationRef.current = requestAnimationFrame(animate);
      return;
    }

    // Case 2: new candle (time advanced) → series.update() (append, no animation).
    if (prev !== null && newLast.time > prev.time) {
      candle.update(newLastData);
      prevLastBarRef.current = { time: newLast.time, open: newLast.open, high: newLast.high, low: newLast.low, close: newLast.close };
      return;
    }

    // Case 3: full dataset change (initial load, symbol switch) → setData() + fitContent().
    candle.setData(bars.map((b) => ({
      time: Math.floor(b.time / 1000) as Time,
      open: b.open, high: b.high, low: b.low, close: b.close,
    })));
    chart.timeScale().fitContent();
    prevLastBarRef.current = { time: newLast.time, open: newLast.open, high: newLast.high, low: newLast.low, close: newLast.close };
  }, [bars]);

  // Cleanup animation on unmount.
  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  // Update trade markers (entry/exit arrows) on the candlestick series. Wave 21.
  // Uses LWC v5's createSeriesMarkers API (series.setMarkers was removed in v5).
  useEffect(() => {
    const markersPlugin = markersRef.current;
    if (markersPlugin === null) return;
    if (tradeMarkers === undefined || tradeMarkers.length === 0) {
      markersPlugin.setMarkers([]);
      return;
    }
    // LWC v5 markers: { time, position, color, shape, text }
    const markerData = tradeMarkers.map((m) => {
      const isEntry = m.type === "entry";
      const isLong = m.direction === "long";
      // Entry long: green arrowUp below bar. Entry short: red arrowUp below bar.
      // Exit long: red arrowDown above bar. Exit short: green arrowDown above bar.
      const isGreen = isEntry ? isLong : !isLong;
      return {
        time: Math.floor(m.time / 1000) as Time,
        position: isEntry ? "belowBar" as const : "aboveBar" as const,
        color: isGreen ? "#26a69a" : "#ef5350",
        shape: isEntry ? "arrowUp" as const : "arrowDown" as const,
        text: isEntry
          ? `${isLong ? "BUY" : "SELL"} @ ${m.price.toFixed(2)}`
          : `${isLong ? "EXIT" : "COVER"} @ ${m.price.toFixed(2)}${m.profit !== undefined ? ` (${m.profit >= 0 ? "+" : ""}${m.profit.toFixed(2)})` : ""}`,
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
        series = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        overlaySeriesRef.current.set(overlay.instanceId, series);
      } else {
        series.applyOptions({ color: overlay.color });
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
          series = chart.addSeries(LineSeries, {
            color: overlay.color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: overlay.indicatorName,
          }, paneIndex);
          subPaneSeriesRef.current.set(key, series);
        } else {
          series.applyOptions({ color: overlay.color });
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
  }, [subPanes]);

  return <div ref={containerRef} className="h-full w-full" />;
}
