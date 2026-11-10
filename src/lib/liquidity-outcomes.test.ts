import { describe, expect, test } from "bun:test";
import {
  CLASSIFIER_VERSION,
  classifyInteractions,
  outcomeStats,
  wilsonInterval,
  type DataGap,
  type LiquidityInteraction,
  type OutcomeOptions,
  type OutcomeTrade,
  type OutcomeWall,
  type PricePoint,
} from "./liquidity-outcomes";

const options: OutcomeOptions = {
  proximityPct: 2,
  reversalPct: 1,
  breakoutPct: 1,
  evaluationWindowMs: 10_000,
  consumedPct: 50,
  priceTolerance: 0.5,
};

const wall = (over: Partial<OutcomeWall> = {}): OutcomeWall => ({
  id: "w1",
  side: "bid",
  price: 100,
  detectedAt: 1_000,
  ...over,
});

const run = (
  target: OutcomeWall,
  path: PricePoint[],
  trades: OutcomeTrade[] = [],
  gaps: DataGap[] = [],
  now = 100_000,
) => classifyInteractions(target, path, trades, { gaps, options, now });

const favorable = (side: OutcomeWall["side"]): number => (side === "bid" ? 101 : 99);
const adverse = (side: OutcomeWall["side"]): number => (side === "bid" ? 99 : 101);

describe("classifyInteractions", () => {
  test("labels TURNED when the favorable move prints before the break, for both sides", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(wall({ side }), [
        { at: 2_000, price: 100 },
        { at: 3_000, price: favorable(side) },
        { at: 4_000, price: adverse(side) },
      ]);
      expect(episode).toMatchObject({
        wallId: "w1",
        side,
        levelPrice: 100,
        detectedAt: 1_000,
        startAt: 2_000,
        resolvedAt: 3_000,
        outcome: "TURNED",
        maxFavorableExcursionPct: 1,
        maxAdverseExcursionPct: 0,
        classifierVersion: CLASSIFIER_VERSION,
      });
    }
  });

  test("labels BROKE when price trades through the level before it reverses, for both sides", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(wall({ side }), [
        { at: 2_000, price: 100 },
        { at: 3_000, price: adverse(side) },
        { at: 4_000, price: favorable(side) },
      ]);
      expect(episode).toMatchObject({
        outcome: "BROKE",
        startAt: 2_000,
        resolvedAt: 3_000,
        maxFavorableExcursionPct: 0,
        maxAdverseExcursionPct: 1,
      });
    }
  });

  test("labels PULLED_BEFORE_TOUCH when the wall is gone before price enters the zone", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(wall({ side, removedAt: 1_500 }), [
        { at: 2_000, price: 100 },
        { at: 3_000, price: favorable(side) },
      ]);
      expect(episode).toMatchObject({
        outcome: "PULLED_BEFORE_TOUCH",
        startAt: 1_500,
        resolvedAt: 1_500,
        maxFavorableExcursionPct: 0,
        maxAdverseExcursionPct: 0,
      });
    }
  });

  test("labels NO_REACTION when neither threshold prints inside a finished window", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(wall({ side }), [
        { at: 2_000, price: 100 },
        { at: 12_000, price: 100 },
      ]);
      expect(episode).toMatchObject({ outcome: "NO_REACTION", startAt: 2_000, resolvedAt: 12_000 });
    }
  });

  test("labels UNRESOLVED when a gap overlaps the evaluation window", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(
        wall({ side }),
        [{ at: 2_000, price: 100 }, { at: 5_000, price: favorable(side) }],
        [],
        [{ from: 3_000, to: 4_000 }],
      );
      expect(episode).toMatchObject({ outcome: "UNRESOLVED", startAt: 2_000, resolvedAt: null });
    }
  });

  test("labels UNRESOLVED while the window is still open and no threshold has printed", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(
        wall({ side }),
        [{ at: 2_000, price: 100 }, { at: 5_000, price: adverse(side) }],
        [],
        [],
        4_000,
      );
      expect(episode).toMatchObject({ outcome: "UNRESOLVED", resolvedAt: null });
    }
  });

  test("resolves TURNED before the window ends once the reversal has printed", () => {
    const [episode] = run(wall(), [
      { at: 2_000, price: 100 },
      { at: 3_000, price: 101 },
    ], [], [], 4_000);
    expect(episode?.outcome).toBe("TURNED");
    expect(episode?.resolvedAt).toBe(3_000);
  });

  test("labels CONSUMED when in-window trades at the level cover the removed size", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(
        wall({ side, removedAt: 4_200, removedQuantity: 10 }),
        [{ at: 2_000, price: 100 }, { at: 12_000, price: 100 }],
        [{ at: 4_500, price: 100, quantity: 1 }, { at: 3_500, price: 100.4, quantity: 5 }],
      );
      expect(episode).toMatchObject({ outcome: "CONSUMED", resolvedAt: 4_200 });
    }
  });

  test("keeps the price outcome when a removal is not backed by enough size at the level", () => {
    const [episode] = run(
      wall({ removedAt: 4_000, removedQuantity: 10 }),
      [{ at: 2_000, price: 100 }, { at: 3_000, price: 101 }],
      [{ at: 3_500, price: 100, quantity: 4 }, { at: 3_600, price: 102, quantity: 20 }],
    );
    expect(episode?.outcome).toBe("TURNED");
  });

  test("ignores a touch that is not strictly after the wall was detected", () => {
    const early = run(wall({ detectedAt: 5_000 }), [
      { at: 2_000, price: 100 },
      { at: 3_000, price: 101 },
      { at: 5_000, price: 100 },
      { at: 6_000, price: 100 },
      { at: 7_000, price: 99 },
    ]);
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ outcome: "BROKE", startAt: 6_000, resolvedAt: 7_000 });
    expect(run(wall({ detectedAt: 5_000 }), [{ at: 5_000, price: 100 }, { at: 8_000, price: 110 }])).toEqual([]);
  });

  test("does not use a removal or a price that is still in the future", () => {
    expect(run(wall({ removedAt: 5_000 }), [], [], [], 1_000)).toEqual([]);
    expect(run(wall(), [{ at: 5_000, price: 100 }, { at: 6_000, price: 101 }], [], [], 1_000)).toEqual([]);
  });

  test("counts a new interaction only after price has left by more than twice the proximity", () => {
    const path: PricePoint[] = [
      { at: 2_000, price: 100 },
      { at: 3_000, price: 101 },
      { at: 4_000, price: 104 },
      { at: 5_000, price: 100 },
      { at: 6_000, price: 99 },
    ];
    expect(run(wall(), path).map((episode) => episode.outcome)).toEqual(["TURNED"]);

    const left = run(wall(), [
      { at: 2_000, price: 100 },
      { at: 3_000, price: 95 },
      { at: 8_000, price: 100 },
      { at: 9_000, price: 101 },
    ]);
    expect(left.map((episode) => episode.outcome)).toEqual(["BROKE", "TURNED"]);
    expect(left.map((episode) => episode.startAt)).toEqual([2_000, 8_000]);
  });
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
    const onlySecond = outcomeStats([
      interaction({ outcome: "BROKE", classifierVersion: "2" }),
    ], { classifierVersion: "2" });
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
});
