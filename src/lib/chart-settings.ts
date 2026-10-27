import type { DeepPartial, ChartOptions, CandlestickSeriesOptions, PriceScaleOptions } from "lightweight-charts";
import { DEFAULT_MIN_WALL_NOTIONAL, DEFAULT_WALL_WINDOW_PCT, WALL_WINDOW_LIMITS_PCT } from "./depth-walls";

/**
 * Chart appearance shared by every chart cell, edited in the Settings dialog
 * and the price-scale menu, persisted in localStorage like TradingView's.
 * Only options lightweight-charts can actually render are offered.
 */

export type ScaleMode = "regular" | "percent" | "indexed" | "logarithmic";
export type ScalePlacement = "left" | "right";
export type DepthWallStyle = "shelf" | "dom" | "bracket" | "bubbles";
export const DEPTH_WALL_STYLES: readonly DepthWallStyle[] = ["shelf", "dom", "bracket", "bubbles"] as const;

export interface ChartSettings {
  readonly candles: {
    readonly upColor: string;
    readonly downColor: string;
    readonly showBody: boolean;
    readonly showBorders: boolean;
    readonly showWick: boolean;
  };
  readonly statusLine: {
    readonly showTitle: boolean;
    readonly showOhlc: boolean;
    readonly showIndicatorTitles: boolean;
    readonly showIndicatorValues: boolean;
  };
  readonly scales: {
    readonly mode: ScaleMode;
    readonly autoScale: boolean;
    readonly invert: boolean;
    readonly showLastPriceLine: boolean;
    /** Which side the price scales sit on ("Move scale to left"). */
    readonly placement: ScalePlacement;
  };
  readonly trading: {
    /** Strategy entry/exit arrows on the chart ("Execution marks"). */
    readonly showExecutionMarks: boolean;
    /** "Long" / "Short" / "Close" text on those arrows ("Execution labels"). */
    readonly showExecutionLabels: boolean;
    /** Live order book depth walls visualization. */
    readonly showOrderBookWalls: boolean;
    /** Visual representation style for depth walls. */
    readonly depthWallStyle: DepthWallStyle;
    /** Half-width of the wall search around mid, in percent. Clipped to the snapshot's verified coverage. */
    readonly wallWindowPct: number;
    /** Smallest wall, in the chart's quote currency. */
    readonly minWallNotional: number;
  };
  readonly canvas: {
    readonly background: string;
    readonly showVertGrid: boolean;
    readonly showHorzGrid: boolean;
    readonly gridColor: string;
    readonly crosshairColor: string;
    readonly textColor: string;
    readonly fontSize: number;
    readonly marginTopPercent: number;
    readonly marginBottomPercent: number;
    readonly rightOffsetBars: number;
  };
}

// TradingView's dark theme defaults.
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  candles: { upColor: "#089981", downColor: "#f23645", showBody: true, showBorders: true, showWick: true },
  statusLine: { showTitle: true, showOhlc: true, showIndicatorTitles: true, showIndicatorValues: true },
  scales: { mode: "regular", autoScale: true, invert: false, showLastPriceLine: true, placement: "right" },
  trading: {
    showExecutionMarks: true,
    showExecutionLabels: true,
    showOrderBookWalls: true,
    depthWallStyle: "shelf",
    wallWindowPct: DEFAULT_WALL_WINDOW_PCT,
    minWallNotional: DEFAULT_MIN_WALL_NOTIONAL,
  },
  canvas: {
    background: "#131722", showVertGrid: true, showHorzGrid: true, gridColor: "#1e222d", crosshairColor: "#9598a1",
    textColor: "#b2b5be", fontSize: 11, marginTopPercent: 10, marginBottomPercent: 10, rightOffsetBars: 10,
  },
};

const STORAGE_KEY = "pine-ts-workbench-chart-settings";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** A finite number clamped to `[min, max]`; anything else (missing, text, NaN) takes the fallback. */
const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const isDepthWallStyle = (val: unknown): val is DepthWallStyle =>
  typeof val === "string" && (DEPTH_WALL_STYLES as readonly string[]).includes(val);

