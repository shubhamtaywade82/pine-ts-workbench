import type { DeepPartial, ChartOptions, CandlestickSeriesOptions, PriceScaleOptions } from "lightweight-charts";
import type { CandleThemeId, CandleType } from "./candle-themes";
import { CANDLE_THEMES, CANDLE_TYPES } from "./candle-themes";
import { DEFAULT_TRADING, DEPTH_WALL_STYLES, normalizeTrading, type TradingSettings } from "./trading-settings";

export type { DepthWallStyle, FootprintMode, TradingSettings, WallLabel } from "./trading-settings";
export { DEPTH_WALL_STYLES, normalizeTrading };

/**
 * Chart appearance shared by every chart cell, edited in the Settings dialog
 * and the price-scale menu, persisted in localStorage like TradingView's.
 * Only options lightweight-charts can actually render are offered.
 */

export type ScaleMode = "regular" | "percent" | "indexed" | "logarithmic";
export type ScalePlacement = "left" | "right";

export interface ChartSettings {
  readonly candles: {
    readonly type: CandleType;
    readonly theme: CandleThemeId;
    readonly upColor: string;
    readonly downColor: string;
    readonly borderUpColor: string;
    readonly borderDownColor: string;
    readonly wickUpColor: string;
    readonly wickDownColor: string;
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
  readonly trading: TradingSettings;
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
  candles: {
    type: "candles",
    theme: "tradingview",
    upColor: "#089981",
    downColor: "#f23645",
    borderUpColor: "#089981",
    borderDownColor: "#f23645",
    wickUpColor: "#089981",
    wickDownColor: "#f23645",
    showBody: true,
    showBorders: true,
    showWick: true,
  },
  statusLine: { showTitle: true, showOhlc: true, showIndicatorTitles: true, showIndicatorValues: true },
  scales: { mode: "regular", autoScale: true, invert: false, showLastPriceLine: true, placement: "right" },
  trading: DEFAULT_TRADING,
  canvas: {
    background: "#000000", showVertGrid: true, showHorzGrid: true, gridColor: "#141414", crosshairColor: "#9598a1",
    textColor: "#b2b5be", fontSize: 11, marginTopPercent: 10, marginBottomPercent: 10, rightOffsetBars: 10,
  },
};

const STORAGE_KEY = "pine-ts-workbench-chart-settings";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const isCandleType = (val: unknown): val is CandleType =>
  typeof val === "string" && CANDLE_TYPES.some((t) => t.id === val);

const isCandleTheme = (val: unknown): val is CandleThemeId =>
  val === "custom" || (typeof val === "string" && CANDLE_THEMES.some((t) => t.id === val));

const normalizeCandles = (stored: unknown): ChartSettings["candles"] => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_CHART_SETTINGS.candles;
  const upColor = typeof raw["upColor"] === "string" ? raw["upColor"] : defaults.upColor;
  const downColor = typeof raw["downColor"] === "string" ? raw["downColor"] : defaults.downColor;
  return {
    type: isCandleType(raw["type"]) ? raw["type"] : defaults.type,
    theme: isCandleTheme(raw["theme"]) ? raw["theme"] : defaults.theme,
    upColor,
    downColor,
    borderUpColor: typeof raw["borderUpColor"] === "string" ? raw["borderUpColor"] : upColor,
    borderDownColor: typeof raw["borderDownColor"] === "string" ? raw["borderDownColor"] : downColor,
    wickUpColor: typeof raw["wickUpColor"] === "string" ? raw["wickUpColor"] : upColor,
    wickDownColor: typeof raw["wickDownColor"] === "string" ? raw["wickDownColor"] : downColor,
    showBody: booleanOr(raw["showBody"], defaults.showBody),
    showBorders: booleanOr(raw["showBorders"], defaults.showBorders),
    showWick: booleanOr(raw["showWick"], defaults.showWick),
  };
};

const normalizeCanvas = (stored: unknown): ChartSettings["canvas"] => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_CHART_SETTINGS.canvas;
  const bg = typeof raw["background"] === "string" ? raw["background"] : defaults.background;
  const grid = typeof raw["gridColor"] === "string" ? raw["gridColor"] : defaults.gridColor;
  return {
    ...defaults,
    ...raw,
    // Seamlessly upgrade legacy off-black defaults to OLED true black
    background: bg === "#131722" ? defaults.background : bg,
    gridColor: grid === "#1e222d" ? defaults.gridColor : grid,
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
    candles: normalizeCandles(stored["candles"]),
    statusLine: { ...DEFAULT_CHART_SETTINGS.statusLine, ...section("statusLine") },
    scales: { ...DEFAULT_CHART_SETTINGS.scales, ...section("scales") },
    trading: normalizeTrading(stored["trading"]),
    canvas: normalizeCanvas(stored["canvas"]),
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

// LWC's default bar spacing; converts the user's "Right: N bars" into the pixel offset below.
const DEFAULT_BAR_PX = 6;
// Room right of the forming candle: a compact wall pill (~100 px) or the right-pinned DOM ladder
// (bid bars + price + ask bars + activity = 72 + 64 + 72 + 96 = 304) plus a ~64 px gap so the
// candles keep clear of it and trade flow has a visible trip.
const WALL_PILL_RESERVE_PX = 110;
const DOM_LADDER_RESERVE_PX = 370;

/**
 * Right margin in pixels. LWC's `rightOffset` is in bars, so the gap collapses when zoomed
 * out and order-flow labels land on the candles. Pixel mode cannot be switched off once set
 * (applyOptions skips undefined), so it is always used and floored by the user's bar setting.
 */
export const rightOffsetPx = ({ canvas, trading }: ChartSettings): number => {
  const userPx = canvas.rightOffsetBars * DEFAULT_BAR_PX;
  if (trading.dom.enabled) return Math.max(userPx, DOM_LADDER_RESERVE_PX);
  if (trading.showOrderBookWalls) return Math.max(userPx, WALL_PILL_RESERVE_PX);
  return userPx;
};

export const toChartOptions = (settings: ChartSettings): DeepPartial<ChartOptions> => {
  const { canvas } = settings;
  return {
    layout: { background: { color: canvas.background }, textColor: canvas.textColor, fontSize: canvas.fontSize },
    grid: {
      vertLines: { visible: canvas.showVertGrid, color: canvas.gridColor },
      horzLines: { visible: canvas.showHorzGrid, color: canvas.gridColor },
    },
    crosshair: { vertLine: { color: canvas.crosshairColor }, horzLine: { color: canvas.crosshairColor } },
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
  borderUpColor: candles.borderUpColor,
  borderDownColor: candles.borderDownColor,
  wickVisible: candles.showWick,
  wickUpColor: candles.wickUpColor,
  wickDownColor: candles.wickDownColor,
  // LastPricePrimitive draws it from the forming candle only; LWC's line spans the whole pane.
  priceLineVisible: false,
  priceScaleId: scales.placement,
});
