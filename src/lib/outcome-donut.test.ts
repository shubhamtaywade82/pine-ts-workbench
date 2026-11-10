import { describe, expect, test } from "bun:test";
import { CLASSIFIER_VERSION, type LiquidityInteraction } from "./liquidity-outcomes";
import type { WallTransitionRow } from "./market-recorder";
import { decisionCentre, decisionLine } from "@/components/chart/outcome-panel";
import {
  ENOUGH_OUTCOMES,
  interactionWrite,
  outcomeStats,
  scanInteractions,
  sessionCount,
  turnBreakShare,
  wilsonInterval,
  type ScanInput,
  type ScanOptions,
} from "./outcome-donut";

const options: ScanInput["options"] = {
  proximityPct: 2, reversalPct: 1, breakoutPct: 1, evaluationWindowMs: 10_000, consumedPct: 50, priceTolerance: 0.5,
};

const transition = (over: Partial<WallTransitionRow> = {}): WallTransitionRow => ({
  wallId: "BTCUSDT:bid:100", symbol: "BTCUSDT", side: "bid", price: 100, kind: "detected",
  notional: 1_000, at: 1_000, detectorVersion: "1", ...over,
});

const scan = (over: Partial<ScanInput> = {}, opts: Partial<ScanOptions> = {}) =>
  scanInteractions({
    transitions: [transition()], trades: [], path: [{ at: 2_000, price: 100 }, { at: 3_000, price: 101 }],
    gapTimes: [], options, ...over,
  }, { now: 100_000, tradesFrom: 0, storedWallIds: new Set(), ...opts });

