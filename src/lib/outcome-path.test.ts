import { describe, expect, test } from "bun:test";
import { classifyInteractions } from "./liquidity-outcomes";
import type { WallTransitionRow } from "./market-recorder";
import { OUTCOME_SCAN_OPTIONS } from "./outcome-donut";
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
      { from: 1_500, to: 3_000 },
      { from: 2_000, to: 3_000 },
      { from: 3_000, to: 5_000 },
      { from: 3_000, to: 5_000 },
    ]);
    expect(restartTimes).toEqual([3_000]);
  });

  test("a start before a restart with no end no longer extends past the restart", () => {
    const events = [
      { receivedAt: 1_500, payload: '{"stream":"trade","phase":"start"}' },
      { receivedAt: 3_000, payload: '{"stream":"collector","phase":"restart"}' },
    ];
    const { gaps } = gapRangesFromEvents(events, 5_000);
    const tradeStartGaps = gaps.filter((g) => g.from === 1_500);
    expect(tradeStartGaps).toEqual([{ from: 1_500, to: 3_000 }]);
  });

  test("pairs restart marker with first trade socket open and depth live", () => {
    const events = [
      { receivedAt: 1_000, payload: '{"stream":"collector","phase":"restart"}' },
      { receivedAt: 1_200, payload: '{"stream":"trade","phase":"end"}' },
      { receivedAt: 1_500, payload: '{"stream":"depth","phase":"end"}' },
    ];
    const { gaps, restartTimes } = gapRangesFromEvents(events, 2_000);
    expect(restartTimes).toEqual([1_000]);
    expect(gaps).toContainEqual({ from: 1_000, to: 1_200 });
    expect(gaps).toContainEqual({ from: 1_000, to: 1_500 });
  });

  // Both streams come back right after the restart, so only the downtime range can cover the window.
  const downtimeRows = [
    { receivedAt: 400_000, payload: '{"stream":"collector","phase":"restart"}' },
    { receivedAt: 400_100, payload: '{"stream":"trade","phase":"end"}' },
    { receivedAt: 400_100, payload: '{"stream":"depth","phase":"end"}' },
  ];

  test("a window after the last recorded event and before a restart falls in the downtime gap", () => {
    const tradeRows = [{ payload: '{"price":100,"quantity":1,"time":2000}', receivedAt: 2_000, exchangeTime: 2_000 }];
    const window = windowFrom([], tradeRows, downtimeRows, 410_000);
    expect(window.gaps).toContainEqual({ from: 2_000, to: 400_000 });
    const wall = { id: "BTCUSDT:bid:100", side: "bid" as const, price: 100, detectedAt: 1_000 };
    const [episode] = classifyInteractions(wall, window.path, window.trades, {
      gaps: window.gaps, options: OUTCOME_SCAN_OPTIONS, now: 410_000,
    });
    expect(episode?.outcome).toBe("UNRESOLVED");
  });

  test("each restart adds its own downtime range back to the previous event", () => {
    const rows = [
      { receivedAt: 1_000, payload: '{"stream":"collector","phase":"restart"}' },
      { receivedAt: 1_100, payload: '{"stream":"trade","phase":"end"}' },
      { receivedAt: 5_000, payload: '{"stream":"collector","phase":"restart"}' },
    ];
    const { gaps, restartTimes } = gapRangesFromEvents(rows, 6_000);
    expect(restartTimes).toEqual([1_000, 5_000]);
    expect(gaps).toContainEqual({ from: 1_100, to: 5_000 });
  });

  test("a restart with no earlier event falls back to one evaluation window", () => {
    const rows = [{ receivedAt: 400_000, payload: '{"stream":"collector","phase":"restart"}' }];
    const { gaps } = gapRangesFromEvents(rows, 410_000);
    expect(gaps).toContainEqual({ from: 100_000, to: 400_000 });
  });

  test("a 5-minute window that spans a restart is UNRESOLVED, not NO_REACTION", () => {
    const wallTransition: WallTransitionRow = {
      wallId: "BTCUSDT:bid:100",
      symbol: "BTCUSDT",
      side: "bid",
      price: 100,
      kind: "detected",
      notional: 1_000,
      at: 1_000,
      detectorVersion: "1",
    };
    const tradeRows = [
      { payload: '{"price":100,"quantity":1,"time":2000}', receivedAt: 2_000, exchangeTime: 2_000 },
      { payload: '{"price":100,"quantity":1,"time":305000}', receivedAt: 305_000, exchangeTime: 305_000 },
    ];
    const gapRows = [
      { receivedAt: 150_000, payload: '{"stream":"collector","phase":"restart"}' },
    ];
    const window = windowFrom([wallTransition], tradeRows, gapRows, 310_000);
    const wall = {
      id: "BTCUSDT:bid:100",
      side: "bid" as const,
      price: 100,
      detectedAt: 1_000,
    };
    const interactions = classifyInteractions(wall, window.path, window.trades, {
      gaps: window.gaps,
      options: OUTCOME_SCAN_OPTIONS,
      now: 310_000,
    });
    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.outcome).toBe("UNRESOLVED");
  });
});
