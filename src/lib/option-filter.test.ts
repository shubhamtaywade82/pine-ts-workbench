import { describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import type { Bias, ChainAnalytics } from "./option-analytics";
import { hudReason, longOptionFilter, trendOf, vixReading, type Trend, type VixReading } from "./option-filter";
import { summarizeChain, type ChainSummary } from "./option-chain";

const leg = (ltp: number, oi: number) => ({ last_price: ltp, oi });
const base = summarizeChain({ lastPrice: 100, strikes: [{ strike: 100, call: leg(3, 10), put: leg(3, 10) }] }, undefined, { expiry: "2026-11-27", now: Date.UTC(2026, 10, 13) })!;

const biasOf = (score: number): Bias => ({ score, label: score >= 25 ? "Bullish" : score <= -25 ? "Bearish" : "Neutral", reasons: [] });
const summaryWith = (over: Partial<ChainAnalytics> = {}, top: Partial<ChainSummary> = {}): ChainSummary =>
  ({ ...base, ...top, analytics: { ...base.analytics, daysToExpiry: 10, resistances: [], supports: [], gammaFlip: undefined, ...over } });

const up: Trend = { direction: "up", closeVsAveragePct: 0.5 };
const down: Trend = { direction: "down", closeVsAveragePct: -0.5 };
const vixAt = (percentile: number): VixReading => ({ level: 14, previousClose: 13.5, changePct: 3.7, percentile });

describe("longOptionFilter", () => {
  it("names calls when positioning and trend both lean up", () => {
    const result = longOptionFilter({ summary: summaryWith({ bias: biasOf(45) }), trend: up, vix: vixAt(50) });
    expect(result).toMatchObject({ side: "CE", label: "CALLS only", points: 3 });
    expect(result.blockers).toEqual([]);
  });

  it("names puts when both lean down", () => {
    expect(longOptionFilter({ summary: summaryWith({ bias: biasOf(-45) }), trend: down, vix: vixAt(50) })).toMatchObject({ side: "PE", label: "PUTS only", points: -3 });
  });

  it("names no side when positioning and trend disagree", () => {
    const result = longOptionFilter({ summary: summaryWith({ bias: biasOf(30) }), trend: down, vix: vixAt(50) });
    expect(result).toMatchObject({ side: "NONE", label: "No long options", points: 1 });
    expect(result.blockers.join(" ")).toContain("No clear direction");
  });

  it("refuses to buy when premiums are rich, even with a clear direction", () => {
    const result = longOptionFilter({ summary: summaryWith({ bias: biasOf(45) }), trend: up, vix: vixAt(90) });
    expect(result.side).toBe("NONE");
    expect(result.blockers.join(" ")).toContain("Premiums are rich");
  });

  it("notes cheap premiums as context without changing the side", () => {
    const result = longOptionFilter({ summary: summaryWith({ bias: biasOf(45) }), trend: up, vix: vixAt(10) });
    expect(result.side).toBe("CE");
    expect(result.factors.map((f) => f.text).join(" ")).toContain("premiums are cheap");
  });

  it("refuses to buy into expiry-day decay", () => {
    const result = longOptionFilter({ summary: summaryWith({ bias: biasOf(45), daysToExpiry: 0.5, straddleThetaPerDay: 40 }, { straddle: 100 }), trend: up, vix: undefined });
    expect(result.side).toBe("NONE");
    expect(result.blockers.join(" ")).toContain("Expiry decay");
  });

  it("refuses calls just under a call wall, and puts just over a put wall", () => {
    const wall = { strike: 100.2, oi: 1, oiChange: 0, distancePct: 0.2 };
    const calls = longOptionFilter({ summary: summaryWith({ bias: biasOf(45), resistances: [wall] }), trend: up, vix: undefined });
    const puts = longOptionFilter({ summary: summaryWith({ bias: biasOf(-45), supports: [{ ...wall, strike: 99.8, distancePct: -0.2 }] }), trend: down, vix: undefined });
    expect(calls.blockers.join(" ")).toContain("call wall at 100.2");
    expect(puts.blockers.join(" ")).toContain("put wall at 99.8");
    expect([calls.side, puts.side]).toEqual(["NONE", "NONE"]);
  });

  it("does not let a distant wall block a trade", () => {
    const far = { strike: 105, oi: 1, oiChange: 0, distancePct: 5 };
    expect(longOptionFilter({ summary: summaryWith({ bias: biasOf(45), resistances: [far] }), trend: up, vix: undefined }).side).toBe("CE");
  });

  it("works without a trend or VIX, from the chain alone", () => {
    expect(longOptionFilter({ summary: summaryWith({ bias: biasOf(45) }), trend: undefined, vix: undefined })).toMatchObject({ side: "CE", points: 2 });
  });

  it("lists every factor it used", () => {
    const result = longOptionFilter({ summary: summaryWith({ bias: biasOf(45), gammaFlip: 105 }), trend: up, vix: vixAt(50) });
    expect(result.factors).toHaveLength(4);
  });
});

describe("vixReading", () => {
  const closes = (values: number[]): Bar[] => values.map((close, i) => ({ time: i * 86_400_000, open: close, high: close, low: close, close, volume: 0, isClosed: true }));

  it("reads the level, the day's change, and how it ranks against the year", () => {
    const reading = vixReading(closes([10, 12, 14, 16, 18, 15]))!;
    expect(reading.level).toBe(15);
    expect(reading.previousClose).toBe(18);
    expect(reading.changePct).toBeCloseTo(-16.67, 1);
    expect(reading.percentile).toBe(60); // 3 of the 5 earlier closes are at or below 15
  });

  it("is undefined without two closes", () => {
    expect(vixReading(closes([12]))).toBeUndefined();
    expect(vixReading([])).toBeUndefined();
  });
});

describe("trendOf", () => {
  const series = (closes: number[]): Bar[] => closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 1, isClosed: true }));
  const ramp = (from: number, step: number, count = 30): number[] => Array.from({ length: count }, (_, i) => from + i * step);

  it("sees a steady climb as up and a steady fall as down", () => {
    expect(trendOf(series(ramp(100, 1)))!.direction).toBe("up");
    expect(trendOf(series(ramp(130, -1)))!.direction).toBe("down");
  });

  it("sees a flat market as flat", () => {
    expect(trendOf(series(Array(30).fill(100)))!.direction).toBe("flat");
  });

  it("needs enough bars to say anything", () => {
    expect(trendOf(series(ramp(100, 1, 10)))).toBeUndefined();
  });
});

describe("hudReason", () => {
  it("leads with the first blocker when nothing should be bought", () => {
    const filter = longOptionFilter({ summary: summaryWith({ bias: biasOf(45) }), trend: up, vix: vixAt(90) });
    expect(hudReason(filter)).toContain("Premiums are rich");
  });

  it("gives the strongest supporting factor for a named side", () => {
    const filter = longOptionFilter({ summary: summaryWith({ bias: biasOf(45) }), trend: up, vix: vixAt(50) });
    expect(hudReason(filter)).toContain("Chain positioning bullish");
  });

  it("gives a put-leaning factor for puts", () => {
    const filter = longOptionFilter({ summary: summaryWith({ bias: biasOf(-45) }), trend: down, vix: vixAt(50) });
    expect(hudReason(filter)).toContain("bearish");
  });
});
