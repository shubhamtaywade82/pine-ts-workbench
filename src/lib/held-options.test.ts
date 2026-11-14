import { describe, expect, it } from "bun:test";
import { buildBook, repairMixedExtremes, sessionMinute, simulateDay, trailedStop, type BookRow, type Quote } from "./held-options";

// 09:15 IST on 11 Nov 2026.
const OPEN = Date.UTC(2026, 10, 11, 3, 45);
const MIN = 60_000;
const q = (close: number, high = close, low = close): Quote => ({ high, low, close });

/** A bar at `minute` after the open; the ATM strike follows spot to the nearest 100. */
const bar = (minute: number, spot: number, ce: Record<number, Quote>, pe: Record<number, Quote> = {}): BookRow => ({
  time: OPEN + minute * MIN, spot, atm: Math.round(spot / 100) * 100, iv: 15,
  ce: Object.fromEntries(Object.entries(ce)), pe: Object.fromEntries(Object.entries(pe)),
});

describe("buildBook", () => {
  it("merges offsets into one book per bar, keyed by the real strike", () => {
    const t = OPEN / 1000;
    const book = buildBook([
      { side: "CALL", offset: 0, timestamp: [t], strike: [25000], close: [100], spot: [25010], iv: [14] },
      { side: "PUT", offset: 0, timestamp: [t], strike: [25000], close: [90], spot: [25010], iv: [16] },
      { side: "CALL", offset: 1, timestamp: [t], strike: [25050], close: [75], spot: [25010] },
    ]);
    expect(book).toHaveLength(1);
    expect(book[0]).toMatchObject({ atm: 25000, spot: 25010, iv: 15 });
    expect(book[0]!.ce["25050"]!.close).toBe(75);
    expect(book[0]!.pe["25000"]!.close).toBe(90);
  });

  it("drops a bar that lacks the at-the-money call or put", () => {
    const t = OPEN / 1000;
    expect(buildBook([{ side: "CALL", offset: 0, timestamp: [t], strike: [25000], close: [100] }])).toEqual([]);
  });
});

describe("sessionMinute", () => {
  it("counts minutes after 09:15 IST", () => {
    expect(sessionMinute(OPEN)).toBe(0);
    expect(sessionMinute(OPEN + 75 * MIN)).toBe(75);
  });
});

describe("simulateDay", () => {
  it("keeps following the bought strike after the money moves away from it", () => {
    const day = [
      bar(15, 25000, { 25000: q(100) }),
      bar(30, 25100, { 25000: q(150), 25100: q(100) }), // ATM is now 25100; the held 25000 call is 150
      bar(375, 25120, { 25000: q(160), 25100: q(110) }),
    ];
    const trade = simulateDay(day, { side: "CE", entryMinute: 15, exitMinute: 360 })!;
    expect(trade).toMatchObject({ strike: 25000, entryPrice: 100, exitPrice: 160, exitReason: "time", returnPct: 60 });
  });

  it("exits at the target level when a bar's high reaches it, and records the time to peak", () => {
    const day = [bar(15, 25000, { 25000: q(100) }), bar(20, 25020, { 25000: q(115, 120, 110) }), bar(25, 25060, { 25000: q(140, 145, 130) })];
    const trade = simulateDay(day, { side: "CE", entryMinute: 15, targetPct: 30, exitMinute: 360 })!;
    expect(trade).toMatchObject({ exitReason: "target", exitPrice: 130, returnPct: 30, minutesToPeak: 10 });
  });

  it("counts a bar that touched both stop and target as stopped", () => {
    const day = [bar(15, 25000, { 25000: q(100) }), bar(20, 25000, { 25000: q(100, 140, 70) })];
    expect(simulateDay(day, { side: "CE", entryMinute: 15, targetPct: 30, stopPct: 25, exitMinute: 360 })).toMatchObject({ exitReason: "stop", exitPrice: 75, returnPct: -25 });
  });

  it("fills a stop gapped through at the best price the bar offered, not at the stop", () => {
    const day = [bar(15, 25000, { 25000: q(100) }), bar(20, 24800, { 25000: q(60, 65, 55) })];
    expect(simulateDay(day, { side: "CE", entryMinute: 15, stopPct: 25, exitMinute: 360 })).toMatchObject({ exitReason: "stop", exitPrice: 65, returnPct: -35 });
  });

  it("tracks the best and worst prices on the way", () => {
    const day = [bar(15, 25000, { 25000: q(100) }), bar(20, 25000, { 25000: q(95, 110, 85) }), bar(25, 25000, { 25000: q(90) })];
    const trade = simulateDay(day, { side: "CE", entryMinute: 15, exitMinute: 360 })!;
    expect(trade.mfePct).toBe(10);
    expect(trade.maePct).toBe(-15);
    expect(trade.exitReason).toBe("day end");
  });

  it("exits at the last known price when the contract drifts out of the strikes fetched", () => {
    const day = [bar(15, 25000, { 25000: q(100) }), bar(20, 25000, { 25000: q(120) }), bar(25, 26000, { 26000: q(100) })];
    expect(simulateDay(day, { side: "CE", entryMinute: 15, exitMinute: 360 })).toMatchObject({ exitReason: "lost track", exitPrice: 120 });
  });

  it("trades the put book for a long put", () => {
    const day = [bar(15, 25000, {}, { 25000: q(100) }), bar(375, 24900, {}, { 25000: q(150) })];
    expect(simulateDay(day, { side: "PE", entryMinute: 15, exitMinute: 360 })).toMatchObject({ side: "PE", returnPct: 50 });
  });

  it("does not trade when the entry time is after the exit time or there is no price", () => {
    const day = [bar(15, 25000, { 25000: q(100) })];
    expect(simulateDay(day, { side: "CE", entryMinute: 400, exitMinute: 360 })).toBeUndefined();
    expect(simulateDay(day, { side: "PE", entryMinute: 15, exitMinute: 360 })).toBeUndefined();
  });
});

