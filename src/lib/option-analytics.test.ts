import { describe, expect, it } from "bun:test";
import { daysToExpiry, detectSignals } from "./option-analytics";
import { summarizeChain, type RawChain } from "./option-chain";

interface LegSpec { ltp: number; oi: number; previousOi?: number; previousClose?: number; iv?: number; gamma?: number; theta?: number; volume?: number }

const leg = (s: LegSpec) => ({
  last_price: s.ltp, oi: s.oi, previous_oi: s.previousOi ?? s.oi, previous_close_price: s.previousClose ?? s.ltp,
  implied_volatility: s.iv ?? 15, volume: s.volume ?? 0, greeks: { delta: 0.5, gamma: s.gamma ?? 0, theta: s.theta ?? 0 },
});

// Spot 100. Calls pile up above the market, puts below it.
const chain: RawChain = {
  lastPrice: 100,
  strikes: [
    { strike: 90, call: leg({ ltp: 11, oi: 10 }), put: leg({ ltp: 0.5, oi: 100, iv: 20 }) },
    { strike: 95, call: leg({ ltp: 6, oi: 20 }), put: leg({ ltp: 1.5, oi: 80, previousOi: 20, previousClose: 1, iv: 18 }) },
    { strike: 100, call: leg({ ltp: 3, oi: 50, theta: -1.2, iv: 14 }), put: leg({ ltp: 3, oi: 50, theta: -1.0, iv: 16 }) },
    { strike: 105, call: leg({ ltp: 1, oi: 80, previousOi: 30, previousClose: 2, iv: 13 }), put: leg({ ltp: 6, oi: 20 }) },
    { strike: 110, call: leg({ ltp: 0.4, oi: 100 }), put: leg({ ltp: 11, oi: 10 }) },
  ],
};
const NOW = Date.UTC(2026, 10, 16, 10, 0);
const analyze = (c: RawChain = chain) => summarizeChain(c, undefined, { expiry: "2026-11-17", now: NOW })!.analytics;

describe("levels", () => {
  it("ranks resistance by call OI above spot and support by put OI below it", () => {
    const a = analyze();
    expect(a.resistances.map((l) => l.strike)).toEqual([110, 105, 100]);
    expect(a.supports.map((l) => l.strike)).toEqual([90, 95, 100]);
    expect(a.resistances[0]!.distancePct).toBeCloseTo(10);
    expect(a.supports[0]!.distancePct).toBeCloseTo(-10);
  });
});

describe("flow", () => {
  it("reads call OI added while the price fell as call writing, which leans down", () => {
    const callWriting = analyze().flows.find((f) => f.side === "call" && f.strike === 105)!;
    expect(callWriting).toMatchObject({ kind: "short buildup", label: "Call writing", lean: "bearish", oiChange: 50 });
  });

  it("reads put OI added while the price rose as put buying, which leans down", () => {
    const putBuying = analyze().flows.find((f) => f.side === "put" && f.strike === 95)!;
    expect(putBuying).toMatchObject({ kind: "long buildup", label: "Put buying", lean: "bearish", oiChange: 60 });
  });

  it("lists the biggest moves first", () => {
    const changes = analyze().flows.map((f) => Math.abs(f.oiChange));
    expect(changes).toEqual([...changes].sort((a, b) => b - a));
  });
});

describe("ratios and bias", () => {
  it("compares total put and call open interest", () => {
    expect(analyze().pcrOi).toBeCloseTo(260 / 260);
  });

  it("calls a put-heavy book with fresh put additions bullish, and says why", () => {
    const putHeavy: RawChain = {
      lastPrice: 100,
      strikes: [
        { strike: 95, call: leg({ ltp: 6, oi: 10 }), put: leg({ ltp: 2, oi: 200, previousOi: 100, previousClose: 3 }) },
        { strike: 100, call: leg({ ltp: 3, oi: 10 }), put: leg({ ltp: 3, oi: 100 }) },
      ],
    };
    const { bias } = analyze(putHeavy);
    expect(bias.label).toBe("Bullish");
    expect(bias.score).toBeGreaterThan(25);
    expect(bias.reasons.join(" ")).toContain("PCR");
  });

  it("calls a call-heavy book bearish", () => {
    const callHeavy: RawChain = { lastPrice: 100, strikes: [{ strike: 100, call: leg({ ltp: 3, oi: 300 }), put: leg({ ltp: 3, oi: 100 }) }] };
    expect(analyze(callHeavy).bias.label).toBe("Bearish");
  });

  it("stays neutral on a balanced book", () => {
    expect(analyze().bias.label).toBe("Neutral");
  });
});

