import { describe, expect, it } from "bun:test";
import { summarizeChain, type RawChain } from "./option-chain";
import { breakevenOf, payoffAtExpiry, payoffCurve, payoffRange, summarizePayoff, type LongOption } from "./option-payoff";

const call: LongOption = { side: "call", strike: 100, premium: 5 };
const put: LongOption = { side: "put", strike: 100, premium: 4 };

describe("payoffAtExpiry", () => {
  it("loses the whole premium when a call finishes at or below its strike", () => {
    expect(payoffAtExpiry(call, 90)).toBe(-5);
    expect(payoffAtExpiry(call, 100)).toBe(-5);
  });

  it("breaks even at strike plus premium and profits above it", () => {
    expect(payoffAtExpiry(call, 105)).toBe(0);
    expect(payoffAtExpiry(call, 112)).toBe(7);
  });

  it("mirrors that for a put", () => {
    expect(payoffAtExpiry(put, 110)).toBe(-4);
    expect(payoffAtExpiry(put, 96)).toBe(0);
    expect(payoffAtExpiry(put, 80)).toBe(16);
  });

  it("never loses more than the premium, however far the price falls or rises", () => {
    for (const price of [0, 50, 99, 150, 10_000]) {
      expect(payoffAtExpiry(call, price)).toBeGreaterThanOrEqual(-call.premium);
      expect(payoffAtExpiry(put, price)).toBeGreaterThanOrEqual(-put.premium);
    }
  });
});

describe("breakevenOf", () => {
  it("adds the premium to a call's strike and takes it from a put's", () => {
    expect(breakevenOf(call)).toBe(105);
    expect(breakevenOf(put)).toBe(96);
  });
});

describe("payoffCurve and payoffRange", () => {
  it("returns evenly spaced points including both ends", () => {
    const curve = payoffCurve(call, 90, 110, 4);
    expect(curve.map((p) => p.price)).toEqual([90, 95, 100, 105, 110]);
    expect(curve.map((p) => p.pnl)).toEqual([-5, -5, -5, 0, 5]);
  });

  it("covers the breakeven, the strike and the expected move around spot", () => {
    const { from, to } = payoffRange(call, 100, 8);
    expect(from).toBeLessThan(92);
    expect(to).toBeGreaterThan(108);
  });

  it("still draws something sensible with nothing to go on", () => {
    const { from, to } = payoffRange({ side: "call", strike: 100, premium: 0 }, 100, undefined);
    expect(to).toBeGreaterThan(from);
  });
});

describe("summarizePayoff", () => {
  const leg = (ltp: number, oi: number, iv = 15) => ({ last_price: ltp, oi, previous_oi: oi, implied_volatility: iv, greeks: { theta: -1, gamma: 0.01 } });
  const chain: RawChain = {
    lastPrice: 100,
    strikes: [
      { strike: 90, put: leg(1, 500) }, { strike: 100, call: leg(3, 100), put: leg(3, 100) },
      { strike: 105, call: leg(2, 300) }, { strike: 110, call: leg(1, 500) },
    ],
  };
  const summary = summarizeChain(chain, undefined, { expiry: "2026-11-27", now: Date.UTC(2026, 10, 13) })!;
  const at = (option: LongOption) => summarizePayoff(option, 100, summary.analytics, summary.straddle);

  it("reports the breakeven, the risk and how far spot must travel", () => {
    const result = at(call);
    expect(result.breakeven).toBe(105);
    expect(result.maxLoss).toBe(5);
    expect(result.moveToBreakeven).toBe(5);
    expect(result.moveToBreakevenPct).toBeCloseTo(5);
  });

  it("shows a put's breakeven below spot as a negative move", () => {
    expect(at(put).moveToBreakeven).toBe(-4);
  });

  it("says whether the market's expected move reaches breakeven", () => {
    // The ATM straddle here is 6: a call needing +5 is inside it, one needing +9 is not.
    expect(at(call).isWithinExpectedMove).toBe(true);
    expect(at({ ...call, premium: 9 }).isWithinExpectedMove).toBe(false);
  });

  it("prices the option at the favourable wall and the expected-range edges", () => {
    const labels = at(call).targets.map((t) => t.label);
    expect(labels).toContain("Call wall");
    expect(labels).toContain("Upper edge of expected range");
    const wall = at(call).targets.find((t) => t.label === "Call wall")!;
    expect(wall.price).toBe(110);
    expect(wall.pnl).toBe(payoffAtExpiry(call, 110));
  });

  it("uses the put wall for a put, not the call wall", () => {
    const labels = at(put).targets.map((t) => t.label);
    expect(labels).toContain("Put wall");
    expect(labels).not.toContain("Call wall");
  });
});
