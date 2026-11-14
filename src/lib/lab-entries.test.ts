import { describe, expect, it } from "bun:test";
import type { BookRow } from "./held-options";
import { chargesPct, orbSignal, scalpDay } from "./lab-entries";

// 09:15 IST, Monday 2 Nov 2026.
const OPEN = Date.UTC(2026, 10, 2, 3, 45);
const MIN = 60_000;
/** Five-minute bars of the underlying from the open; only time and spot matter to a signal. */
const bars = (spots: readonly number[]): BookRow[] =>
  spots.map((spot, i) => ({ time: OPEN + i * 5 * MIN, spot, atm: 25000, iv: 15, ce: {}, pe: {} }));

describe("orbSignal", () => {
  // Opening range from the first three bars: 100–104.
  const range = [100, 104, 102];

  it("calls on the first close above the range and enters on the next bar", () => {
    expect(orbSignal(bars([...range, 103, 105, 106]), false)).toEqual({ side: "CE", entryMinute: 25, rangeHigh: 104, rangeLow: 100 });
  });

  it("puts on the first close below the range", () => {
    expect(orbSignal(bars([...range, 99, 98]), false)).toMatchObject({ side: "PE", entryMinute: 20 });
  });

  it("takes only the session's first breakout", () => {
    expect(orbSignal(bars([...range, 99, 106, 107]), false)?.side).toBe("PE");
  });

  it("drops a breakout the running average has not followed, with no second try", () => {
    // Range average 102. Drifting to 100.5 pulls the average down to 101.6, so the breakout at 105 is not followed.
    const sagging = [...range, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 105, 106, 99, 98];
    expect(orbSignal(bars(sagging), false)?.side).toBe("CE");
    expect(orbSignal(bars(sagging), true)).toBeUndefined();
    expect(orbSignal(bars([...range, 105, 106]), true)).toMatchObject({ side: "CE", entryMinute: 20 });
  });

  it("needs the whole opening range and a bar to enter on", () => {
    expect(orbSignal(bars([...range, 105]), false)).toBeUndefined();
    expect(orbSignal(bars([...range, 105, 106]).slice(1), false)).toBeUndefined();
  });
});

describe("chargesPct", () => {
  it("charges the round trip as a share of the entry cost", () => {
    // 65 × ₹100 in, ₹110 out: brokerage 40, exchange 4.78, SEBI 0.01, STT 10.73, stamp 0.20, GST 8.06 → ₹63.78 on ₹6,500.
    expect(chargesPct(100, 110, 65)).toBeCloseTo(0.981, 2);
  });
});

describe("scalpDay", () => {
  const q = (close: number, high = close, low = close) => ({ close, high, low });
  /** One-minute bars from the open: spot, and the 25000 call and put at each bar. */
  const minuteBars = (path: readonly (readonly [number, number, number])[]): BookRow[] =>
    path.map(([spot, call, put], i) => ({ time: OPEN + i * MIN, spot, atm: 25000, iv: 15, ce: { "25000": q(call) }, pe: { "25000": q(put) } }));
  const flat = Array.from({ length: 15 }, () => [100, 50, 50] as const);
  const rules = { lookbackBars: 3, targetPct: 10, stopPct: 5, maxHoldMinutes: 5 };

  it("buys the next bar after a momentum close and exits at the target", () => {
    // 09:30 closes above the last three closes: call bought at 09:31 for 50, target 55 hit at 09:32.
    const trades = scalpDay(minuteBars([...flat, [101, 50, 50], [102, 50, 50], [103, 56, 45], [103, 56, 45]]), rules);
    expect(trades[0]).toMatchObject({ side: "CE", entryPrice: 50, exitReason: "target" });
    expect(trades[0]!.exitPrice).toBeCloseTo(55);
  });

  it("holds one position at a time and looks again only after the exit", () => {
    const rising = Array.from({ length: 12 }, (_, i) => [101 + i, 50 + i * 0.2, 50] as const);
    const trades = scalpDay(minuteBars([...flat, ...rising]), rules);
    for (let i = 1; i < trades.length; i++) expect(trades[i]!.entryTime).toBeGreaterThan(trades[i - 1]!.exitTime);
    // Each one is closed by the five-minute hold limit, the premium never reaching its target.
    expect(trades.every((t) => t.exitReason === "time" || t.exitReason === "day end")).toBe(true);
  });
});