describe("scanInteractions", () => {
  test("keeps a finished window with no threshold as no reaction", () => {
    expect(scan({ path: [{ at: 2_000, price: 100 }, { at: 5_000, price: 100 }] }).map((row) => row.outcome)).toEqual(["NO_REACTION"]);
  });

  test("stores a resolved turn and ignores an open window", () => {
    const [row] = scan();
    expect(row).toMatchObject({
      wallId: "BTCUSDT:bid:100",
      symbol: "BTCUSDT",
      side: "bid",
      levelPrice: 100,
      outcome: "TURNED",
      classifierVersion: CLASSIFIER_VERSION,
      resolvedAt: 3_000,
    });
    expect(scan({}, { now: 2_500 })).toEqual([]);
  });

  test("drops a touch that happened before the wall was detected", () => {
    const rows = scan({
      transitions: [transition({ at: 5_000 })],
      path: [{ at: 2_000, price: 100 }, { at: 3_000, price: 101 }, { at: 6_000, price: 100 }, { at: 7_000, price: 99 }],
    });
    expect(rows.map((row) => row.outcome)).toEqual(["BROKE"]);
    expect(rows[0]?.startAt).toBe(6_000);
  });

  test("stores a finished gap as unresolved and skips an open window", () => {
    expect(scan({
      path: [{ at: 2_000, price: 100 }, { at: 5_000, price: 101 }],
      gapTimes: [3_000],
    }).map((row) => row.outcome)).toEqual(["UNRESOLVED"]);
    expect(scan({
      path: [{ at: 2_000, price: 100 }, { at: 5_000, price: 101 }],
      gapTimes: [3_000],
    }, { now: 2_500 })).toEqual([]);
    expect(scan({
      path: [{ at: 2_000, price: 100 }, { at: 5_000, price: 101 }],
    }).map((row) => row.outcome)).toEqual(["TURNED"]);
  });

  test("stores unresolved when the finished window has no print after the touch", () => {
    expect(scan({
      path: [{ at: 2_000, price: 100 }, { at: 30_000, price: 101 }],
    }).map((row) => row.outcome)).toEqual(["UNRESOLVED"]);
  });

  test("stores only the first touch when a wall is touched twice", () => {
    const rows = scan({
      path: [{ at: 2_000, price: 100 }, { at: 3_000, price: 95 }, { at: 8_000, price: 100 }, { at: 9_000, price: 101 }],
    });
    expect(rows.map((row) => [row.outcome, row.startAt])).toEqual([["BROKE", 2_000]]);
  });

  test("turns a removal without a later touch into pulled, and a filled removal into consumed", () => {
    const pulled = scan({
      transitions: [transition(), transition({ kind: "pulled", at: 1_500, notional: 500 })],
      path: [{ at: 2_000, price: 100 }],
    });
    expect(pulled.map((row) => row.outcome)).toEqual(["PULLED_BEFORE_TOUCH"]);

    const consumed = scan({
      transitions: [transition(), transition({ kind: "removed", at: 4_200, notional: 1_000 })],
      path: [{ at: 2_000, price: 100 }, { at: 12_000, price: 100 }],
      trades: [{ at: 3_500, price: 100.4, quantity: 5 }, { at: 4_500, price: 100, quantity: 6 }],
    });
    expect(consumed.map((row) => row.outcome)).toEqual(["CONSUMED"]);
  });

  // Touched-then-turned, removed untouched, and detected before the collector started.
  const slidingTransitions = () => [
    transition({ wallId: "BTCUSDT:bid:100", price: 100, at: 15_000 }),
    transition({ wallId: "BTCUSDT:bid:300", price: 300, at: 15_000 }),
    transition({ wallId: "BTCUSDT:bid:300", price: 300, kind: "pulled", at: 40_000, notional: 500 }),
    transition({ wallId: "BTCUSDT:bid:50", price: 50, at: 5_000 }),
  ];

  test("stores at most one row per wall across three sliding scans", () => {
    const input: ScanInput = {
      transitions: slidingTransitions(), trades: [], gapTimes: [], restartTimes: [10_000], options,
      path: [{ at: 16_000, price: 100 }, { at: 17_000, price: 101 }],
    };
    const stored = new Set<string>();
    const scanAt = (now: number, tradesFrom: number) => {
      const rows = scanInteractions(input, { now, tradesFrom, storedWallIds: stored });
      for (const row of rows) stored.add(row.wallId);
      return rows;
    };
    const first = scanAt(45_000, 20_000);
    const second = scanAt(55_000, 30_000);
    const third = scanAt(65_000, 45_000);
    const all = [...first, ...second, ...third];
    expect(first.map((r) => [r.wallId, r.outcome])).toEqual([
      ["BTCUSDT:bid:100", "TURNED"],
      ["BTCUSDT:bid:300", "PULLED_BEFORE_TOUCH"],
    ]);
    expect(second).toEqual([]);
    expect(third).toEqual([]);
    expect(new Set(all.map((r) => r.wallId)).size).toBe(all.length);
    expect(all.filter((r) => r.wallId === "BTCUSDT:bid:300").map((r) => r.outcome)).toEqual(["PULLED_BEFORE_TOUCH"]);
    expect(all.some((r) => r.wallId === "BTCUSDT:bid:50")).toBe(false);
  });

  test("keeps an empty update so a stored version is never rewritten", () => {
    const [row] = scan();
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(interactionWrite(row).update).toEqual({});
    expect(interactionWrite(row).where.wallId_startAt_classifierVersion.classifierVersion).toBe(CLASSIFIER_VERSION);
  });

  test("classifies two lives at the same price as separate outcomes", () => {
    const rows = scan({
      transitions: [
        transition({ wallId: "BTCUSDT:bid:100:1000", price: 100, at: 1_000 }),
        transition({ wallId: "BTCUSDT:bid:100:1000", kind: "pulled", price: 100, at: 2_000, notional: 500 }),
        transition({ wallId: "BTCUSDT:bid:100:5000", price: 100, at: 5_000 }),
      ],
      path: [{ at: 6_000, price: 100 }, { at: 7_000, price: 101 }],
    });
    expect(rows.map((r) => [r.wallId, r.outcome])).toEqual([["BTCUSDT:bid:100:1000", "PULLED_BEFORE_TOUCH"], ["BTCUSDT:bid:100:5000", "TURNED"]]);
  });

  test("detected -> outage -> re-detected -> touch gives UNRESOLVED for old life and separate new life", () => {
    const rows = scan({
      transitions: [
        transition({ wallId: "BTCUSDT:bid:100:1000", price: 100, at: 1_000, kind: "detected" }),
        transition({ wallId: "BTCUSDT:bid:100:1000", price: 100, at: 2_000, kind: "unobserved" }),
        transition({ wallId: "BTCUSDT:bid:100:3000", price: 100, at: 3_000, kind: "detected" }),
      ],
      path: [{ at: 4_000, price: 100 }, { at: 5_000, price: 101 }],
    });
    expect(rows.map((r) => [r.wallId, r.outcome])).toEqual([["BTCUSDT:bid:100:1000", "UNRESOLVED"], ["BTCUSDT:bid:100:3000", "TURNED"]]);
  });

  test("a touch inside a gap range is UNRESOLVED", () => {
    const rows = scan({
      transitions: [transition({ wallId: "BTCUSDT:bid:100:1000", price: 100, at: 1_000 })],
      path: [{ at: 2_500, price: 100 }, { at: 3_000, price: 101 }],
      gaps: [{ from: 2_000, to: 2_800 }],
    });
    expect(rows.map((r) => r.outcome)).toEqual(["UNRESOLVED"]);
  });

  test("wall detected, restart marker, no further rows -> its life ends unobserved; wall detected after restart is classified normally", () => {
    const rows = scan({
      transitions: [
        transition({ wallId: "BTCUSDT:bid:100:1000", price: 100, at: 1_000 }),
        transition({ wallId: "BTCUSDT:bid:200:3000", price: 200, at: 3_000 }),
      ],
      path: [{ at: 4_000, price: 200 }, { at: 5_000, price: 202 }],
      restartTimes: [2_000],
    });
    expect(rows.map((r) => [r.wallId, r.outcome])).toEqual([["BTCUSDT:bid:100:1000", "UNRESOLVED"], ["BTCUSDT:bid:200:3000", "TURNED"]]);
  });
});

