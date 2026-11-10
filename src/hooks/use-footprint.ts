"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import { INTERVAL_MS, type BinanceSymbol, type ChartInterval, type LiveTrade } from "@/lib/public-binance-feed";
import { loadTickSize } from "@/lib/symbol-catalog";
import type { ChartSettings } from "@/lib/chart-settings";
import type { FootprintMode } from "@/lib/trading-settings";
import { addTrade, footprintSupported, type FootprintBar } from "@/lib/footprint";
import { FootprintPrimitive } from "@/components/chart/footprint-primitive";

/** Exchange tick is unknown: one part in 1e5 of the print, rounded to a power of ten. */
const fallbackTickSize = (price: number): number => {
  const ratio = price / 1e5;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return 1;
  return 10 ** Math.round(Math.log10(ratio));
};

export interface FootprintInput {
  readonly seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  readonly symbol: BinanceSymbol | undefined;
  readonly interval: ChartInterval;
  readonly trading: ChartSettings["trading"];
  readonly subscribeTrades?: (listener: (trade: LiveTrade) => void) => () => void;
  readonly seriesType?: string;
}

interface FootprintSlot {
  series: ISeriesApi<SeriesType>;
  primitive: FootprintPrimitive;
}

interface TradeOptions {
  intervalMs: number;
  bucketTicks: number;
  mode: FootprintMode;
  enabled: boolean;
}

const detach = (series: ISeriesApi<SeriesType>, primitive: FootprintPrimitive): void => {
  try {
    series.detachPrimitive(primitive);
  } catch {
    // The chart may already have removed this series.
  }
};

const attach = (series: ISeriesApi<SeriesType>, slot: { current: FootprintSlot | null }): FootprintPrimitive => {
  const current = slot.current;
  if (current?.series === series) return current.primitive;
  if (current !== null) detach(current.series, current.primitive);
  const primitive = new FootprintPrimitive();
  series.attachPrimitive(primitive);
  slot.current = { series, primitive };
  return primitive;
};

interface TradeSession {
  readonly bars: FootprintBar[];
  readonly primitive: FootprintPrimitive;
  readonly options: { current: TradeOptions };
  readonly tickBox: { tick: number | undefined };
  raf: number;
}

const publish = (session: TradeSession): void => {
  if (session.raf !== 0) return;
  session.raf = requestAnimationFrame(() => {
    session.raf = 0;
    session.primitive.setView(session.bars, session.options.current.mode);
  });
};

const onPrint = (session: TradeSession, trade: LiveTrade): void => {
  const { intervalMs, bucketTicks, enabled } = session.options.current;
  if (!enabled) return;
  if (session.tickBox.tick === undefined) session.tickBox.tick = fallbackTickSize(trade.price);
  addTrade(session.bars, trade, { intervalMs, tickSize: session.tickBox.tick, bucketTicks });
  publish(session);
};

interface TradeWatch {
  readonly primitive: FootprintPrimitive;
  readonly symbol: BinanceSymbol;
  readonly subscribeTrades: NonNullable<FootprintInput["subscribeTrades"]>;
  readonly bars: FootprintBar[];
  readonly options: { current: TradeOptions };
}

const watchTrades = (watch: TradeWatch): (() => void) => {
  const session: TradeSession = {
    bars: watch.bars,
    primitive: watch.primitive,
    options: watch.options,
    tickBox: { tick: undefined },
    raf: 0,
  };
  let unsubscribe = () => {};
  let stopped = false;
  void loadTickSize(watch.symbol).then((known) => {
    if (stopped) return;
    session.tickBox.tick = known;
    unsubscribe = watch.subscribeTrades((trade) => onPrint(session, trade));
  });
  return () => {
    stopped = true;
    unsubscribe();
    if (session.raf !== 0) cancelAnimationFrame(session.raf);
    watch.primitive.clear();
  };
};

/** Live footprint for one Binance symbol. History is not rebuilt from candles. */
export function useFootprint(input: FootprintInput): void {
  const { seriesRef, symbol, interval, trading, subscribeTrades, seriesType } = input;
  const { enabled, mode, bucketTicks } = trading.footprint;
  const slot = useRef<FootprintSlot | null>(null);
  const barsRef = useRef<FootprintBar[]>([]);
  const options = useRef<TradeOptions>({ intervalMs: INTERVAL_MS[interval], bucketTicks, mode, enabled });

  useEffect(() => {
    options.current = { intervalMs: INTERVAL_MS[interval], bucketTicks, mode, enabled };
  }, [interval, bucketTicks, mode, enabled]);

  useEffect(() => {
    slot.current?.primitive.setView(barsRef.current, mode);
  }, [mode]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series === null) return;
    const primitive = attach(series, slot);
    const bars: FootprintBar[] = [];
    barsRef.current = bars;
    primitive.setView(bars, options.current.mode);
    if (!enabled || !footprintSupported(interval) || symbol === undefined || subscribeTrades === undefined) {
      return () => { primitive.clear(); };
    }
    return watchTrades({ primitive, symbol, subscribeTrades, bars, options });
  }, [seriesRef, symbol, interval, bucketTicks, enabled, subscribeTrades, seriesType]);
}
