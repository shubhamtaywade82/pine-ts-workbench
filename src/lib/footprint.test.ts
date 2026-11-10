import { describe, expect, test } from "bun:test";
import type { LiveTrade } from "./public-binance-feed";
import { addTrade, footprintSupported, MAX_BARS, type FootprintBar } from "./footprint";

const options = { intervalMs: 60_000, tickSize: 0.01, bucketTicks: 10 };

const trade = (partial: Partial<LiveTrade> & Pick<LiveTrade, "id" | "time">): LiveTrade => ({
  price: 100.05,
  quantity: 1,
  aggressor: "buy",
  ...partial,
});

const cellAt = (bar: FootprintBar, priceFrom: number) =>
  [...bar.cells.values()].find((cell) => Math.abs(cell.priceFrom - priceFrom) < 1e-8);

describe("addTrade", () => {
  test("sums buy and sell quantity by aggressor in the same price bucket", () => {
    let bars = addTrade([], trade({ id: 1, time: 1_000, quantity: 2, aggressor: "buy" }), options);
    bars = addTrade(bars, trade({ id: 2, time: 2_000, quantity: 0.5, aggressor: "sell" }), options);
    bars = addTrade(bars, trade({ id: 3, time: 3_000, price: 100.15, quantity: 4, aggressor: "buy" }), options);
    const bar = bars[0]!;
    expect(bar.buy).toBe(6);
    expect(bar.sell).toBe(0.5);
    expect(cellAt(bar, 100)?.buy).toBe(2);
    expect(cellAt(bar, 100)?.sell).toBe(0.5);
    expect(cellAt(bar, 100.1)?.buy).toBe(4);
    expect(cellAt(bar, 100)?.priceTo).toBeCloseTo(100.1);
  });

  test("sets delta to buy minus sell on the cell and the bar", () => {
    let bars = addTrade([], trade({ id: 1, time: 1_000, quantity: 3, aggressor: "buy" }), options);
    bars = addTrade(bars, trade({ id: 2, time: 2_000, quantity: 1, aggressor: "sell" }), options);
    const cell = cellAt(bars[0]!, 100)!;
    expect(cell.delta).toBe(2);
    expect(cell.total).toBe(4);
    expect(cell.count).toBe(2);
    expect(bars[0]!.delta).toBe(2);
  });

  test("ignores a trade id already seen in that bar", () => {
    let bars = addTrade([], trade({ id: 7, time: 1_000, quantity: 2, aggressor: "buy" }), options);
    bars = addTrade(bars, trade({ id: 7, time: 2_000, quantity: 9, aggressor: "sell" }), options);
    expect(bars[0]!.buy).toBe(2);
    expect(bars[0]!.sell).toBe(0);
    expect(cellAt(bars[0]!, 100)?.count).toBe(1);
    bars = addTrade(bars, trade({ id: 7, time: 60_000, quantity: 1, aggressor: "sell" }), options);
    expect(bars[1]!.sell).toBe(1);
  });

  test("puts a trade exactly on the interval boundary in the new bar", () => {
    let bars = addTrade([], trade({ id: 1, time: 59_999 }), options);
    bars = addTrade(bars, trade({ id: 2, time: 60_000 }), options);
    expect(bars.map((bar) => bar.time)).toEqual([0, 60_000]);
    expect(bars[0]!.buy).toBe(1);
    expect(bars[1]!.buy).toBe(1);
  });

  test("carries cumulative delta from the previous bar", () => {
    let bars = addTrade([], trade({ id: 1, time: 1_000, quantity: 5, aggressor: "buy" }), options);
    bars = addTrade(bars, trade({ id: 2, time: 60_000, quantity: 2, aggressor: "sell" }), options);
    bars = addTrade(bars, trade({ id: 3, time: 120_000, quantity: 1, aggressor: "buy" }), options);
    expect(bars.map((bar) => bar.cumulativeDelta)).toEqual([5, 3, 4]);
  });

  test("cell totals reconcile with the trades that were accepted", () => {
    const accepted = [
      trade({ id: 1, time: 1_000, quantity: 1.5, aggressor: "buy" }),
      trade({ id: 1, time: 1_500, quantity: 9, aggressor: "sell" }),
      trade({ id: 2, time: 70_000, price: 99.99, quantity: 2, aggressor: "sell" }),
      trade({ id: 3, time: 70_100, price: 100.2, quantity: 0.25, aggressor: "buy" }),
    ];
    let bars: FootprintBar[] = [];
    for (const next of accepted) bars = addTrade(bars, next, options);
    const cellTotal = bars.reduce(
      (sum, bar) => sum + [...bar.cells.values()].reduce((inner, cell) => inner + cell.total, 0),
      0,
    );
    const inputTotal = 1.5 + 2 + 0.25;
    expect(cellTotal).toBeCloseTo(inputTotal);
    expect(bars.reduce((sum, bar) => sum + bar.buy + bar.sell, 0)).toBeCloseTo(inputTotal);
  });

  test("drops the oldest bar once the cap is passed", () => {
    let bars: FootprintBar[] = [];
    const count = MAX_BARS + 1;
    for (let index = 0; index < count; index += 1) {
      bars = addTrade(
        bars,
        trade({ id: index, time: index * 1_000, quantity: 1, aggressor: "buy" }),
        { intervalMs: 1_000, tickSize: 1, bucketTicks: 1 },
      );
    }
    expect(bars).toHaveLength(MAX_BARS);
    expect(bars[0]!.time).toBe(1_000);
    expect(bars.at(-1)!.time).toBe(MAX_BARS * 1_000);
    expect(bars.at(-1)!.cumulativeDelta).toBe(count);
  });

  test("leaves the bars unchanged when the trade or the bucket size is not usable", () => {
    const bars = addTrade([], trade({ id: 1, time: 1_000, quantity: 2 }), options);
    expect(addTrade(bars, trade({ id: 2, time: Number.NaN, quantity: 5 }), options)).toBe(bars);
    expect(bars[0]!.buy).toBe(2);
    expect(addTrade(bars, trade({ id: 3, time: 2_000 }), { ...options, tickSize: 0 })).toBe(bars);
    expect(addTrade(bars, trade({ id: Number.NaN, time: 2_000, quantity: 5 }), options)).toBe(bars);
    expect(bars).toHaveLength(1);
  });

  test("keeps one max trade id per bar instead of a collection of ids", () => {
    let bars = addTrade([], trade({ id: 10, time: 1_000, quantity: 1 }), options);
    bars = addTrade(bars, trade({ id: 11, time: 2_000, quantity: 1 }), options);
    bars = addTrade(bars, trade({ id: 12, time: 3_000, quantity: 1 }), options);
    bars = addTrade(bars, trade({ id: 9, time: 4_000, quantity: 8, aggressor: "sell" }), options);
    const bar = bars[0]!;
    expect(bar.maxTradeId).toBe(12);
    expect(bar.sell).toBe(0);
    expect(bar).not.toHaveProperty("seenIds");
    expect(Object.values(bar).some((value) => value instanceof Set)).toBe(false);
  });

  test("ignores a trade older than the oldest bar once the buffer is full", () => {
    let bars: FootprintBar[] = [];
    const bucket = { intervalMs: 1_000, tickSize: 1, bucketTicks: 1 };
    for (let index = 0; index < MAX_BARS; index += 1) {
      bars = addTrade(bars, trade({ id: index + 1, time: (index + 1) * 1_000 }), bucket);
    }
    const full = bars;
    const ignored = addTrade(full, trade({ id: MAX_BARS + 1, time: 0, quantity: 9 }), bucket);
    expect(ignored).toBe(full);
    expect(ignored[0]!.time).toBe(1_000);
    expect(ignored[0]!.buy).toBe(1);
    const onOldest = addTrade(ignored, trade({ id: MAX_BARS + 2, time: 1_000, quantity: 4 }), bucket);
    expect(onOldest).toHaveLength(MAX_BARS);
    expect(onOldest[0]!.buy).toBe(5);
  });

  test("keeps a repeated price on one integer bucket", () => {
    const price = 0.1 + 0.2;
    const bars = addTrade(
      [],
      trade({ id: 1, time: 1_000, price, quantity: 3 }),
      { intervalMs: 60_000, tickSize: 0.1, bucketTicks: 1 },
    );
    const cell = [...bars[0]!.cells.values()][0]!;
    expect(bars[0]!.cells.size).toBe(1);
    expect(cell.priceFrom).toBeCloseTo(0.3);
    expect(cell.priceTo).toBeCloseTo(0.4);
    expect(cell.buy).toBe(3);
  });
});

describe("footprintSupported", () => {
  test("allows intervals through 1d and refuses weekly and monthly bars", () => {
    expect(footprintSupported("1s")).toBe(true);
    expect(footprintSupported("4h")).toBe(true);
    expect(footprintSupported("1d")).toBe(true);
    expect(footprintSupported("1w")).toBe(false);
    expect(footprintSupported("1M")).toBe(false);
  });
});
