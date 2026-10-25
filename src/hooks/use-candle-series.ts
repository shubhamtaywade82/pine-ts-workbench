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
// Fast enough for real-time ticks, slow enough to read as a forming candle.
const LERP_DURATION_MS = 150;
const COUNTDOWN_REFRESH_MS = 1_000;

interface Ohlc { open: number; high: number; low: number; close: number }

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
// easeOutCubic: snappy at start, smooth at end.
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

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
 * - last bar changed in place (stream tick) → lerp from what is on screen to the new OHLC;
 * - one bar appended → settle the previous candle, then append;
 * - anything else (initial load, symbol switch) → full reset.
 * Also shows the time left on the forming candle in the last-price label.
 * Returns the candle series (for markers), recreated whenever the chart is.
 */
export function useCandleSeries(
  chartRef: RefObject<IChartApi | null>,
  bars: readonly Bar[],
  barDurationMs: number,
): RefObject<ISeriesApi<"Candlestick"> | null> {
  const seriesRef = useRef<CandleSeries | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const shownBarsRef = useRef<readonly Bar[]>([]);
  // OHLC currently drawn for the last candle — mid-animation this differs from the bar.
  const displayedRef = useRef<Ohlc | null>(null);
  const animationRef = useRef<number | null>(null);

  const stopAnimation = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  };

  const animateLastCandle = (series: CandleSeries, target: Bar) => {
    const from = displayedRef.current ?? target;
    const startedAt = performance.now();
    const step = () => {
      const t = Math.min((performance.now() - startedAt) / LERP_DURATION_MS, 1);
      const e = easeOutCubic(t);
      const frame = {
        open: target.open,
        high: lerp(from.high, target.high, e),
        low: lerp(from.low, target.low, e),
        close: lerp(from.close, target.close, e),
      };
      series.candle.update({ time: toCandle(target).time, ...frame });
      displayedRef.current = frame;
      animationRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    series.volume.update(toVolume(target));
    animationRef.current = requestAnimationFrame(step);
  };

  const resetAll = (series: CandleSeries) => {
    series.candle.setData(bars.map(toCandle));
    series.volume.setData(bars.map(toVolume));
    series.chart.timeScale().fitContent();
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
    stopAnimation();

    shownBarsRef.current = bars;

    const isTick = last !== undefined && shownLast !== undefined &&
      bars.length === shown.length && last.time === shownLast.time;
    if (isTick) {
      // displayedRef is left alone: it tracks the frame on screen, which the next lerp starts from.
      if (!isSameOhlc(last, displayedRef.current ?? shownLast)) animateLastCandle(series, last);
      return;
    }
    const isAppend = last !== undefined && shownLast !== undefined &&
      bars.length === shown.length + 1 && bars[bars.length - 2]?.time === shownLast.time;
    if (isAppend) {
      // Settle the candle that just closed — it may have been mid-animation.
      series.candle.update(toCandle(bars[bars.length - 2]!));
      series.candle.update(toCandle(last));
      series.volume.update(toVolume(last));
    } else {
      resetAll(series);
    }
    displayedRef.current = last ?? null;
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