const normalizeTrading = (stored: unknown): ChartSettings["trading"] => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_CHART_SETTINGS.trading;
  return {
    showExecutionMarks: booleanOr(raw["showExecutionMarks"], defaults.showExecutionMarks),
    showExecutionLabels: booleanOr(raw["showExecutionLabels"], defaults.showExecutionLabels),
    showOrderBookWalls: booleanOr(raw["showOrderBookWalls"], defaults.showOrderBookWalls),
    depthWallStyle: isDepthWallStyle(raw["depthWallStyle"]) ? raw["depthWallStyle"] : defaults.depthWallStyle,
    wallWindowPct: numberIn(raw["wallWindowPct"], WALL_WINDOW_LIMITS_PCT.min, WALL_WINDOW_LIMITS_PCT.max, defaults.wallWindowPct),
    minWallNotional: numberIn(raw["minWallNotional"], 0, Number.POSITIVE_INFINITY, defaults.minWallNotional),
  };
};

/**
 * Stored settings over the defaults. Sections missing from older saves take
 * their defaults; the trading section is validated field by field, so a bad
 * value can never reach the wall detector.
 */
export const normalizeChartSettings = (raw: unknown): ChartSettings => {
  const stored = isRecord(raw) ? raw : {};
  const section = (key: string): Record<string, unknown> => (isRecord(stored[key]) ? stored[key] : {});
  return {
    candles: { ...DEFAULT_CHART_SETTINGS.candles, ...section("candles") },
    statusLine: { ...DEFAULT_CHART_SETTINGS.statusLine, ...section("statusLine") },
    scales: { ...DEFAULT_CHART_SETTINGS.scales, ...section("scales") },
    trading: normalizeTrading(stored["trading"]),
    canvas: { ...DEFAULT_CHART_SETTINGS.canvas, ...section("canvas") },
  };
};

export const loadChartSettings = (): ChartSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_CHART_SETTINGS;
    return normalizeChartSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_SETTINGS; // Storage blocked or corrupt — defaults still render.
  }
};

export const saveChartSettings = (settings: ChartSettings): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode): settings last for this session only.
  }
};

// lightweight-charts PriceScaleMode: Normal 0, Logarithmic 1, Percentage 2, IndexedTo100 3.
const PRICE_SCALE_MODE: Record<ScaleMode, number> = { regular: 0, logarithmic: 1, percent: 2, indexed: 3 };

export const toPriceScaleOptions = ({ scales, canvas }: ChartSettings): DeepPartial<PriceScaleOptions> => ({
  mode: PRICE_SCALE_MODE[scales.mode],
  autoScale: scales.autoScale,
  invertScale: scales.invert,
  scaleMargins: { top: canvas.marginTopPercent / 100, bottom: canvas.marginBottomPercent / 100 },
});

export const toChartOptions = (settings: ChartSettings): DeepPartial<ChartOptions> => {
  const { canvas } = settings;
  return {
    layout: { background: { color: canvas.background }, textColor: canvas.textColor, fontSize: canvas.fontSize },
    grid: {
      vertLines: { visible: canvas.showVertGrid, color: canvas.gridColor },
      horzLines: { visible: canvas.showHorzGrid, color: canvas.gridColor },
    },
    crosshair: { vertLine: { color: canvas.crosshairColor }, horzLine: { color: canvas.crosshairColor } },
    timeScale: { rightOffset: canvas.rightOffsetBars },
    // One scale shows; every main- and sub-pane series is put on that side.
    rightPriceScale: { ...toPriceScaleOptions(settings), visible: settings.scales.placement === "right" },
    leftPriceScale: { ...toPriceScaleOptions(settings), visible: settings.scales.placement === "left" },
  };
};

const TRANSPARENT = "rgba(0,0,0,0)";

export const toCandleOptions = ({ candles, scales }: ChartSettings): DeepPartial<CandlestickSeriesOptions> => ({
  upColor: candles.showBody ? candles.upColor : TRANSPARENT,
  downColor: candles.showBody ? candles.downColor : TRANSPARENT,
  borderVisible: candles.showBorders,
  borderUpColor: candles.upColor,
  borderDownColor: candles.downColor,
  wickVisible: candles.showWick,
  wickUpColor: candles.upColor,
  wickDownColor: candles.downColor,
  // LastPricePrimitive draws it from the forming candle only; LWC's line spans the whole pane.
  priceLineVisible: false,
  priceScaleId: scales.placement,
});
