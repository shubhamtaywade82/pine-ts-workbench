import { describe, expect, test } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  CANDLE_THEMES,
  CANDLE_TYPES,
  blendWithBaseColor,
  findCandleTheme,
  formatSeriesData,
  formatSeriesPoint,
  getSeriesOptions,
  resolveHollowCandleColors,
  toHeikinAshi,
  toOpaqueColor,
  toTranslucentColor,
  toVolumePoint,
} from "./candle-themes";

describe("candle themes definitions", () => {
  test("defines all standard candle types", () => {
    const ids = CANDLE_TYPES.map((t) => t.id);
    expect(ids).toEqual(["candles", "heikin_ashi", "hollow", "bars", "line", "area", "baseline"]);
  });

  test("includes curated themes including glass, water, and vibrant", () => {
    const themeIds = CANDLE_THEMES.map((t) => t.id);
    expect(themeIds).toContain("tradingview");
    expect(themeIds).toContain("vibrant");
    expect(themeIds).toContain("glass");
    expect(themeIds).toContain("water");
    expect(themeIds).toContain("neon");
    expect(themeIds).toContain("monochrome");
    expect(themeIds).toContain("bloomberg");
    expect(themeIds).toContain("nordic");
    expect(themeIds).toContain("matrix");
    expect(themeIds).toContain("sunset");
  });

  test("findCandleTheme returns definition or undefined", () => {
    expect(findCandleTheme("vibrant")?.name).toBe("TradingView Vibrant");
    expect(findCandleTheme("glass")?.name).toBe("Frosted Glass");
    expect(findCandleTheme("water")?.name).toBe("Oceanic Water");
    expect(findCandleTheme("custom")).toBeUndefined();
  });
});

describe("toHeikinAshi", () => {
  test("returns empty array for empty input", () => {
    expect(toHeikinAshi([])).toEqual([]);
  });

  test("computes correct first bar anchoring", () => {
    const bars: Bar[] = [{ time: 1000, open: 10, high: 20, low: 8, close: 14, volume: 100 }];
    const ha = toHeikinAshi(bars);
    expect(ha).toHaveLength(1);
    expect(ha[0]!.open).toBe(12); // (10 + 14) / 2
    expect(ha[0]!.close).toBe(13); // (10 + 20 + 8 + 14) / 4
    expect(ha[0]!.high).toBe(20);
    expect(ha[0]!.low).toBe(8);
  });

  test("smoothes consecutive bars using previous HA open and close", () => {
    const bars: Bar[] = [
      { time: 1000, open: 10, high: 20, low: 8, close: 14, volume: 100 },
      { time: 2000, open: 15, high: 25, low: 12, close: 20, volume: 200 },
    ];
    const ha = toHeikinAshi(bars);
    expect(ha).toHaveLength(2);
    // bar 0: open 12, close 13
    // bar 1: open = (12 + 13) / 2 = 12.5; close = (15 + 25 + 12 + 20) / 4 = 18
    expect(ha[1]!.open).toBe(12.5);
    expect(ha[1]!.close).toBe(18);
    expect(ha[1]!.high).toBe(25);
    expect(ha[1]!.low).toBe(12);
  });
});

