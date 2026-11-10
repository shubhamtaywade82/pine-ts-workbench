import { describe, expect, test } from "bun:test";
import { DEFAULT_CHART_SETTINGS, normalizeChartSettings, rightOffsetPx, toCandleOptions } from "./chart-settings";

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
      showBidAskLines: true,
      depthWallStyle: "shelf",
      wallLabel: "compact",
      wallWindowPct: 0.5,
      minWallNotional: 0,
      dom: { enabled: false, bucketTicks: 10, visibleBuckets: 40, flowAnimation: true },
      heatmap: { enabled: false, opacity: 0.5, minutes: 10 },
      wallTopN: 5,
      footprint: { enabled: false, mode: "delta", bucketTicks: 10 },
      outcomes: { enabled: false },
    });
  });

  test("with no stored settings, the defaults are unchanged: 0.5% window, no minimum", () => {
    expect(normalizeChartSettings(undefined)).toEqual(DEFAULT_CHART_SETTINGS);
    expect(DEFAULT_CHART_SETTINGS.trading).toMatchObject({ wallWindowPct: 0.5, minWallNotional: 0, outcomes: { enabled: false } });
  });

  test("validates trading.outcomes toggle and defaults to false", () => {
    const enabled = normalizeChartSettings({ trading: { outcomes: { enabled: true } } });
    expect(enabled.trading.outcomes.enabled).toBe(true);
    const disabled = normalizeChartSettings({ trading: { outcomes: { enabled: false } } });
    expect(disabled.trading.outcomes.enabled).toBe(false);
    const fallback = normalizeChartSettings({ trading: { outcomes: { enabled: "invalid" } } });
    expect(fallback.trading.outcomes.enabled).toBe(false);
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

  test("dom ladder defaults are off, with 10-tick buckets and 40 visible rows", () => {
    expect(DEFAULT_CHART_SETTINGS.trading.dom).toEqual({ enabled: false, bucketTicks: 10, visibleBuckets: 40, flowAnimation: true });
    expect(trading({}).dom).toEqual(DEFAULT_CHART_SETTINGS.trading.dom);
  });

  test("dom integers are clamped and non-integers fall back", () => {
    expect(trading({ dom: { enabled: true, bucketTicks: 25, visibleBuckets: 80 } }).dom)
      .toEqual({ enabled: true, bucketTicks: 25, visibleBuckets: 80, flowAnimation: true });
    expect(trading({ dom: { bucketTicks: 0, visibleBuckets: 1_000 } }).dom)
      .toEqual({ enabled: false, bucketTicks: 1, visibleBuckets: 200, flowAnimation: true });
    expect(trading({ dom: { bucketTicks: 10.5, visibleBuckets: 40.2, enabled: "yes" } }).dom)
      .toEqual(DEFAULT_CHART_SETTINGS.trading.dom);
  });

  test("dom flowAnimation validates booleans and falls back to true", () => {
    expect(trading({ dom: { flowAnimation: false } }).dom.flowAnimation).toBe(false);
    expect(trading({ dom: { flowAnimation: true } }).dom.flowAnimation).toBe(true);
    expect(trading({ dom: { flowAnimation: "invalid" } }).dom.flowAnimation).toBe(true);
    expect(trading({ dom: { flowAnimation: null } }).dom.flowAnimation).toBe(true);
  });

  test("footprint defaults to off, delta mode, and 10-tick buckets", () => {
    expect(DEFAULT_CHART_SETTINGS.trading.footprint).toEqual({ enabled: false, mode: "delta", bucketTicks: 10 });
    expect(trading({}).footprint).toEqual(DEFAULT_CHART_SETTINGS.trading.footprint);
    expect(trading({ footprint: { enabled: true, mode: "bid-ask", bucketTicks: 25 } }).footprint)
      .toEqual({ enabled: true, mode: "bid-ask", bucketTicks: 25 });
    expect(trading({ footprint: { enabled: true, mode: "total", bucketTicks: 10_000 } }).footprint.mode).toBe("total");
    expect(trading({ footprint: { mode: "diagonal", bucketTicks: 10.5, enabled: "yes" } }).footprint)
      .toEqual(DEFAULT_CHART_SETTINGS.trading.footprint);
    expect(trading({ footprint: { bucketTicks: 0 } }).footprint.bucketTicks).toBe(1);
    expect(trading({ footprint: { bucketTicks: 20_000 } }).footprint.bucketTicks).toBe(10_000);
  });

  test("heatmap and wallTopN fall back or clamp", () => {
    expect(DEFAULT_CHART_SETTINGS.trading.heatmap).toEqual({ enabled: false, opacity: 0.5, minutes: 10 });
    expect(DEFAULT_CHART_SETTINGS.trading.wallTopN).toBe(5);
    expect(trading({ heatmap: { enabled: true, opacity: 0.2, minutes: 15 }, wallTopN: 8 }).heatmap)
      .toEqual({ enabled: true, opacity: 0.2, minutes: 15 });
    expect(trading({ wallTopN: 8 }).wallTopN).toBe(8);
    expect(trading({ heatmap: { opacity: 2, minutes: 0 }, wallTopN: 50 }).heatmap.opacity).toBe(1);
    expect(trading({ heatmap: { opacity: 2, minutes: 0 }, wallTopN: 50 }).heatmap.minutes).toBe(1);
    expect(trading({ heatmap: { opacity: 0.01, minutes: 10.5 } }).heatmap)
      .toEqual({ enabled: false, opacity: 0.05, minutes: 10 });
    expect(trading({ heatmap: { opacity: "no", minutes: "x" } }).heatmap)
      .toEqual(DEFAULT_CHART_SETTINGS.trading.heatmap);
    expect(trading({ wallTopN: 3.2 }).wallTopN).toBe(5);
    expect(trading({ wallTopN: 0 }).wallTopN).toBe(1);
  });

  test("boolean flags with a wrong type fall back to their defaults", () => {
    expect(trading({ showOrderBookWalls: "no" }).showOrderBookWalls).toBe(true);
    expect(trading({ showBidAskLines: false }).showBidAskLines).toBe(false);
    expect(trading({ showBidAskLines: "invalid" }).showBidAskLines).toBe(true);
  });

  test("depthWallStyle keeps valid options and falls back to shelf on invalid", () => {
    expect(trading({ depthWallStyle: "dom" }).depthWallStyle).toBe("dom");
    expect(trading({ depthWallStyle: "bracket" }).depthWallStyle).toBe("bracket");
    expect(trading({ depthWallStyle: "bubbles" }).depthWallStyle).toBe("bubbles");
    expect(trading({ depthWallStyle: "invalid" }).depthWallStyle).toBe("shelf");
  });

  test("wallLabel keeps valid options and falls back to compact on invalid", () => {
    expect(trading({ wallLabel: "detailed" }).wallLabel).toBe("detailed");
    expect(trading({ wallLabel: "compact" }).wallLabel).toBe("compact");
    expect(trading({ wallLabel: "invalid" }).wallLabel).toBe("compact");
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

  test("candles section normalizes independent body, border, and wick colors with fallbacks", () => {
    const legacy = normalizeChartSettings({ candles: { upColor: "#111111", downColor: "#222222" } }).candles;
    expect(legacy.borderUpColor).toBe("#111111");
    expect(legacy.borderDownColor).toBe("#222222");
    expect(legacy.wickUpColor).toBe("#111111");
    expect(legacy.wickDownColor).toBe("#222222");

    const custom = normalizeChartSettings({
      candles: {
        upColor: "#111111", downColor: "#222222",
        borderUpColor: "#333333", borderDownColor: "#444444",
        wickUpColor: "#555555", wickDownColor: "#666666",
      },
    }).candles;
    expect(custom.borderUpColor).toBe("#333333");
    expect(custom.borderDownColor).toBe("#444444");
    expect(custom.wickUpColor).toBe("#555555");
    expect(custom.wickDownColor).toBe("#666666");
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

describe("toCandleOptions", () => {
  test("maps independent body, border, wick colors and visibility", () => {
    const settings = {
      ...DEFAULT_CHART_SETTINGS,
      candles: {
        ...DEFAULT_CHART_SETTINGS.candles,
        upColor: "#111111", downColor: "#222222",
        borderUpColor: "#333333", borderDownColor: "#444444",
        wickUpColor: "#555555", wickDownColor: "#666666",
        showBody: false, showBorders: true, showWick: false,
      },
    };
    const opts = toCandleOptions(settings);
    expect(opts.upColor).toBe("rgba(0,0,0,0)");
    expect(opts.downColor).toBe("rgba(0,0,0,0)");
    expect(opts.borderVisible).toBe(true);
    expect(opts.borderUpColor).toBe("#333333");
    expect(opts.borderDownColor).toBe("#444444");
    expect(opts.wickVisible).toBe(false);
    expect(opts.wickUpColor).toBe("#555555");
    expect(opts.wickDownColor).toBe("#666666");
  });
});

describe("rightOffsetPx", () => {
  const withTrading = (trading: Partial<typeof DEFAULT_CHART_SETTINGS.trading>, rightOffsetBars = 10) => ({
    ...DEFAULT_CHART_SETTINGS,
    canvas: { ...DEFAULT_CHART_SETTINGS.canvas, rightOffsetBars },
    trading: { ...DEFAULT_CHART_SETTINGS.trading, ...trading },
  });

  test("should reserve room for wall pills when walls are shown", () => {
    expect(rightOffsetPx(withTrading({ showOrderBookWalls: true }))).toBe(110);
  });

  test("should reserve room for the DOM ladder when it is enabled", () => {
    const dom = { ...DEFAULT_CHART_SETTINGS.trading.dom, enabled: true };
    expect(rightOffsetPx(withTrading({ showOrderBookWalls: true, dom }))).toBe(320);
  });

  test("should keep the user's larger offset and fall back to it when overlays are off", () => {
    expect(rightOffsetPx(withTrading({ showOrderBookWalls: true }, 30))).toBe(180);
    expect(rightOffsetPx(withTrading({ showOrderBookWalls: false }, 10))).toBe(60);
  });
});
