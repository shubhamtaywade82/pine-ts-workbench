"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  createPrimarySeries,
  formatSeriesData,
  formatSeriesPoint,
  getSeriesOptions,
  toVolumePoint,
  type CandleSettingsInput,
  type CandleType,
} from "@/lib/candle-themes";

const UP_COLOR = "#089981";
const DOWN_COLOR = "#f23645";
export const SMOOTHING_TAU_MS = 120;
const SETTLE_EPSILON = 1e-7;
const COUNTDOWN_REFRESH_MS = 1_000;
const INITIAL_VISIBLE_BARS = 150;
const INITIAL_RIGHT_OFFSET_BARS = 10;

interface Ohlc { open: number; high: number; low: number; close: number }

export interface CandleFrame extends Ohlc { readonly time: number; readonly volume: number }

interface CandleSeries {
  readonly chart: IChartApi;
  readonly candle: ISeriesApi<SeriesType>;
  readonly volume: ISeriesApi<"Histogram">;
  readonly type: CandleType;
}

export interface UseCandleSeriesOptions {
  readonly candleType?: CandleType;
  readonly candleSettings?: CandleSettingsInput;
  readonly scalePlacement?: "left" | "right";
  readonly onFrame?: (frame: CandleFrame) => void;
  readonly subscribeBars?: (listener: (bars: readonly Bar[]) => void) => () => void;
  readonly barColors?: ReadonlyMap<number, string>;
}

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const isSameOhlc = (a: Ohlc, b: Ohlc): boolean =>
  a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

