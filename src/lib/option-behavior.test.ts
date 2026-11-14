import { describe, expect, it } from "bun:test";
import { byDaysToExpiry, ivReaction, ivVsRealized, measureSensitivity, realizedVolatility, type DailyBar } from "./option-behavior";
import type { DayStats, RollingRow } from "./rolling-options";

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 3, 45);

const dayOf = (over: Partial<DayStats>): DayStats => ({
  date: "2026-11-02", weekday: 1, spotOpen: 100, spotClose: 100, spotHigh: 101, spotLow: 99, ivOpen: 15, ivClose: 15,
  premiumOpen: 4, premiumClose: 3, premiumChangePct: -25, impliedMove: 1, realizedMove: 0, moveRatio: 0, rangeRatio: 2, isExpiryDay: false, ...over,
});

describe("realizedVolatility", () => {
  it("is zero for a market that rises by the same step every day", () => {
    const bars: DailyBar[] = Array.from({ length: 25 }, (_, i) => { const close = 100 * 1.01 ** i; return { time: START + i * DAY, open: close, high: close, low: close, close }; });
    const rv = realizedVolatility(bars, 20);
    expect([...rv.values()].every((v) => v < 1e-6)).toBe(true);
    expect(rv.size).toBe(5);
  });

  it("annualizes alternating ±1% days to about 15.9%", () => {
    // Log returns of ±1% have a sample stdev of ~0.01025; × √252 ≈ 16.3%.
    const bars: DailyBar[] = Array.from({ length: 22 }, (_, i) => { const close = i % 2 === 0 ? 100 : 101; return { time: START + i * DAY, open: close, high: close, low: close, close }; });
    const last = [...realizedVolatility(bars, 20).values()].at(-1)!;
    expect(last).toBeGreaterThan(15);
    expect(last).toBeLessThan(17);
  });
});

describe("ivVsRealized", () => {
  it("pairs each ordinary day's IV with realized vol and averages the spread", () => {
    const result = ivVsRealized([dayOf({ date: "a", ivOpen: 18 }), dayOf({ date: "b", ivOpen: 14 }), dayOf({ date: "c", isExpiryDay: true })], new Map([["a", 12], ["b", 16], ["c", 10]]));
    expect(result.points.map((p) => p.date)).toEqual(["a", "b"]);
    expect(result.averageSpread).toBe(2);
  });
});

describe("ivReaction", () => {
  it("separates IV change on up and down days and reads their correlation", () => {
    const days = [
      dayOf({ spotOpen: 100, spotClose: 101, ivOpen: 15, ivClose: 14 }),
      dayOf({ spotOpen: 100, spotClose: 102, ivOpen: 15, ivClose: 13 }),
      dayOf({ spotOpen: 100, spotClose: 99, ivOpen: 15, ivClose: 16 }),
      dayOf({ spotOpen: 100, spotClose: 99, ivOpen: 15, ivClose: 20, isExpiryDay: true }),
    ];
    const r = ivReaction(days);
    expect(r).toMatchObject({ upDays: 2, downDays: 1, ivChangeOnUpDays: -1.5, ivChangeOnDownDays: 1 });
    expect(r.correlation).toBeLessThan(-0.9);
  });
});

describe("measureSensitivity", () => {
  // A call that gains 0.5 and a put that loses 0.5 per point of spot, both losing 0.1 per 5-minute bar.
  const rows: RollingRow[] = [0, 4, -2, 6, 1, 3].map((move, i) => ({
    time: START + i * 300_000,
    spot: 10_000 + move,
    ce: { strike: 10_000, close: 100 + 0.5 * move - 0.1 * i, iv: 15, oi: 0, volume: 0 },
    pe: { strike: 10_000, close: 100 - 0.5 * move - 0.1 * i, iv: 15, oi: 0, volume: 0 },
  }));

  it("recovers the delta and the time decay from the bars", () => {
    const r = measureSensitivity(rows, new Set());
    expect(r.call.perOnePercent).toBeCloseTo(0.5 * 100.00, 0); // spot ~10,000, so 1% is ~100 points
    expect(r.put.perOnePercent).toBeCloseTo(-50, 0);
    expect(r.call.perHour).toBeCloseTo(-1.2, 6); // −0.1 a bar × 12 bars an hour
    expect(r.straddle.perOnePercent).toBeCloseTo(0, 6);
    expect(r.call.fit).toBeCloseTo(1, 6);
  });

  it("skips pairs where the strike rolled, and expiry days", () => {
    const rolled = rows.map((r, i) => (i === 3 ? { ...r, ce: { ...r.ce, strike: 10_050 } } : r));
    expect(measureSensitivity(rolled, new Set()).call.samples).toBe(3);
    expect(measureSensitivity(rows, new Set(["2026-10-01"])).call.samples).toBe(0);
  });
});

describe("byDaysToExpiry", () => {
  it("counts trading days to the next expiry and leaves out days after the last one", () => {
    const days = [
      dayOf({ date: "1", premiumOpen: 3 }), dayOf({ date: "2", premiumOpen: 2 }), dayOf({ date: "3", premiumOpen: 1, isExpiryDay: true }),
      dayOf({ date: "4", premiumOpen: 3 }), dayOf({ date: "5", premiumOpen: 1, isExpiryDay: true }), dayOf({ date: "6" }),
    ];
    const groups = byDaysToExpiry(days);
    expect(groups.map((g) => [g.dte, g.days])).toEqual([[2, 1], [1, 2], [0, 2]]);
    expect(groups.find((g) => g.dte === 0)!.straddlePct).toBe(1);
    expect(groups.find((g) => g.dte === 1)!.straddlePct).toBe(2.5);
  });
});