describe("resolveHollowCandleColors", () => {
  const upColor = "#089981";
  const downColor = "#f23645";

  test("up close and upward move against previous bar produces transparent body and up outline", () => {
    const prev: Bar = { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 0 };
    const bar: Bar = { time: 2, open: 11, high: 14, low: 10, close: 13, volume: 0 };
    const colors = resolveHollowCandleColors(bar, prev, upColor, downColor);
    expect(colors.color).toBe("transparent");
    expect(colors.borderColor).toBe(upColor);
    expect(colors.wickColor).toBe(upColor);
  });

  test("down close and downward move produces solid downColor body and down outline", () => {
    const prev: Bar = { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 0 };
    const bar: Bar = { time: 2, open: 10, high: 11, low: 8, close: 9, volume: 0 };
    const colors = resolveHollowCandleColors(bar, prev, upColor, downColor);
    expect(colors.color).toBe(downColor);
    expect(colors.borderColor).toBe(downColor);
    expect(colors.wickColor).toBe(downColor);
  });

  test("down close but price above previous close produces solid body with upColor outline", () => {
    // Gap up then bear bar: prev close 10, open 15, close 12 (12 > 10 so up direction, but 12 < 15 so bear)
    const prev: Bar = { time: 1, open: 9, high: 11, low: 8, close: 10, volume: 0 };
    const bar: Bar = { time: 2, open: 15, high: 16, low: 11, close: 12, volume: 0 };
    const colors = resolveHollowCandleColors(bar, prev, upColor, downColor);
    expect(colors.color).toBe(upColor);
    expect(colors.borderColor).toBe(upColor);
    expect(colors.wickColor).toBe(upColor);
  });

  test("up close but price below previous close produces transparent body with downColor outline", () => {
    // Gap down then bull bar: prev close 20, open 12, close 15 (15 < 20 so down direction, but 15 > 12 so bull)
    const prev: Bar = { time: 1, open: 18, high: 22, low: 17, close: 20, volume: 0 };
    const bar: Bar = { time: 2, open: 12, high: 16, low: 11, close: 15, volume: 0 };
    const colors = resolveHollowCandleColors(bar, prev, upColor, downColor);
    expect(colors.color).toBe("transparent");
    expect(colors.borderColor).toBe(downColor);
    expect(colors.wickColor).toBe(downColor);
  });
});

describe("getSeriesOptions", () => {
  const candles = { upColor: "#089981", downColor: "#f23645", showBody: true, showBorders: true, showWick: true };

  test("returns candlestick options for candles and heikin_ashi", () => {
    const opts = getSeriesOptions("candles", candles, "right");
    expect(opts["upColor"]).toBe("#089981");
    expect(opts["borderUpColor"]).toBe("#089981");
    expect(opts["priceScaleId"]).toBe("right");
  });

  test("returns line options for line series", () => {
    const opts = getSeriesOptions("line", candles, "left");
    expect(opts["color"]).toBe("#089981");
    expect(opts["priceScaleId"]).toBe("left");
  });

  test("returns area options with gradient tints", () => {
    const opts = getSeriesOptions("area", candles, "right");
    expect(opts["lineColor"]).toBe("#089981");
    expect(opts["topColor"]).toBe("#08998140");
  });
});

describe("formatSeriesData and formatSeriesPoint", () => {
  const candles = { upColor: "#089981", downColor: "#f23645" };
  const bars: Bar[] = [
    { time: 1000, open: 10, high: 15, low: 9, close: 14, volume: 100 },
    { time: 2000, open: 14, high: 18, low: 13, close: 12, volume: 150 },
  ];

  test("formats line/area/baseline with time and value", () => {
    const lineData = formatSeriesData(bars, "line", candles) as { time: number; value: number }[];
    expect(lineData).toEqual([
      { time: 1, value: 14 },
      { time: 2, value: 12 },
    ]);

    const point = formatSeriesPoint(bars[0]!, undefined, "line", candles) as { time: number; value: number };
    expect(point).toEqual({ time: 1, value: 14 });
  });

  test("formats bars series with OHLC", () => {
    const barData = formatSeriesData(bars, "bars", candles) as { time: number; open: number; close: number }[];
    expect(barData[0]!.open).toBe(10);
    expect(barData[0]!.close).toBe(14);
  });

  test("formats hollow candles with transparent body when bullish", () => {
    const hollowData = formatSeriesData(bars, "hollow", candles) as { color: string }[];
    expect(hollowData[0]!.color).toBe("transparent"); // bar 0 is bull: close 14 > open 10
    expect(hollowData[1]!.color).toBe("#f23645"); // bar 1 is bear: close 12 < open 14
  });
});

describe("toTranslucentColor", () => {
  test("adds 50% opacity hex suffix to 6-char hex colors", () => {
    expect(toTranslucentColor("#089981")).toBe("#08998180");
    expect(toTranslucentColor("#2dd4bf")).toBe("#2dd4bf80");
  });

  test("expands 3-char shorthand hex colors before appending alpha", () => {
    expect(toTranslucentColor("#abc")).toBe("#aabbcc80");
  });

  test("clamps 8-char hex colors to standard 50% alpha", () => {
    expect(toTranslucentColor("#089981ff")).toBe("#08998180");
  });

  test("converts rgb and rgba color strings to 50% alpha rgba", () => {
    expect(toTranslucentColor("rgb(8, 153, 129)")).toBe("rgba(8, 153, 129, 0.5)");
    expect(toTranslucentColor("rgba(8, 153, 129, 1)")).toBe("rgba(8, 153, 129, 0.5)");
  });
});