describe("turnBreakShare", () => {
  test("uses only turned and broke, with the Wilson interval for 56/100", () => {
    const share = turnBreakShare(56, 44);
    expect(share?.total).toBe(100);
    expect(share?.turnedPct).toBeCloseTo(0.56);
    expect(share?.ci?.low).toBeCloseTo(0.462, 3);
    expect(share?.ci?.high).toBeCloseTo(0.653, 3);
    expect(turnBreakShare(0, 0)).toBeNull();
    expect(ENOUGH_OUTCOMES).toBe(20);
  });

  test("hides the donut until twenty turns and breaks, and prints each share with its n", () => {
    expect(decisionCentre(379, 297)).toBe("56% turned · n=676");
    expect(decisionLine("Turned", 379, 379 / 676)).toBe("Turned 56% (379)");
    expect(decisionLine("Broke", 297, 297 / 676)).toBe("Broke 44% (297)");
    expect(decisionCentre(19, 0)).toBe("Not enough data");
    expect(decisionLine("Turned", 19, null)).toBe("Turned 19");
  });

  test("counts a calendar day once", () => {
    expect(sessionCount([Date.parse("2026-11-01T00:30:00Z"), Date.parse("2026-11-01T23:00:00Z"), Date.parse("2026-11-02T00:00:00Z")])).toBe(2);
  });
});

const interaction = (over: Partial<LiquidityInteraction> = {}): LiquidityInteraction => ({
  wallId: "w",
  side: "bid",
  levelPrice: 100,
  detectedAt: 1,
  startAt: 1_000,
  resolvedAt: 2_000,
  outcome: "TURNED",
  maxFavorableExcursionPct: 1,
  maxAdverseExcursionPct: 0.5,
  classifierVersion: CLASSIFIER_VERSION,
  ...over,
});