describe("volatility and decay", () => {
  it("reads the skew between the downside and upside wings", () => {
    // Nearest to 97 is the 95 put (IV 18); nearest to 103 is the 105 call (IV 13).
    expect(analyze().ivSkew).toBe(5);
  });

  it("gives the straddle's breakevens and its decay per day", () => {
    const a = analyze();
    expect(a.lowerBreakeven).toBe(94);
    expect(a.upperBreakeven).toBe(106);
    expect(a.straddleThetaPerDay).toBeCloseTo(2.2);
  });

  it("works out a one standard deviation move from ATM IV and time left", () => {
    const a = analyze();
    expect(a.daysToExpiry).toBeCloseTo(1);
    expect(a.oneSigmaMove).toBeCloseTo(100 * 0.15 * Math.sqrt(1 / 365), 4);
  });
});

describe("gamma", () => {
  it("finds where cumulative call-minus-put gamma changes sign", () => {
    const withGamma: RawChain = {
      lastPrice: 100,
      strikes: [
        { strike: 90, call: leg({ ltp: 1, oi: 10, gamma: 0.01 }), put: leg({ ltp: 1, oi: 100, gamma: 0.01 }) },
        { strike: 100, call: leg({ ltp: 1, oi: 50, gamma: 0.01 }), put: leg({ ltp: 1, oi: 50, gamma: 0.01 }) },
        { strike: 110, call: leg({ ltp: 1, oi: 200, gamma: 0.01 }), put: leg({ ltp: 1, oi: 10, gamma: 0.01 }) },
      ],
    };
    const a = analyze(withGamma);
    expect(a.gammaFlip).toBe(110);
    expect(a.netGamma).toBeGreaterThan(0);
  });

  it("has no flip when the sign never changes", () => {
    expect(analyze({ lastPrice: 100, strikes: [{ strike: 100, call: leg({ ltp: 1, oi: 10, gamma: 0.01 }) }] }).gammaFlip).toBeUndefined();
  });
});

describe("daysToExpiry", () => {
  it("counts to the 15:30 IST close on expiry day", () => {
    expect(daysToExpiry("2026-11-17", Date.UTC(2026, 10, 16, 10, 0))).toBeCloseTo(1);
  });

  it("is zero once expired, and unknown for a bad or missing date", () => {
    expect(daysToExpiry("2026-11-17", Date.UTC(2026, 10, 20))).toBe(0);
    expect(daysToExpiry("garbage", NOW)).toBeUndefined();
    expect(daysToExpiry(undefined, NOW)).toBeUndefined();
  });
});

describe("detectSignals", () => {
  const reading = (overrides: Partial<RawChain> = {}) => summarizeChain({ ...chain, ...overrides }, undefined, { expiry: "2026-11-17", now: NOW })!;
  const withCallOi = (oi110: number): RawChain => ({
    ...chain,
    strikes: chain.strikes.map((s) => (s.strike === 105 ? { ...s, call: leg({ ltp: 1, oi: oi110 }) } : s)),
  });

  it("says nothing when nothing changed", () => {
    expect(detectSignals(reading(), reading(), 1)).toEqual([]);
  });

  it("reports a call wall that moved, and that a higher wall leans up", () => {
    // 105 call OI rises above 110's 100, so the biggest resistance moves from 110 to 105.
    const signals = detectSignals(reading(), reading(withCallOi(500)), 7);
    const wall = signals.find((s) => s.text.startsWith("Call wall"))!;
    expect(wall).toMatchObject({ text: "Call wall moved 110 → 105", tone: "bearish", at: 7 });
  });

  it("reports the put-call ratio crossing 1.0", () => {
    const putLight = summarizeChain({ lastPrice: 100, strikes: chain.strikes.map((s) => ({ ...s, put: s.put === undefined ? undefined : { ...s.put, oi: (s.put.oi ?? 0) / 2 } })) }, undefined, { expiry: "2026-11-17", now: NOW })!;
    const cross = detectSignals(putLight, reading(), 1).find((s) => s.text.startsWith("PCR"))!;
    expect(cross).toMatchObject({ tone: "bullish" });
    expect(cross.text).toContain("above 1.0");
  });

  it("reports a straddle that jumped five percent or more", () => {
    const before = reading();
    const richer = summarizeChain({ ...chain, strikes: chain.strikes.map((s) => (s.strike === 100 ? { ...s, call: leg({ ltp: 4, oi: 50 }) } : s)) }, undefined, { expiry: "2026-11-17", now: NOW })!;
    const jump = detectSignals(before, richer, 1).find((s) => s.text.startsWith("ATM straddle"))!;
    expect(jump.text).toContain("+16.7%");
  });
});
