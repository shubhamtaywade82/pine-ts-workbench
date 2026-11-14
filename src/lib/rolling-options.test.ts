import { describe, expect, it } from "bun:test";
import { alignRows, byWeekday, dayStats, groupOf, intradayProfile, type RawSide } from "./rolling-options";

// 09:15 IST on Wednesday 11 Nov 2026, as epoch seconds.
const OPEN_S = Date.UTC(2026, 10, 11, 3, 45) / 1000;
const DAY_S = 86_400;

const side = (rows: readonly (readonly [number, number, number, number, number])[]): RawSide => ({
  timestamp: rows.map((r) => r[0]),
  close: rows.map((r) => r[1]),
  iv: rows.map((r) => r[2]),
  spot: rows.map((r) => r[3]),
  strike: rows.map((r) => r[4]),
  oi: rows.map(() => 1000),
  volume: rows.map(() => 10),
});

describe("alignRows", () => {
  it("pairs call and put by bar and drops a bar only one side has", () => {
    const ce = side([[OPEN_S, 100, 16, 25000, 25000], [OPEN_S + 300, 110, 16, 25050, 25050]]);
    const pe = side([[OPEN_S, 90, 18, 25000, 25000]]);
    const rows = alignRows(ce, pe);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ time: OPEN_S * 1000, spot: 25000, ce: { close: 100, strike: 25000 }, pe: { close: 90 } });
  });

  it("returns rows oldest first even if Dhan does not", () => {
    const rows = alignRows(side([[OPEN_S + 300, 1, 1, 1, 1], [OPEN_S, 1, 1, 1, 1]]), side([[OPEN_S, 1, 1, 1, 1], [OPEN_S + 300, 1, 1, 1, 1]]));
    expect(rows.map((r) => r.time)).toEqual([OPEN_S * 1000, (OPEN_S + 300) * 1000]);
  });
});

/** One day: spot from `open` to `close`, straddle from 200 to `premiumClose`, IV 16 throughout. */
const day = (startS: number, open: number, close: number, premiumClose: number) => ({
  ce: side([[startS, 100, 16, open, open], [startS + 6 * 3600, premiumClose / 2, 16, close, close]]),
  pe: side([[startS, 100, 16, open, open], [startS + 6 * 3600, premiumClose / 2, 16, close, close]]),
});
const rowsOf = (...days: ReturnType<typeof day>[]) => days.flatMap((d) => alignRows(d.ce, d.pe));

describe("dayStats", () => {
  // Implied 1-day move at IV 16 on 25000: 25000 × 0.16 / √252 ≈ 251.97.
  const implied = (25000 * 0.16) / Math.sqrt(252);

  it("prices the day's move from the opening IV and compares the real move with it", () => {
    const [stats] = dayStats(rowsOf(day(OPEN_S, 25000, 25300, 150)));
    expect(stats!.impliedMove).toBeCloseTo(implied, 4);
    expect(stats!.realizedMove).toBe(300);
    expect(stats!.moveRatio).toBeCloseTo(300 / implied, 6);
  });

  it("reports the straddle's change from open to close", () => {
    const [stats] = dayStats(rowsOf(day(OPEN_S, 25000, 25000, 150)));
    expect(stats!.premiumOpen).toBe(200);
    expect(stats!.premiumClose).toBe(150);
    expect(stats!.premiumChangePct).toBe(-25);
  });

  it("dates and names each day in IST", () => {
    const [stats] = dayStats(rowsOf(day(OPEN_S, 25000, 25000, 200)));
    expect(stats!.date).toBe("2026-11-11");
    expect(stats!.weekday).toBe(3);
  });

  it("keeps separate days apart", () => {
    const stats = dayStats(rowsOf(day(OPEN_S, 25000, 25300, 200), day(OPEN_S + DAY_S, 25300, 25310, 200)));
    expect(stats.map((s) => s.date)).toEqual(["2026-11-11", "2026-11-12"]);
  });
});

describe("groupOf and byWeekday", () => {
  const stats = dayStats(rowsOf(day(OPEN_S, 25000, 25400, 200), day(OPEN_S + DAY_S, 25000, 25010, 100)));

  it("counts the share of days that moved more than priced", () => {
    expect(groupOf(stats)).toMatchObject({ days: 2, movedMoreShare: 50 });
    expect(groupOf(stats).avgPremiumChangePct).toBe(-25);
  });

  it("splits by weekday, Monday first, leaving out days with no data", () => {
    expect(byWeekday(stats).map((g) => g.weekday)).toEqual([3, 4]);
  });

  it("is all zeros with no days", () => {
    expect(groupOf([])).toEqual({ days: 0, movedMoreShare: 0, avgMoveRatio: 0, avgPremiumChangePct: 0, avgIvOpen: 0 });
  });
});

describe("intradayProfile", () => {
  it("averages premium against each day's open in 15-minute buckets from 09:15", () => {
    const ce = side([[OPEN_S, 100, 16, 25000, 25000], [OPEN_S + 20 * 60, 80, 16, 25100, 25000]]);
    const pe = side([[OPEN_S, 100, 16, 25000, 25000], [OPEN_S + 20 * 60, 80, 16, 25100, 25000]]);
    const profile = intradayProfile(alignRows(ce, pe));
    expect(profile.map((p) => p.minute)).toEqual([0, 15]);
    expect(profile[0]!.premiumPct).toBe(0);
    expect(profile[1]!.premiumPct).toBeCloseTo(-20);
    expect(profile[1]!.spotMovePct).toBeCloseTo(0.4);
  });
});

describe("expiry days", () => {
  /** A day whose contract expires: IV ends at 0 and the straddle collapses. */
  const expiryDay = (startS: number) => ({
    ce: side([[startS, 100, 16, 25000, 25000], [startS + 6 * 3600, 2, 0, 25000, 25000]]),
    pe: side([[startS, 100, 16, 25000, 25000], [startS + 6 * 3600, 2, 0, 25000, 25000]]),
  });
  const normal = day(OPEN_S + 7 * DAY_S, 25000, 25100, 180);
  const rows = rowsOf(expiryDay(OPEN_S), normal);
  const stats = dayStats(rows);

  it("flags the day the contract expired, and only that day", () => {
    expect(stats.map((s) => s.isExpiryDay)).toEqual([true, false]);
  });

  it("keeps expiry days out of the weekday averages", () => {
    // Both days are Wednesdays; only the ordinary one counts.
    const [wednesday] = byWeekday(stats);
    expect(wednesday).toMatchObject({ weekday: 3, days: 1, avgPremiumChangePct: -10 });
  });

  it("keeps expiry days out of the average session", () => {
    const profile = intradayProfile(rows);
    expect(profile.every((p) => p.samples === 1)).toBe(true);
  });
});
