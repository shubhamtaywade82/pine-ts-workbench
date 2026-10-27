import { describe, expect, test } from "bun:test";
import { DEFAULT_CHART_SETTINGS, normalizeChartSettings } from "./chart-settings";

describe("normalizeChartSettings: defaults and migration", () => {
  test("settings saved before the wall options existed load with the defaults", () => {
    const legacy = {
      trading: { showExecutionMarks: false, showExecutionLabels: true, showOrderBookWalls: false },
    };
    const loaded = normalizeChartSettings(legacy);
    expect(loaded.trading).toEqual({
      showExecutionMarks: false,
      showExecutionLabels: true,
      showOrderBookWalls: false,
      depthWallStyle: "shelf",
      wallWindowPct: 0.5,
      minWallNotional: 0,
    });
  });

  test("with no stored settings, the defaults are unchanged: 0.5% window, no minimum", () => {
    expect(normalizeChartSettings(undefined)).toEqual(DEFAULT_CHART_SETTINGS);
    expect(DEFAULT_CHART_SETTINGS.trading).toMatchObject({ wallWindowPct: 0.5, minWallNotional: 0 });
  });

  test("other sections keep their stored values and gain their defaults for new keys", () => {
    const loaded = normalizeChartSettings({ canvas: { background: "#000000" } });
    expect(loaded.canvas.background).toBe("#000000");
    expect(loaded.canvas.gridColor).toBe(DEFAULT_CHART_SETTINGS.canvas.gridColor);
  });

  test("a saved object that is not an object yields the defaults", () => {
    expect(normalizeChartSettings("nonsense")).toEqual(DEFAULT_CHART_SETTINGS);
    expect(normalizeChartSettings(null)).toEqual(DEFAULT_CHART_SETTINGS);
    expect(normalizeChartSettings([1, 2])).toEqual(DEFAULT_CHART_SETTINGS);
  });
});

describe("normalizeChartSettings: validation", () => {
  const trading = (value: Record<string, unknown>) => normalizeChartSettings({ trading: value }).trading;

  test("a window within bounds is kept", () => {
    expect(trading({ wallWindowPct: 1.5 }).wallWindowPct).toBe(1.5);
  });

  test("a window outside bounds is clamped to them", () => {
    expect(trading({ wallWindowPct: 99 }).wallWindowPct).toBe(5);
    expect(trading({ wallWindowPct: -1 }).wallWindowPct).toBe(0.05);
    expect(trading({ wallWindowPct: 0 }).wallWindowPct).toBe(0.05);
  });

  test("non-numeric or non-finite windows fall back to the default", () => {
    expect(trading({ wallWindowPct: "abc" }).wallWindowPct).toBe(0.5);
    expect(trading({ wallWindowPct: Number.NaN }).wallWindowPct).toBe(0.5);
    expect(trading({ wallWindowPct: Number.POSITIVE_INFINITY }).wallWindowPct).toBe(0.5);
    expect(trading({ wallWindowPct: null }).wallWindowPct).toBe(0.5);
  });

  test("the minimum is never negative and never non-numeric", () => {
    expect(trading({ minWallNotional: -5 }).minWallNotional).toBe(0);
    expect(trading({ minWallNotional: 250_000 }).minWallNotional).toBe(250_000);
    expect(trading({ minWallNotional: "1000" }).minWallNotional).toBe(0);
  });

  test("boolean flags with a wrong type fall back to their defaults", () => {
    expect(trading({ showOrderBookWalls: "no" }).showOrderBookWalls).toBe(true);
  });

  test("depthWallStyle keeps valid options and falls back to shelf on invalid", () => {
    expect(trading({ depthWallStyle: "dom" }).depthWallStyle).toBe("dom");
    expect(trading({ depthWallStyle: "bracket" }).depthWallStyle).toBe("bracket");
    expect(trading({ depthWallStyle: "bubbles" }).depthWallStyle).toBe("bubbles");
    expect(trading({ depthWallStyle: "invalid" }).depthWallStyle).toBe("shelf");
  });

  test("a trading section that is not an object yields the defaults", () => {
    expect(normalizeChartSettings({ trading: 42 }).trading).toEqual(DEFAULT_CHART_SETTINGS.trading);
  });

  test("candles section normalizes type and theme with valid values and fallbacks", () => {
    const valid = normalizeChartSettings({ candles: { type: "heikin_ashi", theme: "glass" } }).candles;
    expect(valid.type).toBe("heikin_ashi");
    expect(valid.theme).toBe("glass");

    const water = normalizeChartSettings({ candles: { theme: "water" } }).candles;
    expect(water.theme).toBe("water");

    const custom = normalizeChartSettings({ candles: { theme: "custom" } }).candles;
    expect(custom.theme).toBe("custom");

    const fallback = normalizeChartSettings({ candles: { type: "unknown", theme: "invalid" } }).candles;
    expect(fallback.type).toBe("candles");
    expect(fallback.theme).toBe("tradingview");
  });
});

describe("normalizeChartSettings: persistence round trip", () => {
  test("settings survive JSON storage unchanged", () => {
    const settings = {
      ...DEFAULT_CHART_SETTINGS,
      trading: { ...DEFAULT_CHART_SETTINGS.trading, wallWindowPct: 0.8, minWallNotional: 75_000 },
    };
    const reloaded = normalizeChartSettings(JSON.parse(JSON.stringify(settings)));
    expect(reloaded).toEqual(settings);
  });
});
