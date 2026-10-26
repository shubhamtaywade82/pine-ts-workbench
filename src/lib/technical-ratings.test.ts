import { describe, expect, test } from "bun:test";
import {
  averageAction, rateAdx, rateAwesome, rateBullBear, rateCci, rateIchimoku, rateMacd, rateMomentum,
  rateMovingAverage, rateRsi, rateStochastic, rateStochRsi, rateUltimate, rateWilliams, toRating,
} from "./technical-ratings";

describe("technical rating rules", () => {
  test("should buy an oversold rising RSI and sell an overbought falling one", () => {
    expect(rateRsi({ now: 28, prev: 25 })).toBe(1);
    expect(rateRsi({ now: 28, prev: 29 })).toBe(0);
    expect(rateRsi({ now: 75, prev: 80 })).toBe(-1);
    expect(rateRsi({ now: Number.NaN, prev: 20 })).toBe(0);
  });

  test("should need both stochastic lines in the zone with K across D", () => {
    expect(rateStochastic(15, 10)).toBe(1);
    expect(rateStochastic(15, 25)).toBe(0);
    expect(rateStochastic(85, 90)).toBe(-1);
  });

  test("should rate CCI, Williams %R and momentum by zone and direction", () => {
    expect(rateCci({ now: -120, prev: -150 })).toBe(1);
    expect(rateCci({ now: 120, prev: 150 })).toBe(-1);
    expect(rateWilliams({ now: -85, prev: -90 })).toBe(1);
    expect(rateWilliams({ now: -15, prev: -10 })).toBe(-1);
    expect(rateMomentum({ now: 2, prev: 1 })).toBe(1);
    expect(rateMomentum({ now: 1, prev: 1 })).toBe(0);
  });

  test("should require ADX above 20 and moving with the dominant DI", () => {
    expect(rateAdx({ now: 25, prev: 22 }, 30, 20)).toBe(1);
    expect(rateAdx({ now: 18, prev: 15 }, 30, 20)).toBe(0);
    expect(rateAdx({ now: 25, prev: 28 }, 15, 20)).toBe(-1);
  });

  test("should buy an AO zero cross or a saucer above zero", () => {
    expect(rateAwesome(0.5, -0.2, -0.5)).toBe(1);
    expect(rateAwesome(1.2, 1, 1.5)).toBe(1);
    expect(rateAwesome(-0.5, 0.2, 0.5)).toBe(-1);
    expect(rateAwesome(2, 1.5, 1)).toBe(0);
  });

  test("should rate trend-dependent oscillators only with the trend", () => {
    expect(rateStochRsi(15, 10, false)).toBe(1);
    expect(rateStochRsi(15, 10, true)).toBe(0);
    expect(rateBullBear({ now: -1, prev: -2 }, { now: 1, prev: 2 }, true)).toBe(1);
    expect(rateBullBear({ now: -1, prev: -2 }, { now: 1, prev: 2 }, false)).toBe(-1);
  });

  test("should rate MACD, UO, moving averages and Ichimoku", () => {
    expect(rateMacd(1, 0.5)).toBe(1);
    expect(rateUltimate(75)).toBe(1);
    expect(rateUltimate(25)).toBe(-1);
    expect(rateMovingAverage(99, 100)).toBe(1);
    expect(rateMovingAverage(101, 100)).toBe(-1);
    expect(rateIchimoku({ conversion: 105, base: 103, leadA: 102, leadB: 100 }, 106)).toBe(1);
    expect(rateIchimoku({ conversion: 105, base: 103, leadA: 102, leadB: 100 }, 104)).toBe(0);
  });

  test("should map average scores to the documented bands", () => {
    expect(toRating(averageAction([1, 1, 1, 0]))).toBe("Strong Buy");
    expect(toRating(0.5)).toBe("Buy");
    expect(toRating(0.1)).toBe("Neutral");
    expect(toRating(-0.1)).toBe("Neutral");
    expect(toRating(-0.11)).toBe("Sell");
    expect(toRating(-0.51)).toBe("Strong Sell");
  });
});
