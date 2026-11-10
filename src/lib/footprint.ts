import { INTERVAL_MS, type ChartInterval, type LiveTrade } from "./public-binance-feed";
import { bucketBounds, priceBucketKey } from "./price-buckets";

/** Live footprint only. Older bars fall off the front; history waits for the Phase 5 store. */
export const MAX_BARS = 500;

export interface FootprintCell {
  priceFrom: number;
  priceTo: number;
  buy: number;
  sell: number;
  delta: number;
  total: number;
  count: number;
}

export interface FootprintBar {
  time: number;
  cells: Map<number, FootprintCell>;
  buy: number;
  sell: number;
  delta: number;
  cumulativeDelta: number;
  maxTradeId: number;
}

/** Fixed-width bars only. Weekly (Monday) and monthly candles do not align to the epoch. */
export const footprintSupported = (interval: ChartInterval): boolean =>
  INTERVAL_MS[interval] <= INTERVAL_MS["1d"];

export interface AddTradeOptions {
  readonly intervalMs: number;
  readonly tickSize: number;
  readonly bucketTicks: number;
}

const usable = (trade: LiveTrade, options: AddTradeOptions): boolean =>
  options.intervalMs > 0 && options.tickSize > 0 && options.bucketTicks > 0
  && Number.isFinite(trade.time) && Number.isFinite(trade.price)
  && Number.isFinite(trade.quantity) && Number.isFinite(trade.id);

const emptyBar = (time: number, cumulativeDelta: number): FootprintBar => ({
  time,
  cells: new Map(),
  buy: 0,
  sell: 0,
  delta: 0,
  cumulativeDelta,
  maxTradeId: Number.NEGATIVE_INFINITY,
});

const insertBar = (bars: FootprintBar[], time: number): number => {
  const later = bars.findIndex((bar) => bar.time > time);
  const at = later === -1 ? bars.length : later;
  const carried = bars[at - 1]?.cumulativeDelta ?? 0;
  bars.splice(at, 0, emptyBar(time, carried));
  return at;
};

const barIndex = (bars: FootprintBar[], time: number): number => {
  const last = bars.length - 1;
  if (last >= 0 && bars[last]!.time === time) return last;
  const existing = bars.findIndex((bar) => bar.time === time);
  if (existing !== -1) return existing;
  return insertBar(bars, time);
};

const addToCell = (bar: FootprintBar, trade: LiveTrade, options: AddTradeOptions): void => {
  const key = priceBucketKey(trade.price, options.tickSize, options.bucketTicks);
  const cell = bar.cells.get(key) ?? {
    ...bucketBounds(key, options.tickSize, options.bucketTicks),
    buy: 0, sell: 0, delta: 0, total: 0, count: 0,
  };
  if (trade.aggressor === "buy") cell.buy += trade.quantity;
  else cell.sell += trade.quantity;
  cell.delta = cell.buy - cell.sell;
  cell.total = cell.buy + cell.sell;
  cell.count += 1;
  bar.cells.set(key, cell);
};

const addToBar = (bar: FootprintBar, trade: LiveTrade): number => {
  if (trade.aggressor === "buy") bar.buy += trade.quantity;
  else bar.sell += trade.quantity;
  bar.delta = bar.buy - bar.sell;
  return trade.aggressor === "buy" ? trade.quantity : -trade.quantity;
};

const shiftCumulative = (bars: FootprintBar[], from: number, delta: number): void => {
  for (let index = from; index < bars.length; index += 1) bars[index]!.cumulativeDelta += delta;
};

const trimBars = (bars: FootprintBar[]): FootprintBar[] => {
  const extra = bars.length - MAX_BARS;
  if (extra > 0) bars.splice(0, extra);
  return bars;
};

/** Mutates `bars` and returns it so the chart can keep one array across trades. */
export const addTrade = (bars: FootprintBar[], trade: LiveTrade, options: AddTradeOptions): FootprintBar[] => {
  if (!usable(trade, options)) return bars;
  const time = Math.floor(trade.time / options.intervalMs) * options.intervalMs;
  if (bars.length >= MAX_BARS && time < bars[0]!.time) return bars;
  const index = barIndex(bars, time);
  const bar = bars[index]!;
  // One stream's trade ids only increase, so a lower or equal id was already applied.
  if (trade.id <= bar.maxTradeId) return trimBars(bars);
  bar.maxTradeId = trade.id;
  addToCell(bar, trade, options);
  shiftCumulative(bars, index, addToBar(bar, trade));
  return trimBars(bars);
};

/** Merges historical and buffered live trades in trade id order without duplicates. */
export const mergeHistoryAndLive = (
  history: readonly LiveTrade[],
  live: readonly LiveTrade[],
): LiveTrade[] => {
  const byId = new Map<number, LiveTrade>();
  for (const trade of history) byId.set(trade.id, trade);
  for (const trade of live) byId.set(trade.id, trade);
  return [...byId.values()].sort((a, b) => a.id - b.id);
};
