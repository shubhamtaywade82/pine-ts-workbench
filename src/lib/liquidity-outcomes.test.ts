import { describe, expect, test } from "bun:test";
import {
  CLASSIFIER_VERSION,
  classifyInteractions,
  type DataGap,
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
  extra: { trades?: OutcomeTrade[]; gaps?: DataGap[]; now?: number } = {},
) =>
  classifyInteractions(target, path, extra.trades ?? [], {
    gaps: extra.gaps ?? [],
    options,
    now: extra.now ?? 100_000,
  });

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
        { at: 5_000, price: 100 },
      ]);
      expect(episode).toMatchObject({ outcome: "NO_REACTION", startAt: 2_000, resolvedAt: 12_000 });
    }
  });

  test("labels UNRESOLVED when a gap overlaps the evaluation window", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(
        wall({ side }),
        [{ at: 2_000, price: 100 }, { at: 5_000, price: favorable(side) }],
        { gaps: [{ from: 3_000, to: 4_000 }] },
      );
      expect(episode).toMatchObject({ outcome: "UNRESOLVED", startAt: 2_000, resolvedAt: null });
    }
  });

  test("labels UNRESOLVED while the window is still open and no threshold has printed", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(
        wall({ side }),
        [{ at: 2_000, price: 100 }, { at: 5_000, price: adverse(side) }],
        { now: 4_000 },
      );
      expect(episode).toMatchObject({ outcome: "UNRESOLVED", resolvedAt: null });
    }
  });

  test("resolves TURNED before the window ends once the reversal has printed", () => {
    const [episode] = run(wall(), [
      { at: 2_000, price: 100 },
      { at: 3_000, price: 101 },
    ], { now: 4_000 });
    expect(episode?.outcome).toBe("TURNED");
    expect(episode?.resolvedAt).toBe(3_000);
  });

  test("labels CONSUMED when in-window trades at the level cover the removed size", () => {
    for (const side of ["bid", "ask"] as const) {
      const [episode] = run(
        wall({ side, removedAt: 4_200, removedQuantity: 10 }),
        [{ at: 2_000, price: 100 }, { at: 12_000, price: 100 }],
        { trades: [{ at: 4_500, price: 100, quantity: 1 }, { at: 3_500, price: 100.4, quantity: 5 }] },
      );
      expect(episode).toMatchObject({ outcome: "CONSUMED", resolvedAt: 4_200 });
    }
  });

  test("does not call a wall consumed from trades printed after it was removed", () => {
    const [episode] = run(
      wall({ removedAt: 3_000, removedQuantity: 10 }),
      [{ at: 2_000, price: 100 }, { at: 8_000, price: 100 }],
      { trades: [{ at: 6_000, price: 100, quantity: 100 }] },
    );
    expect(episode?.outcome).toBe("NO_REACTION");
  });

  test("classifies an unsorted path in time order without changing the input", () => {
    const path: PricePoint[] = [
      { at: 4_000, price: 99 },
      { at: 2_000, price: 100 },
      { at: 3_000, price: 101 },
    ];
    const before = path.map((point) => ({ ...point }));
    const [episode] = run(wall(), path);
    expect(episode).toMatchObject({ outcome: "TURNED", startAt: 2_000, resolvedAt: 3_000 });
    expect(path).toEqual(before);
  });

  test("never starts an outcome at the same timestamp the wall was detected", () => {
    const printed = run(wall({ detectedAt: 5_000, removedAt: 5_500 }), [
      { at: 5_000, price: 100 },
      { at: 8_000, price: 101 },
    ]);
    expect(printed.map((episode) => episode.outcome)).toEqual(["PULLED_BEFORE_TOUCH"]);
    expect(printed.every((episode) => episode.startAt > 5_000)).toBe(true);
    expect(run(wall({ detectedAt: 5_000, removedAt: 5_000 }), [
      { at: 5_000, price: 100 },
      { at: 8_000, price: 99 },
    ])).toEqual([]);
  });

  test("labels UNRESOLVED when no print falls inside the finished window", () => {
    const [episode] = run(wall(), [
      { at: 2_000, price: 100 },
      { at: 30_000, price: 101 },
    ]);
    expect(episode).toMatchObject({ outcome: "UNRESOLVED", startAt: 2_000, resolvedAt: null });
  });

  test("keeps the price outcome when a removal is not backed by enough size at the level", () => {
    const [episode] = run(
      wall({ removedAt: 4_000, removedQuantity: 10 }),
      [{ at: 2_000, price: 100 }, { at: 3_000, price: 101 }],
      { trades: [{ at: 3_500, price: 100, quantity: 4 }, { at: 3_600, price: 102, quantity: 20 }] },
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
    expect(run(wall({ removedAt: 5_000 }), [], { now: 1_000 })).toEqual([]);
    expect(run(wall(), [{ at: 5_000, price: 100 }, { at: 6_000, price: 101 }], { now: 1_000 })).toEqual([]);
    expect(run(wall({ price: 0 }), [{ at: 2_000, price: 100 }])).toEqual([]);
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
