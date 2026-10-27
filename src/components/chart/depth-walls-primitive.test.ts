import { describe, expect, test } from "bun:test";
import { bubbleCenterX, formatAge, formatPct, separateLabels, wallLabel } from "./depth-walls-primitive";

const wall = { side: "bid" as const, price: 79_500, quantity: 25.76, notional: 2_048_054, observedSince: 0 };
const base = { wall, quoteAsset: "USDT", searchedPct: 0.5, clippedByCoverage: false, observedMs: 180_000 };

describe("depth wall bubbles", () => {
  test("labels spread one line apart around close walls, ask above bid", () => {
    expect(separateLabels(100, 102, 14)).toEqual({ ask: 94, bid: 108 });
  });

  test("labels stay on walls that are already far enough apart", () => {
    expect(separateLabels(100, 140, 14)).toEqual({ ask: 100, bid: 140 });
    expect(separateLabels(null, 102, 14)).toEqual({ ask: null, bid: 102 });
  });

  test("sit just right of the forming candle", () => {
    // half a bar (5) + gap (3) + radius (10)
    expect(bubbleCenterX(100, 10, 10, 800)).toBe(118);
  });

  test("stay inside the pane at the right edge", () => {
    expect(bubbleCenterX(795, 10, 10, 800)).toBe(790);
  });
});

describe("wall labels", () => {
  test("show price, notional in the quote currency, observation length, and the detection scope", () => {
    expect(wallLabel({ ...base, status: "live" })).toBe("79,500 · 2.05M USDT · observed for 3m · max in ±0.5%");
  });

  test("name the quote currency from the input, never assume USDT", () => {
    expect(wallLabel({ ...base, status: "live", quoteAsset: "EUR" })).toContain("2.05M EUR");
  });

  test("say the window was clipped by snapshot coverage", () => {
    expect(wallLabel({ ...base, status: "live", searchedPct: 0.9, clippedByCoverage: true }))
      .toContain("max in ±0.9% (coverage)");
  });

  test("append a non-live status so a frozen or resyncing wall is not read as current", () => {
    expect(wallLabel({ ...base, status: "stale" })).toEndWith("max in ±0.5% · stale");
    expect(wallLabel({ ...base, status: "syncing" })).toEndWith("max in ±0.5% · syncing");
  });

  test("never uses the old 'stood' wording, which implied an order's age", () => {
    expect(wallLabel({ ...base, status: "live" })).not.toMatch(/stood|since|age/);
  });

  test("shows dynamic liquidity statuses: absorbing, stacking, tested, absorbed, and pulled", () => {
    const absorbingWall = { ...wall, status: "absorbing" as const, changePct: -35 };
    expect(wallLabel({ ...base, wall: absorbingWall, status: "live" }))
      .toContain("absorbing (-35%) · 3m");

    const stackingWall = { ...wall, status: "stacking" as const, changePct: 40 };
    expect(wallLabel({ ...base, wall: stackingWall, status: "live" }))
      .toContain("stacking (+40%) · 3m");

    const testedWall = { ...wall, status: "tested" as const };
    expect(wallLabel({ ...base, wall: testedWall, status: "live" }))
      .toContain("tested (holding) · 3m");

    const absorbedWall = { ...wall, status: "absorbed" as const };
    expect(wallLabel({ ...base, wall: absorbedWall, status: "live" }))
      .toContain("absorbed (filled) · 3m");

    const pulledWall = { ...wall, status: "pulled" as const };
    expect(wallLabel({ ...base, wall: pulledWall, status: "live" }))
      .toContain("pulled (cancelled)");
  });
});

describe("formatting", () => {
  test("observation length: under 10 s is shown, not hidden", () => {
    expect(formatAge(0)).toBe("<10s");
    expect(formatAge(9_000)).toBe("<10s");
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(180_000)).toBe("3m");
    expect(formatAge(3_900_000)).toBe("1h 5m");
  });

  test("the detection window prints without padding", () => {
    expect(formatPct(0.5)).toBe("0.5");
    expect(formatPct(0.9)).toBe("0.9");
    expect(formatPct(1.25)).toBe("1.25");
    expect(formatPct(0.2985)).toBe("0.3");
  });
});
