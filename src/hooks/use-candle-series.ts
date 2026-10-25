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
// Time constant of the price smoothing: ~63% of a move shows after this long, ~95%
// after 3x. Short enough to feel real-time, long enough to read as motion.
const SMOOTHING_TAU_MS = 120;
// Below this share of the price the remaining gap is invisible, so the loop stops.
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

const toCandle = (bar: Bar) => ({
  time: Math.floor(bar.time / 1000) as Time,
  open: bar.open, high: bar.high, low: bar.low, close: bar.close,
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

/**
 * Keeps a candlestick + volume series in sync with `bars`:
 * - last bar changed in place (stream tick) → the drawn candle eases toward the
 *   new OHLC; one rAF loop chases the latest target, so new ticks retarget it
 *   instead of restarting an animation (which would look like a jump);
 * - one bar appended → settle the previous candle, then append;
 * - anything else (initial load, older history prepended, reconnect) → full reset
 *   that keeps the view on the same candles.
 * Also shows the time left on the forming candle in the last-price label, and
 * reports every drawn frame to `onFrame` (e.g. for the legend).
 * Returns the candle series (for markers), recreated whenever the chart is.
 */
export function useCandleSeries(
  chartRef: RefObject<IChartApi | null>,
  bars: readonly Bar[],
  barDurationMs: number,
  onFrame?: (frame: CandleFrame) => void,
): RefObject<ISeriesApi<"Candlestick"> | null> {
  const seriesRef = useRef<CandleSeries | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const shownBarsRef = useRef<readonly Bar[]>([]);
  const displayedRef = useRef<Ohlc | null>(null);
  const targetRef = useRef<Bar | null>(null);
  const animationRef = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  const draw = (series: CandleSeries, target: Bar, frame: Ohlc) => {
    // Picked field by field: `frame` may be a Bar, whose ms `time` must not reach LWC.
    const ohlc = { open: frame.open, high: frame.high, low: frame.low, close: frame.close };
    series.candle.update({ time: toCandle(target).time, ...ohlc });
    displayedRef.current = ohlc;
    onFrameRef.current?.({ ...ohlc, time: target.time, volume: target.volume });
  };

  const stopAnimation = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  };

  /** Starts the smoothing loop if idle; a running loop just picks up the new targetRef. */
  const chaseTarget = (series: CandleSeries) => {
    if (animationRef.current !== null) return;
    let lastFrameAt = performance.now();
    const step = (now: number) => {
      const target = targetRef.current;
      const from = displayedRef.current;
      if (target === null || from === null) { animationRef.current = null; return; }
      // Frame-rate independent: the same share of the gap closes per ms at 30 or 144 fps.
      const k = 1 - Math.exp(-(now - lastFrameAt) / SMOOTHING_TAU_MS);
      lastFrameAt = now;
      const frame = {
        open: target.open,
        high: lerp(from.high, target.high, k),
        low: lerp(from.low, target.low, k),
        close: lerp(from.close, target.close, k),
      };
      const isSettled = Math.abs(frame.close - target.close) <= Math.abs(target.close) * SETTLE_EPSILON &&
        Math.abs(frame.high - target.high) <= Math.abs(target.high) * SETTLE_EPSILON &&
        Math.abs(frame.low - target.low) <= Math.abs(target.low) * SETTLE_EPSILON;
      draw(series, target, isSettled ? target : frame);
      animationRef.current = isSettled ? null : requestAnimationFrame(step);
    };
    animationRef.current = requestAnimationFrame(step);
  };

  /**
   * Replaces all data. First load fits the chart; later replacements (older history
   * prepended on scroll-back, history refetched on reconnect) keep the view on the
   * same candles by shifting the visible range by however many bars were added before them.
   */
  const resetAll = (series: CandleSeries, previous: readonly Bar[]) => {
    const timeScale = series.chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    series.candle.setData(bars.map(toCandle));
    series.volume.setData(bars.map(toVolume));
    const previousFirst = previous[0];
    if (previousFirst === undefined || visible === null) {
      timeScale.fitContent();
      return;
    }
    const shift = bars.findIndex((b) => b.time === previousFirst.time);
    if (shift > 0) timeScale.setVisibleLogicalRange({ from: visible.from + shift, to: visible.to + shift });
  };

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
    shownBarsRef.current = bars;
    targetRef.current = last ?? null;

    const isTick = last !== undefined && shownLast !== undefined &&
      bars.length === shown.length && last.time === shownLast.time;
    if (isTick) {
      series.volume.update(toVolume(last));
      if (!isSameOhlc(last, displayedRef.current ?? shownLast)) chaseTarget(series);
      return;
    }
    stopAnimation();
    const isAppend = last !== undefined && shownLast !== undefined &&
      bars.length === shown.length + 1 && bars[bars.length - 2]?.time === shownLast.time;
    if (isAppend) {
      // Settle the candle that just closed — it may have been mid-smoothing.
      series.candle.update(toCandle(bars[bars.length - 2]!));
      series.volume.update(toVolume(last));
      draw(series, last, last);
    } else {
      resetAll(series, shown);
      displayedRef.current = last ?? null;
      if (last !== undefined) onFrameRef.current?.({ ...last });
    }
  }, [bars]);

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
