import { describe, expect, it } from "bun:test";
import {
  calculateNqPositionSize,
  checkAbsorption,
  checkExhaustionSweep,
  evaluateGammaRegime,
  isBullishCvdDivergence,
} from "./emka-nq";

describe("Emka.nq Domain Primitives", () => {
  it("evaluates dealer gamma regime correctly", () => {
    expect(evaluateGammaRegime(20500, 20400)).toBe("positive");
    expect(evaluateGammaRegime(20350, 20400)).toBe("negative");
  });

  it("identifies footprint absorption when sellers stall at Put Wall", () => {
    const isAbsorbing = checkAbsorption({
      candleClose: 20010,
      putWall: 20000,
      delta: -2500,
      volume: 5000,
      avgVolume: 2500,
    });
    expect(isAbsorbing).toBe(true);

    const farFromWall = checkAbsorption({
      candleClose: 20200,
      putWall: 20000,
      delta: -2500,
      volume: 5000,
      avgVolume: 2500,
    });
    expect(farFromWall).toBe(false);
  });

  it("detects exhaustion sweep below Put Wall with depleted volume and delta", () => {
    const isExhausted = checkExhaustionSweep({
      candleLow: 19980,
      candleVolume: 1200,
      candleDelta: -350,
      putWall: 20000,
      absorptionVolume: 5000,
    });
    expect(isExhausted).toBe(true);

    // If volume is still heavy, it is a breakdown, not an exhaustion sweep
    const notExhausted = checkExhaustionSweep({
      candleLow: 19980,
      candleVolume: 4500,
      candleDelta: -3500,
      putWall: 20000,
      absorptionVolume: 5000,
    });
    expect(notExhausted).toBe(false);
  });

  it("validates bullish CVD divergence (price lower low, CVD higher low)", () => {
    expect(isBullishCvdDivergence(20000, 19980, -15000, -12000)).toBe(true);
    expect(isBullishCvdDivergence(20000, 19980, -15000, -16000)).toBe(false);
  });

  it("calculates exact NQ position sizing with $20/point risk", () => {
    const sizing = calculateNqPositionSize({
      equity: 20000,
      riskPercent: 1.0,
      entryPrice: 20000,
      stopLossPrice: 19990,
      pointValue: 20,
    });
    expect(sizing.contracts).toBe(1);
    expect(sizing.dollarRisk).toBe(200);
    expect(sizing.stopDistancePoints).toBe(10);
    expect(sizing.valid).toBe(true);
  });

  it("calculates MNQ position sizing with $2/point risk", () => {
    const sizing = calculateNqPositionSize({
      equity: 10000,
      riskPercent: 1.0,
      entryPrice: 20000,
      stopLossPrice: 19980,
      pointValue: 2,
    });
    expect(sizing.contracts).toBe(2);
    expect(sizing.dollarRisk).toBe(100);
    expect(sizing.stopDistancePoints).toBe(20);
    expect(sizing.valid).toBe(true);
  });
});
