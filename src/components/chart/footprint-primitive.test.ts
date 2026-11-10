import { describe, expect, test } from "bun:test";
import { deltaCellPaint, footprintCellText, formatCompact, showsFootprint } from "./footprint-primitive";
import type { FootprintCell } from "@/lib/footprint";

describe("footprint cell paint", () => {
  test("colors a positive delta green and scales intensity by the visible maximum", () => {
    expect(deltaCellPaint(4, 8)).toEqual({ rgb: "8, 153, 129", intensity: 0.5 });
  });

  test("colors a negative delta red", () => {
    expect(deltaCellPaint(-2, 4)).toEqual({ rgb: "242, 54, 69", intensity: 0.5 });
  });

  test("clips intensity at 1 and yields 0 when there is no scale", () => {
    expect(deltaCellPaint(10, 4).intensity).toBe(1);
    expect(deltaCellPaint(3, 0).intensity).toBe(0);
    expect(deltaCellPaint(0, 5).intensity).toBe(0);
  });

  test("draws only when a bar is at least 40 pixels wide", () => {
    expect(showsFootprint(39.9)).toBe(false);
    expect(showsFootprint(40)).toBe(true);
  });
});

const cell = (partial: Partial<FootprintCell>): FootprintCell => ({
  priceFrom: 100,
  priceTo: 101,
  buy: 0,
  sell: 0,
  delta: 0,
  total: 0,
  count: 1,
  ...partial,
});

describe("formatCompact", () => {
  test("uses a k or M suffix and at most three significant digits", () => {
    expect(formatCompact(340)).toBe("340");
    expect(formatCompact(1200)).toBe("1.2k");
    expect(formatCompact(1234)).toBe("1.23k");
    expect(formatCompact(1_500_000)).toBe("1.5M");
    expect(formatCompact(-340)).toBe("-340");
    expect(formatCompact(0)).toBe("0");
  });

  test("drops binary float noise", () => {
    expect(formatCompact(1.1000000000000003)).toBe("1.1");
    expect(formatCompact(0.1 + 0.2)).toBe("0.3");
  });
});

describe("footprintCellText", () => {
  test("shows the signed delta in delta mode", () => {
    expect(footprintCellText(cell({ delta: 1200 }), "delta")).toBe("+1.2k");
    expect(footprintCellText(cell({ delta: -340 }), "delta")).toBe("-340");
    expect(footprintCellText(cell({ delta: 0 }), "delta")).toBe("0");
  });

  test("formats bid, ask, and total the same way", () => {
    expect(footprintCellText(cell({ sell: 1500, buy: 1.1000000000000003 }), "bid-ask")).toBe("1.5k×1.1");
    expect(footprintCellText(cell({ total: 2_000_000 }), "total")).toBe("2M");
  });
});
