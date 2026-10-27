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
// Time constant for price smoothing: ~63% of move closes in 120ms, ~95% in 360ms.
export const SMOOTHING_TAU_MS = 120;
// Below this relative price delta, the remaining distance is invisible and animation settles.
const SETTLE_EPSILON = 1e-7;
const COUNTDOWN_REFRESH_MS = 1_000;

interface Ohlc { open: number; high: number; low: number; close: number }

/** The forming candle as currently drawn (mid-smoothing it trails the real bar). */
export interface CandleFrame extends Ohlc { readonly time: number; readonly volume: number }

interface CandleSeries {
  readonly chart: IChartApi;
  readonly candle: ISeriesApi<"Candlestick">;
  readonly volume: ISeriesApi<"Histogram">;
}

const toCandle = (bar: Bar, color?: string) => ({
  time: Math.floor(bar.time / 1000) as Time,
  open: bar.open, high: bar.high, low: bar.low, close: bar.close,
  ...(color !== undefined ? { color, borderColor: color, wickColor: color } : {}),
});

const toVolume = (bar: Bar) => ({
  time: Math.floor(bar.time / 1000) as Time,
  value: bar.volume,
  color: bar.close >= bar.open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
});

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const isSameOhlc = (a: Ohlc, b: Ohlc): boolean =>
  a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

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
 * - last bar changed in place (stream tick) → the drawn candle eases toward the
 *   new OHLC via continuous exponential smoothing (lerp);
 * - one bar appended → settle the previous candle, then append;
 * - anything else (initial load, older history prepended, reconnect) → full reset.
 * Also shows the countdown to candle close and reports every drawn frame to `onFrame`.
 * Returns the candle series ref, recreated whenever the chart is.
 */
export function useCandleSeries(
  chartRef: RefObject<IChartApi | null>,
  bars: readonly Bar[],
  barDurationMs: number,
  onFrame?: (frame: CandleFrame) => void,
  subscribeBars?: (listener: (bars: readonly Bar[]) => void) => () => void,
  barColors?: ReadonlyMap<number, string>,
): RefObject<ISeriesApi<"Candlestick"> | null> {
  const seriesRef = useRef<CandleSeries | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const shownBarsRef = useRef<readonly Bar[]>([]);
  const displayedRef = useRef<Ohlc | null>(null);
  const targetRef = useRef<Bar | null>(null);
  const animationRef = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  const barColorsRef = useRef(barColors);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { barColorsRef.current = barColors; }, [barColors]);

  const draw = (series: CandleSeries, target: Bar, frame: Ohlc) => {
    const ohlc = { open: frame.open, high: frame.high, low: frame.low, close: frame.close };
    const color = barColorsRef.current?.get(Math.floor(target.time / 1000));
    series.candle.update({
      time: toCandle(target).time,
      ...ohlc,
      ...(color !== undefined ? { color, borderColor: color, wickColor: color } : {}),
    });
    displayedRef.current = ohlc;
    onFrameRef.current?.({ ...ohlc, time: target.time, volume: target.volume });
  };

  const stopAnimation = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  };

  /** Smooths the displayed candle toward targetRef on each animation frame. */
  const chaseTarget = (series: CandleSeries) => {
    if (animationRef.current !== null) return;
    let lastFrameAt = performance.now();
    const step = (now: number) => {
      const target = targetRef.current;
      const from = displayedRef.current;
      if (target === null || from === null) { animationRef.current = null; return; }
      // Frame-rate independent: closing ratio per millisecond stays consistent across refresh rates.
      const k = 1 - Math.exp(-(now - lastFrameAt) / SMOOTHING_TAU_MS);
      lastFrameAt = now;
      const nextClose = lerp(from.close, target.close, k);
      const nextHigh = Math.max(target.open, nextClose, lerp(from.high, target.high, k));
      const nextLow = Math.min(target.open, nextClose, lerp(from.low, target.low, k));
      const frame = { open: target.open, high: nextHigh, low: nextLow, close: nextClose };
      const isSettled = Math.abs(frame.close - target.close) <= Math.abs(target.close) * SETTLE_EPSILON &&
        Math.abs(frame.high - target.high) <= Math.abs(target.high) * SETTLE_EPSILON &&
        Math.abs(frame.low - target.low) <= Math.abs(target.low) * SETTLE_EPSILON;
      draw(series, target, isSettled ? target : frame);
      animationRef.current = isSettled ? null : requestAnimationFrame(step);
    };
    animationRef.current = requestAnimationFrame(step);
  };

  /**
   * Replaces all data. First load shows the newest bars at TradingView's default zoom; later replacements (older history
   * prepended on scroll-back, history refetched on reconnect) keep the view on the
   * same candles by shifting the visible range by however many bars were added before them.
   */
  const resetAll = (series: CandleSeries, nextBars: readonly Bar[], previous: readonly Bar[]) => {
    const timeScale = series.chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    const colors = barColorsRef.current;
    series.candle.setData(nextBars.map((b) => toCandle(b, colors?.get(Math.floor(b.time / 1000)))));
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
      stopAnimation();
      resetAll(series, nextBars, shown);
      targetRef.current = nextLast;
      displayedRef.current = nextLast;
      onFrameRef.current?.({ ...nextLast });
      return;
    }
    if (isAppend) {
      stopAnimation();
      // Settle the closed candle and its volume at their final values before the new one opens.
      const closed = nextBars[nextBars.length - 2]!;
      const closedColor = barColorsRef.current?.get(Math.floor(closed.time / 1000));
      series.candle.update(toCandle(closed, closedColor));
      series.volume.update(toVolume(closed));
      series.volume.update(toVolume(nextLast));
      shownBarsRef.current = nextBars;
      targetRef.current = nextLast;
      draw(series, nextLast, nextLast);
      return;
    }
    shownBarsRef.current = nextBars;
    targetRef.current = nextLast;
    series.volume.update(toVolume(nextLast));
    if (displayedRef.current === null) {
      draw(series, nextLast, nextLast);
    } else if (!isSameOhlc(nextLast, displayedRef.current)) {
      chaseTarget(series);
    }
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
      stopAnimation();
      seriesRef.current = createCandleSeries(chart);
      candleRef.current = seriesRef.current.candle;
      shownBarsRef.current = [];
      displayedRef.current = null;
      targetRef.current = null;
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
    const series = seriesRef.current;
    if (series === null || shownBarsRef.current.length === 0) return;
    const colors = barColorsRef.current;
    series.candle.setData(
      shownBarsRef.current.map((b) => toCandle(b, colors?.get(Math.floor(b.time / 1000)))),
    );
  }, [barColors]);

  useEffect(() => stopAnimation, []);

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