describe("wilsonInterval", () => {
  test("returns the 95% Wilson interval for 56 successes out of 100", () => {
    const interval = wilsonInterval(56, 100);
    expect(interval?.low).toBeCloseTo(0.462, 3);
    expect(interval?.high).toBeCloseTo(0.653, 3);
  });

  test("returns null when the sample is empty", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  test("clamps low and high to [0, 1]", () => {
    const zero = wilsonInterval(0, 5);
    expect(zero?.low).toBeGreaterThanOrEqual(0);
    const full = wilsonInterval(5, 5);
    expect(full?.high).toBeLessThanOrEqual(1);
  });
});

describe("outcomeStats", () => {
  test("drops UNRESOLVED from denominators and attaches Wilson intervals", () => {
    const stats = outcomeStats([
      interaction({ startAt: 1_000, resolvedAt: 1_100, maxFavorableExcursionPct: 1, maxAdverseExcursionPct: 0.2 }),
      interaction({ outcome: "BROKE", startAt: 2_000, resolvedAt: 2_400, maxFavorableExcursionPct: 0.4, maxAdverseExcursionPct: 1.2 }),
      interaction({ outcome: "NO_REACTION", startAt: 3_000, resolvedAt: 4_000, maxFavorableExcursionPct: 0.2, maxAdverseExcursionPct: 0.4 }),
      interaction({ outcome: "UNRESOLVED", startAt: 500, resolvedAt: null }),
    ]);
    expect(stats.counts).toMatchObject({ TURNED: 1, BROKE: 1, NO_REACTION: 1, UNRESOLVED: 1, CONSUMED: 0 });
    expect(stats.n).toBe(3);
    expect(stats.turnedPct).toBeCloseTo(1 / 3);
    expect(stats.brokePct).toBeCloseTo(1 / 3);
    expect(stats.turnedCi).toEqual(wilsonInterval(1, 3));
    expect(stats.brokeCi).toEqual(wilsonInterval(1, 3));
    expect(stats.from).toBe(500);
    expect(stats.to).toBe(4_000);
    expect(stats.avgFavorableExcursionPct).toBeCloseTo((1 + 0.4 + 0.2) / 3);
    expect(stats.avgAdverseExcursionPct).toBeCloseTo((0.2 + 1.2 + 0.4) / 3);
    expect(stats.medianResolutionMs).toBe(400);
    expect(stats.classifierVersion).toBe(CLASSIFIER_VERSION);
  });

  test("refuses to mix classifier versions into the same percentage", () => {
    const stats = outcomeStats([
      interaction({ outcome: "TURNED" }),
      interaction({ outcome: "BROKE", classifierVersion: "2", startAt: 9_000, resolvedAt: 9_500 }),
    ]);
    expect(stats.n).toBe(1);
    expect(stats.turnedPct).toBe(1);
    expect(stats.brokePct).toBe(0);
    expect(stats.classifierVersions).toEqual(["1", "2"]);
    const onlySecond = outcomeStats([interaction({ outcome: "BROKE", classifierVersion: "2" })], { classifierVersion: "2" });
    expect(onlySecond.n).toBe(1);
    expect(onlySecond.brokePct).toBe(1);
    expect(onlySecond.classifierVersion).toBe("2");
  });

  test("returns null rates when nothing has resolved", () => {
    const stats = outcomeStats([interaction({ outcome: "UNRESOLVED", resolvedAt: null })]);
    expect(stats.n).toBe(0);
    expect(stats.turnedPct).toBeNull();
    expect(stats.brokePct).toBeNull();
    expect(stats.turnedCi).toBeNull();
    expect(stats.medianResolutionMs).toBeNull();
    expect(stats.avgFavorableExcursionPct).toBeNull();
  });

  test("uses the average of the two middle resolution times when the count is even", () => {
    const stats = outcomeStats([interaction({ startAt: 0, resolvedAt: 100 }), interaction({ startAt: 0, resolvedAt: 500 })]);
    expect(stats.medianResolutionMs).toBe(300);
  });
});
