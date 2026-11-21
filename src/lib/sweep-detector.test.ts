import { describe, expect, it } from "bun:test";
import { detectSweep, type SweepInput, type SwingLevel } from "./sweep-detector";

describe("sweep-detector", () => {
  const swingLow: SwingLevel = {
    price: 100.0,
    barIndex: 10,
    kind: "low",
  };

  const swingHigh: SwingLevel = {
    price: 110.0,
    barIndex: 15,
    kind: "high",
  };

  it("detects bullish sweep when price pierces below swing low and reclaims", () => {
    const input: SweepInput = {
      currentHigh: 101.5,
      currentLow: 99.2, // pierced by 0.8 (8 ticks at 0.1)
      currentClose: 100.8, // closed above 100.0
      swingLevel: swingLow,
      tickSize: 0.1,
      maxPenetrationTicks: 15,
    };

    const sweep = detectSweep(input);
    expect(sweep).toBeDefined();
    expect(sweep?.type).toBe("bullish_sweep");
    expect(sweep?.swingPrice).toBe(100.0);
    expect(sweep?.breachPrice).toBe(99.2);
    expect(sweep?.penetrationTicks).toBeCloseTo(8);
  });

  it("detects bearish sweep when price pierces above swing high and reclaims", () => {
    const input: SweepInput = {
      currentHigh: 110.6, // pierced by 0.6 (6 ticks at 0.1)
      currentLow: 108.5,
      currentClose: 109.4, // closed below 110.0
      swingLevel: swingHigh,
      tickSize: 0.1,
    };

    const sweep = detectSweep(input);
    expect(sweep).toBeDefined();
    expect(sweep?.type).toBe("bearish_sweep");
    expect(sweep?.swingPrice).toBe(110.0);
    expect(sweep?.breachPrice).toBe(110.6);
    expect(sweep?.penetrationTicks).toBeCloseTo(6);
  });

  it("rejects sweep if bar failed to reclaim level (breakout close)", () => {
    const input: SweepInput = {
      currentHigh: 101.0,
      currentLow: 98.0,
      currentClose: 98.5, // closed BELOW 100.0 (breakout, not a sweep reclaim)
      swingLevel: swingLow,
      tickSize: 0.1,
    };

    expect(detectSweep(input)).toBeUndefined();
  });

  it("rejects sweep if penetration exceeds max allowed ticks (blown through)", () => {
    const input: SweepInput = {
      currentHigh: 101.0,
      currentLow: 95.0, // pierced by 50 ticks!
      currentClose: 100.5,
      swingLevel: swingLow,
      tickSize: 0.1,
      maxPenetrationTicks: 20, // max 20 ticks allowed
    };

    expect(detectSweep(input)).toBeUndefined();
  });

  it("returns undefined if level was never breached", () => {
    const input: SweepInput = {
      currentHigh: 105.0,
      currentLow: 101.0, // never reached 100.0
      currentClose: 103.0,
      swingLevel: swingLow,
      tickSize: 0.1,
    };

    expect(detectSweep(input)).toBeUndefined();
  });
});
