import { describe, expect, test } from "bun:test";
import {
  computeCoverage,
  dotColorClass,
  formatAge,
  formatCoverage,
} from "./depth-diagnostics";
import type { BookView } from "@/lib/depth-walls";

describe("formatAge", () => {
  test("formats missing or non-numeric timestamps as dash", () => {
    expect(formatAge(undefined)).toBe("—");
    expect(formatAge(Number.NaN)).toBe("—");
  });

  test("formats sub-second durations as <1s", () => {
    expect(formatAge(0)).toBe("<1s");
    expect(formatAge(500)).toBe("<1s");
    expect(formatAge(999)).toBe("<1s");
  });

  test("formats seconds under one minute", () => {
    expect(formatAge(1_000)).toBe("1s");
    expect(formatAge(15_000)).toBe("15s");
    expect(formatAge(59_000)).toBe("59s");
  });

  test("formats minutes and remainder seconds", () => {
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(125_000)).toBe("2m 5s");
  });

  test("formats hours and remainder minutes", () => {
    expect(formatAge(3_600_000)).toBe("1h 0m");
    expect(formatAge(3_900_000)).toBe("1h 5m");
  });
});

describe("computeCoverage and formatCoverage", () => {
  test("returns dash when book or coverage is undefined", () => {
    expect(computeCoverage(undefined)).toBeUndefined();
    expect(formatCoverage(undefined)).toBe("—");
  });

  test("returns dash when best bid or ask is missing", () => {
    const book: BookView = {
      bestBid: undefined,
      bestAsk: 101,
      coverage: { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY },
      levels: () => [],
    };
    expect(computeCoverage(book)).toBeUndefined();
    expect(formatCoverage(book)).toBe("—");
  });

  test("returns full when askCeiling is infinite", () => {
    const coverage = { bidFloor: 0, askCeiling: Number.POSITIVE_INFINITY };
    const res = computeCoverage(coverage, 100);
    expect(res?.isFull).toBe(true);
    expect(formatCoverage(coverage, 100)).toBe("full");
  });

  test("calculates symmetrical finite coverage percentages", () => {
    const coverage = { bidFloor: 99, askCeiling: 101 };
    const res = computeCoverage(coverage, 100);
    expect(res).toEqual({ bidPct: 1, askPct: 1, isFull: false });
    expect(formatCoverage(coverage, 100)).toBe("-1% / +1%");
  });

  test("calculates asymmetrical finite coverage on a BookView", () => {
    const book: BookView = {
      bestBid: 99,
      bestAsk: 101, // mid = 100
      coverage: { bidFloor: 98.5, askCeiling: 100.5 },
      levels: () => [],
    };
    const res = computeCoverage(book);
    expect(res?.bidPct).toBeCloseTo(1.5, 4);
    expect(res?.askPct).toBeCloseTo(0.5, 4);
    expect(formatCoverage(book)).toBe("-1.5% / +0.5%");
  });
});

describe("dotColorClass", () => {
  test("returns green for live status", () => {
    expect(dotColorClass("live")).toBe("bg-[#089981]");
  });

  test("returns amber for syncing and stale", () => {
    expect(dotColorClass("syncing")).toBe("bg-[#ff9800]");
    expect(dotColorClass("stale")).toBe("bg-[#ff9800]");
  });

  test("returns red for disconnected or missing status", () => {
    expect(dotColorClass("disconnected")).toBe("bg-[#f23645]");
    expect(dotColorClass(undefined)).toBe("bg-[#f23645]");
  });
});