describe("repairMixedExtremes", () => {
  it("keeps only closes on a bar where the money moved, whose high and low mix two strikes", () => {
    const rows = [bar(15, 25000, { 25000: q(100, 104, 98) }), bar(20, 25050, { 25000: q(110, 112, 60) }), bar(25, 25050, { 25000: q(111, 115, 108) })];
    const [first, moved, steady] = repairMixedExtremes(rows);
    expect(first!.ce["25000"]).toEqual({ close: 100, high: 104, low: 98 });
    expect(moved!.ce["25000"]).toEqual({ close: 110, high: 110, low: 110 });
    expect(steady!.ce["25000"]).toEqual({ close: 111, high: 115, low: 108 });
  });
});

describe("repairMixedExtremes with the underlying's range", () => {
  // Calls at three strikes 50 apart: closes 150 / 120 / 95, so the 25000 call moves about (150 − 95) ÷ 100 = 0.55 per point.
  const row = (range: { high: number; low: number }, low = 60): BookRow => ({
    time: OPEN + 20 * MIN, spot: 25010, atm: 25000, iv: 15, range,
    ce: { 24950: q(150, 155, 145), 25000: q(120, 125, low), 25050: q(95, 98, 90) }, pe: {},
  });

  it("trusts a bar whose underlying stayed inside one strike's band", () => {
    const [kept] = repairMixedExtremes([row({ high: 25020, low: 24990 })]);
    expect(kept!.ce["25000"]).toEqual({ close: 120, high: 125, low: 60 });
  });

  it("re-estimates a bar where the underlying crossed a strike boundary and came back", () => {
    // The low of 24970 sits in 24950's band, so the 25000 series mixed strikes; its true low is about 120 − 0.55 × 40.
    const [fixed] = repairMixedExtremes([row({ high: 25020, low: 24970 })]);
    expect(fixed!.ce["25000"]!.low).toBeCloseTo(98, 0);
    expect(fixed!.ce["25000"]!.high).toBeCloseTo(125.5, 0);
    expect(fixed!.ce["25000"]!.close).toBe(120);
  });
});

describe("trailing stops", () => {
  // Bought at 100; the premium runs to 160, then falls back to 90.
  const run = [bar(15, 25000, { 25000: q(100) }), bar(20, 25100, { 25000: q(140, 140, 120) }), bar(25, 25200, { 25000: q(160, 160, 150) }), bar(30, 25000, { 25000: q(90, 150, 90) })];
  const rules = { side: "CE" as const, entryMinute: 15, stopPct: 30, exitMinute: 360 };

  it("moves the stop up on a bar's high, from the next bar on", () => {
    expect(trailedStop({ kind: "breakeven", afterPct: 30 }, 100, 129, 70)).toBe(70);
    expect(trailedStop({ kind: "breakeven", afterPct: 30 }, 100, 130, 70)).toBe(100);
    expect(trailedStop({ kind: "giveback", afterPct: 30, givebackPct: 25 }, 100, 160, 70)).toBe(120);
    expect(trailedStop({ kind: "step", stepPct: 15 }, 100, 160, 70)).toBeCloseTo(130);
  });

  it("exits at the trailed level and names it", () => {
    expect(simulateDay(run, { ...rules, trail: { kind: "giveback", afterPct: 30, givebackPct: 25 } })).toMatchObject({ exitReason: "trailing stop", exitPrice: 120 });
    expect(simulateDay(run, rules)).toMatchObject({ exitReason: "day end", exitPrice: 90 });
  });

  it("exits on the close when the trade's reason is gone", () => {
    expect(simulateDay(run, { ...rules, isInvalidated: (row) => row.spot < 25050 })).toMatchObject({ exitReason: "invalidated", exitPrice: 90 });
  });
});
