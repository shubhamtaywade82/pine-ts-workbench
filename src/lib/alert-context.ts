"use client";

/**
 * Derives the alert-evaluation context (RSI, SMA, MACD histogram, volume
 * SMA, last price, forming-bar time, 24h change) from a chart's live bars
 * with one pine-ts run — the same numbers the chart draws.
 */

import { indicator, ta, type Bar } from "@nemesis-oss/pine-ts";
import type { AlertContext } from "@/lib/alert-engine";

const CONTEXT_SCRIPT = indicator("alert-context", ({ close, high, low, volume, time, ctx, plot }) => {
  const rsi = ta.rsi(close, 14);
  const sma = ta.sma(close, 20);
  const { macdLine, signalLine } = ta.macd(close, 12, 26, 9);
  const hist = ctx.series("alert.hist", () => macdLine.at(0)! - signalLine.at(0)!);
  const volumeSma = ta.sma(volume, 20);
  const dayBars = ctx.series("alert.dayBars", () => 1);
  void high; void low;
  plot(rsi.at(0) ?? Number.NaN, "rsi");
  plot(sma.at(0) ?? Number.NaN, "sma");
  plot(hist.at(0) ?? Number.NaN, "hist");
  plot(volumeSma.at(0) ?? Number.NaN, "volumeSma");
  plot(volume.at(0) ?? Number.NaN, "volume");
  plot(time.at(0) ?? Number.NaN, "time");
});

/** Percent change over the last `lookbackBars` bars (24h for a 1m chart ≈ 1440). */
const percentChange = (bars: readonly Bar[], lookbackBars: number): number | undefined => {
  const last = bars.at(-1);
  const past = bars[Math.max(0, bars.length - 1 - lookbackBars)];
  if (last === undefined || past === undefined || past.close === 0) return undefined;
  return ((last.close - past.close) / past.close) * 100;
};

/** Roughly 24h of bars for the interval (falls back to all bars when unknown). */
export const estimate24hBars = (intervalMs: number): number =>
  intervalMs > 0 ? Math.max(2, Math.round((24 * 3_600_000) / intervalMs)) : 2;

/**
 * Computes the alert context for a chart. `intervalMs` drives the 24h
 * percent-change lookback. Returns undefined when bars are not loaded yet.
 */
export const computeAlertContext = async (
  bars: readonly Bar[],
  intervalMs: number,
  symbol: string,
): Promise<AlertContext | undefined> => {
  if (bars.length === 0) return undefined;
  const output = await CONTEXT_SCRIPT.run(bars);
  const at = (id: string): number | undefined => {
    const values = output.values[id];
    if (values === undefined) return undefined;
    const v = values.at(-1);
    return v === undefined || Number.isNaN(v) ? undefined : v;
  };
  const last = bars.at(-1)!;
  return {
    symbol,
    price: last.close,
    rsi: at("rsi"),
    sma: at("sma"),
    macdHist: at("hist"),
    volume: at("volume"),
    volumeSma: at("volumeSma"),
    percentChange24h: percentChange(bars, estimate24hBars(intervalMs)),
    barTime: last.time,
  };
};
