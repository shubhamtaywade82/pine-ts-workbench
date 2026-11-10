import { describe, expect, test } from "bun:test";
import type { WallTransitionRow } from "./market-recorder";
import {
  gapRangesFromEvents,
  pathFromTrades,
  tradeFromPayload,
  tradeGapAt,
  tradeLookbackStart,
  windowFrom,
} from "./outcome-path";

const transition = (): WallTransitionRow => ({
  wallId: "BTCUSDT:bid:100",
  symbol: "BTCUSDT",
  side: "bid",
  price: 100,
  kind: "detected",
  notional: 1_000,
  at: 1_000,
  detectorVersion: "1",
});

describe("pathFromTrades", () => {
  test("keeps each second's high and low prints and does not reorder the input", () => {
    const trades = [
      { at: 1_800, price: 99 },
      { at: 1_000, price: 100 },
      { at: 1_400, price: 105 },
      { at: 2_200, price: 101 },
    ];
    const before = trades.map((trade) => ({ ...trade }));
    expect(pathFromTrades(trades)).toEqual([
      { at: 1_400, price: 105 },
      { at: 1_800, price: 99 },
      { at: 2_200, price: 101 },
    ]);
    expect(pathFromTrades([{ at: 1_000, price: 50 }, { at: 1_500, price: 50 }])).toEqual([{ at: 1_000, price: 50 }]);
    expect(trades).toEqual(before);
  });
});

describe("recorded window", () => {
  test("builds the path from trades and keeps only trade-stream gaps", () => {
    expect(tradeFromPayload('{"price":"100","quantity":"2","time":5}', 9)).toEqual({ at: 5, price: 100, quantity: 2 });
    expect(tradeFromPayload("nope", 9)).toBeUndefined();
    expect(tradeGapAt('{"stream":"trade"}', 4)).toBe(4);
    expect(tradeGapAt('{"stream":"depth"}', 6)).toBeUndefined();
    const window = windowFrom(
      [transition()],
      [{ payload: '{"price":100,"quantity":1,"time":2000}', receivedAt: 3, exchangeTime: null }],
      [
        { receivedAt: 4, payload: '{"stream":"trade"}' },
        { receivedAt: 6, payload: '{"u":1}' },
      ],
    );
    expect(window.trades).toEqual([{ at: 2000, price: 100, quantity: 1 }]);
    expect(window.path).toEqual([{ at: 2000, price: 100 }]);
    expect(window.gapTimes).toEqual([4]);
  });

  test("covers the evaluation window, the scan interval, and a five minute margin", () => {
    expect(tradeLookbackStart(1_000_000, 300_000, 60_000)).toBe(340_000);
  });

  test("builds gap ranges from start/end pairs for both streams and keeps unmatched open", () => {
    const events = [
      { receivedAt: 1_000, payload: '{"stream":"depth","phase":"start"}' },
      { receivedAt: 1_500, payload: '{"stream":"trade","phase":"start"}' },
      { receivedAt: 2_000, payload: '{"stream":"depth","phase":"end"}' },
      { receivedAt: 3_000, payload: '{"stream":"collector","phase":"restart"}' },
    ];
    const { gaps, restartTimes } = gapRangesFromEvents(events, 5_000);
    expect(gaps).toEqual([
      { from: 1_000, to: 2_000 },
      { from: 1_500, to: 5_000 },
    ]);
    expect(restartTimes).toEqual([3_000]);
  });
});