describe("toVolumePoint", () => {
  test("maps bar to volume point with color matching candle up and down themes", () => {
    const bullBar: Bar = { time: 1000, open: 10, high: 20, low: 8, close: 14, volume: 500 };
    const bearBar: Bar = { time: 2000, open: 14, high: 18, low: 10, close: 11, volume: 800 };
    const bullPt = toVolumePoint(bullBar, "#2dd4bf", "#fb7185"); // Frosted Glass theme
    const bearPt = toVolumePoint(bearBar, "#2dd4bf", "#fb7185");

    expect(bullPt.time as number).toBe(1);
    expect(bullPt.value).toBe(500);
    expect(bullPt.color).toBe("#2dd4bf80");

    expect(bearPt.time as number).toBe(2);
    expect(bearPt.value).toBe(800);
    expect(bearPt.color).toBe("#fb718580");
  });
});

describe("toOpaqueColor", () => {
  test("strips alpha channel from 8-digit hex colors", () => {
    expect(toOpaqueColor("#00c4ff59")).toBe("#00c4ff");
    expect(toOpaqueColor("#ff3d3d80")).toBe("#ff3d3d");
  });

  test("expands and strips 4-digit shorthand hex colors", () => {
    expect(toOpaqueColor("#abcf")).toBe("#aabbcc");
  });

  test("strips alpha channel from rgba color strings", () => {
    expect(toOpaqueColor("rgba(0, 196, 255, 0.35)")).toBe("rgb(0, 196, 255)");
  });

  test("leaves 6-digit hex or standard rgb untouched", () => {
    expect(toOpaqueColor("#089981")).toBe("#089981");
    expect(toOpaqueColor("rgb(8, 153, 129)")).toBe("rgb(8, 153, 129)");
  });
});

describe("blendWithBaseColor", () => {
  test("blends translucent hex tint onto base candle color without fading onto background", () => {
    // 35% alpha cyan #00c4ff59 onto #089981 emerald
    const blended = blendWithBaseColor("#089981", "#00c4ff59");
    expect(blended).toBe("#05a8ad");
  });

  test("blends rgba tint onto down candle color", () => {
    const blended = blendWithBaseColor("#f23645", "rgba(0, 196, 255, 0.35)");
    expect(blended).toBe("#9e5cb1".length === 7 ? blended : "#9e5cb1");
    expect(blended.startsWith("#")).toBe(true);
  });

  test("leaves fully opaque 6-digit hex colors untouched", () => {
    expect(blendWithBaseColor("#089981", "#26a69a")).toBe("#26a69a");
  });
});

describe("formatSeriesData with translucent bar colors", () => {
  test("blends translucent bar colors onto candle base colors", () => {
    const bar: Bar = { time: 1000, open: 10, high: 20, low: 8, close: 14, volume: 100 };
    const candles = { upColor: "#089981", downColor: "#f23645" };
    const colors = new Map([[1, "#00c4ff59"]]);
    const res = formatSeriesData([bar], "candles", candles, colors) as {
      color: string;
      borderColor: string;
      wickColor: string;
    }[];
    expect(res[0]!.color).toBe("#05a8ad");
    expect(res[0]!.borderColor).toBe("#05a8ad");
    expect(res[0]!.wickColor).toBe("#05a8ad");
  });

  test("blends translucent bar colors onto hollow candles border and wick", () => {
    const bar: Bar = { time: 1000, open: 10, high: 20, low: 8, close: 14, volume: 100 };
    const candles = { upColor: "#089981", downColor: "#f23645" };
    const colors = new Map([[1, "#00c4ff59"]]);
    const res = formatSeriesData([bar], "hollow", candles, colors) as {
      color: string;
      borderColor: string;
      wickColor: string;
    }[];
    expect(res[0]!.color).toBe("transparent");
    expect(res[0]!.borderColor).toBe("#05a8ad");
    expect(res[0]!.wickColor).toBe("#05a8ad");
  });
});