const createCandleSeries = (
  chart: IChartApi,
  type: CandleType,
  candles: CandleSettingsInput,
  placement: "left" | "right",
): CandleSeries => {
  const candle = createPrimarySeries(chart, type, getSeriesOptions(type, candles, placement));
  const volume = chart.addSeries(HistogramSeries, {
    priceScaleId: "volume",
    priceFormat: { type: "volume" },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  return { chart, candle, volume, type };
};

const formatCountdown = (msLeft: number): string => {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function useCandleSeries(
  chartRef: RefObject<IChartApi | null>,
  bars: readonly Bar[],
  barDurationMs: number,
  optionsOrOnFrame?: UseCandleSeriesOptions | ((frame: CandleFrame) => void),
  legacySubscribeBars?: (listener: (bars: readonly Bar[]) => void) => () => void,
  legacyBarColors?: ReadonlyMap<number, string>,
): RefObject<ISeriesApi<SeriesType> | null> {
  const opts = typeof optionsOrOnFrame === "object" && optionsOrOnFrame !== null ? optionsOrOnFrame : undefined;
  const candleType = opts?.candleType ?? "candles";
  const candleSettings = opts?.candleSettings ?? { upColor: UP_COLOR, downColor: DOWN_COLOR };
  const scalePlacement = opts?.scalePlacement ?? "right";
  const onFrame = opts?.onFrame ?? (typeof optionsOrOnFrame === "function" ? optionsOrOnFrame : undefined);
  const subscribeBars = opts?.subscribeBars ?? legacySubscribeBars;
  const barColors = opts?.barColors ?? legacyBarColors;

  const seriesRef = useRef<CandleSeries | null>(null);
  const candleRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const [, setSeriesVersion] = useState(0);
  const shownBarsRef = useRef<readonly Bar[]>([]);
  const displayedRef = useRef<Ohlc | null>(null);
  const targetRef = useRef<Bar | null>(null);
  const animationRef = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  const barColorsRef = useRef(barColors);
  const typeRef = useRef(candleType);
  const candleSettingsRef = useRef(candleSettings);

  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { barColorsRef.current = barColors; }, [barColors]);
  useEffect(() => { typeRef.current = candleType; }, [candleType]);
  useEffect(() => { candleSettingsRef.current = candleSettings; }, [candleSettings]);

  const draw = (series: CandleSeries, target: Bar, frame: Ohlc) => {
    const ohlc = { open: frame.open, high: frame.high, low: frame.low, close: frame.close };
    const color = barColorsRef.current?.get(Math.floor(target.time / 1000));
    const prev = shownBarsRef.current[shownBarsRef.current.length - 2];
    const point = formatSeriesPoint({ ...target, ...ohlc }, prev, series.type, candleSettingsRef.current, color);
    series.candle.update(point as never);
    displayedRef.current = ohlc;
    onFrameRef.current?.({ ...ohlc, time: target.time, volume: target.volume });
  };

  const stopAnimation = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  };

  const chaseTarget = (series: CandleSeries) => {
    if (animationRef.current !== null) return;
    let lastFrameAt = performance.now();
    const step = (now: number) => {
      const target = targetRef.current;
      const from = displayedRef.current;
      if (target === null || from === null) { animationRef.current = null; return; }
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

  const resetAll = (series: CandleSeries, nextBars: readonly Bar[], previous: readonly Bar[]) => {
    const timeScale = series.chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    const colors = barColorsRef.current;
    const { upColor, downColor } = candleSettingsRef.current;
    const data = formatSeriesData(nextBars, series.type, candleSettingsRef.current, colors);
    series.candle.setData(data as never);
    series.volume.setData(nextBars.map((b) => toVolumePoint(b, upColor, downColor)));
    shownBarsRef.current = nextBars;
    const previousFirst = previous[0];
    if (previousFirst === undefined || visible === null) {
      const lastIndex = nextBars.length - 1;
      timeScale.setVisibleLogicalRange({ from: lastIndex - INITIAL_VISIBLE_BARS, to: lastIndex + INITIAL_RIGHT_OFFSET_BARS });
      return;
    }
    const shift = nextBars.findIndex((b) => b.time === previousFirst.time);
    if (shift > 0) timeScale.setVisibleLogicalRange({ from: visible.from + shift, to: visible.to + shift });
  };

  const reconcile = (series: CandleSeries, nextBars: readonly Bar[]) => {
    const nextLast = nextBars[nextBars.length - 1];
    if (nextLast === undefined) return;
    const shown = shownBarsRef.current;
    const shownLast = shown[shown.length - 1];
    const isTick = shownLast !== undefined && nextLast.time === shownLast.time && nextBars.length === shown.length;
    const isAppend = shownLast !== undefined && nextLast.time > shownLast.time && nextBars.length === shown.length + 1;
    const { upColor, downColor } = candleSettingsRef.current;
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
      const closed = nextBars[nextBars.length - 2]!;
      const closedColor = barColorsRef.current?.get(Math.floor(closed.time / 1000));
      const beforeClosed = nextBars[nextBars.length - 3];
      const point = formatSeriesPoint(closed, beforeClosed, series.type, candleSettingsRef.current, closedColor);
      series.candle.update(point as never);
      series.volume.update(toVolumePoint(closed, upColor, downColor));
      series.volume.update(toVolumePoint(nextLast, upColor, downColor));
      shownBarsRef.current = nextBars;
      targetRef.current = nextLast;
      draw(series, nextLast, nextLast);
      return;
    }
    shownBarsRef.current = nextBars;
    targetRef.current = nextLast;
    series.volume.update(toVolumePoint(nextLast, upColor, downColor));
    if (displayedRef.current === null) {
      draw(series, nextLast, nextLast);
    } else if (!isSameOhlc(nextLast, displayedRef.current)) {
      chaseTarget(series);
    }
  };

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
    if (seriesRef.current?.chart !== chart || seriesRef.current?.type !== candleType) {
      stopAnimation();
      if (seriesRef.current?.chart === chart) {
        chart.removeSeries(seriesRef.current.candle);
        chart.removeSeries(seriesRef.current.volume);
      }
      seriesRef.current = createCandleSeries(chart, candleType, candleSettings, scalePlacement);
      candleRef.current = seriesRef.current.candle;
      setSeriesVersion((v) => v + 1);
      shownBarsRef.current = [];
      displayedRef.current = null;
      targetRef.current = null;
    }
    const series = seriesRef.current;
    const shown = shownBarsRef.current;
    const last = bars[bars.length - 1];
    const shownLast = shown[shown.length - 1];
    if (last !== undefined && shownLast !== undefined && bars.length === shown.length && last.time === shownLast.time) {
      return;
    }
    reconcile(series, bars);
  }, [bars, candleType, scalePlacement]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series === null || shownBarsRef.current.length === 0) return;
    const colors = barColorsRef.current;
    const data = formatSeriesData(shownBarsRef.current, series.type, candleSettingsRef.current, colors);
    series.candle.setData(data as never);
    const { upColor, downColor } = candleSettingsRef.current;
    series.volume.setData(shownBarsRef.current.map((b) => toVolumePoint(b, upColor, downColor)));
  }, [
    barColors,
    candleSettings.upColor,
    candleSettings.downColor,
    candleSettings.borderUpColor,
    candleSettings.borderDownColor,
    candleSettings.wickUpColor,
    candleSettings.wickDownColor,
    candleSettings.showBody,
    candleSettings.showBorders,
    candleSettings.showWick,
  ]);

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
