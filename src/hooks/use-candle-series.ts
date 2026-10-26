"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@nemesis-oss/pine-ts";

// TradingView's candle and volume colours (volume at ~50% alpha).
const UP_COLOR = "#089981";
const DOWN_COLOR = "#f23645";
const VOLUME_UP_COLOR = "#08998180";
const VOLUME_DOWN_COLOR = "#f2364580";
const COUNTDOWN_REFRESH_MS = 1_000;

interface Ohlc { open: number; high: number; low: number; close: number }

/** The forming candle as currently drawn. */
export interface CandleFrame extends Ohlc { readonly time: number; readonly volume: number }

interface CandleSeries {
  readonly chart: IChartApi;
  readonly candle: ISeriesApi<"Candlestick">;
  readonly volume: ISeriesApi<"Histogram">;
}

const toCandle = (bar: Bar) => ({
  time: Math.floor(bar.time / 1000) as Time,
  open: bar.open, high: bar.high, low: bar.low, close: bar.close,
});

const toVolume = (bar: Bar) => ({
  time: Math.floor(bar.time / 1000) as Time,
  value: bar.volume,
  color: bar.close >= bar.open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
});

/** Adds the candle + volume series to `chart`, TradingView-styled. */
const createCandleSeries = (chart: IChartApi): CandleSeries => {
  const candle = chart.addSeries(CandlestickSeries, {
    upColor: UP_COLOR, downColor: DOWN_COLOR,
    borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
    wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
    priceLineStyle: 1, // Dotted, like TradingView's last-price line.
    priceLineWidth: 1,
  });
  const volume = chart.addSeries(HistogramSeries, {
    priceScaleId: "volume",
    priceFormat: { type: "volume" },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  // Volume sits in the bottom 20% of the price pane, as on TradingView.
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  return { chart, candle, volume };
};

/** "mm:ss" (or "h:mm:ss" past an hour) until `closeTime`; TradingView shows this under the last price. */
const formatCountdown = (msLeft: number): string => {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** TradingView opens a chart at roughly this many candles, with a small gap after the last one. */
const INITIAL_VISIBLE_BARS = 150;
const INITIAL_RIGHT_OFFSET_BARS = 10;

/**
 * Keeps a candlestick + volume series in sync with `bars`:
 * - the forming bar is updated by `subscribeBars` on every tick (once per
 *   animation frame, straight from the socket — no React render in the path);
 * - the `bars` snapshot from React only carries structural changes: initial
 *   load, a closed bar appended, older history prepended, reconnect, switch;
 * - every drawn frame is reported to `onFrame` (e.g. for the legend).
 * Returns the candle series (for markers), recreated whenever the chart is.
 */
export function useCandleSeries(
  chartRef: RefObject<IChartApi | null>,
  bars: readonly Bar[],
  barDurationMs: number,
  onFrame?: (frame: CandleFrame) => void,
  subscribeBars?: (listener: (bars: readonly Bar[]) => void) => () => void,
): RefObject<ISeriesApi<"Candlestick"> | null> {
  const seriesRef = useRef<CandleSeries | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const shownBarsRef = useRef<readonly Bar[]>([]);
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  const drawLast = (series: CandleSeries, bar: Bar) => {
    series.candle.update(toCandle(bar));
    series.volume.update(toVolume(bar));
    onFrameRef.current?.({ ...bar });
  };

  /**
   * Replaces all data. First load shows the newest bars at TradingView's default zoom; later replacements (older history
   * prepended on scroll-back, history refetched on reconnect) keep the view on the
   * same candles by shifting the visible range by however many bars were added before them.
   */
  const resetAll = (series: CandleSeries, nextBars: readonly Bar[], previous: readonly Bar[]) => {
    const timeScale = series.chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    series.candle.setData(nextBars.map(toCandle));
    series.volume.setData(nextBars.map(toVolume));
    shownBarsRef.current = nextBars;
    const previousFirst = previous[0];
    if (previousFirst === undefined || visible === null) {
      // Fitting every loaded bar squeezes 1000+ candles into a few pixels each.
      const lastIndex = nextBars.length - 1;
      timeScale.setVisibleLogicalRange({ from: lastIndex - INITIAL_VISIBLE_BARS, to: lastIndex + INITIAL_RIGHT_OFFSET_BARS });
      return;
    }
    const shift = nextBars.findIndex((b) => b.time === previousFirst.time);
    if (shift > 0) timeScale.setVisibleLogicalRange({ from: visible.from + shift, to: visible.to + shift });
  };

  /** Applies the newest bars to the series: a tick, one appended bar, or a full reset. */
  const reconcile = (series: CandleSeries, nextBars: readonly Bar[]) => {
    const nextLast = nextBars[nextBars.length - 1];
    if (nextLast === undefined) return;
    const shown = shownBarsRef.current;
    const shownLast = shown[shown.length - 1];

    const isTick = shownLast !== undefined && nextLast.time === shownLast.time && nextBars.length === shown.length;
    const isAppend = shownLast !== undefined && nextLast.time > shownLast.time && nextBars.length === shown.length + 1;
    if (!isTick && !isAppend) {
      resetAll(series, nextBars, shown);
      return;
    }
    if (isAppend) {
      // Settle the bar that just closed before appending its successor.
      drawLast(series, nextBars[nextBars.length - 2]!);
    }
    shownBarsRef.current = nextBars;
    drawLast(series, nextLast);
  };

  // The subscription always carries the freshest values; keep the callback
  // stable so the socket listener is registered once per stream.
  const reconcileRef = useRef(reconcile);
  useEffect(() => { reconcileRef.current = reconcile; });

  useEffect(() => {
    if (subscribeBars === undefined) return;
    return subscribeBars((nextBars) => {
      const series = seriesRef.current;
      if (series !== null) reconcileRef.current(series, nextBars);
    });
  }, [subscribeBars]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    if (seriesRef.current?.chart !== chart) {
      seriesRef.current = createCandleSeries(chart);
      candleRef.current = seriesRef.current.candle;
      shownBarsRef.current = [];
    }
    const series = seriesRef.current;
    const shown = shownBarsRef.current;
    const last = bars[bars.length - 1];
    const shownLast = shown[shown.length - 1];
    // Ticks are drawn by the subscription; React snapshots only add/remove bars.
    if (last !== undefined && shownLast !== undefined && bars.length === shown.length && last.time === shownLast.time) {
      return;
    }
    reconcile(series, bars);
  }, [bars]);

  useEffect(() => {
    const tick = () => {
      const last = shownBarsRef.current[shownBarsRef.current.length - 1];
      if (last === undefined) return;
      seriesRef.current?.candle.applyOptions({ title: formatCountdown(last.time + barDurationMs - Date.now()) });
    };
    tick();
    const timer = setInterval(tick, COUNTDOWN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [barDurationMs]);

  return candleRef;
}
