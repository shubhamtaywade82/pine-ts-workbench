import type { Bar } from "@nemesis-oss/pine-ts";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";

export interface CandleSettingsInput {
  readonly upColor: string;
  readonly downColor: string;
  readonly borderUpColor?: string;
  readonly borderDownColor?: string;
  readonly wickUpColor?: string;
  readonly wickDownColor?: string;
  readonly showBody?: boolean;
  readonly showBorders?: boolean;
  readonly showWick?: boolean;
}

export type CandleType =
  | "candles"
  | "heikin_ashi"
  | "hollow"
  | "bars"
  | "line"
  | "area"
  | "baseline";

export type CandleThemeId =
  | "tradingview"
  | "vibrant"
  | "glass"
  | "water"
  | "neon"
  | "monochrome"
  | "bloomberg"
  | "nordic"
  | "matrix"
  | "sunset"
  | "custom";

export interface CandleThemeDefinition {
  readonly id: CandleThemeId;
  readonly name: string;
  readonly upColor: string;
  readonly downColor: string;
  readonly description: string;
}

export const CANDLE_TYPES: readonly { readonly id: CandleType; readonly label: string }[] = [
  { id: "candles", label: "Candles" }, { id: "heikin_ashi", label: "Heikin Ashi" },
  { id: "hollow", label: "Hollow Candles" }, { id: "bars", label: "Bars" },
  { id: "line", label: "Line" }, { id: "area", label: "Area" }, { id: "baseline", label: "Baseline" },
];

export const CANDLE_THEMES: readonly CandleThemeDefinition[] = [
  { id: "tradingview", name: "TradingView Classic", upColor: "#089981", downColor: "#f23645", description: "Emerald green and crimson ruby" },
  { id: "vibrant", name: "TradingView Vibrant", upColor: "#26a69a", downColor: "#ef5350", description: "Vibrant mint teal and punchy coral" },
  { id: "glass", name: "Frosted Glass", upColor: "#2dd4bf", downColor: "#fb7185", description: "Iced mint teal and frosted rose quartz glass" },
  { id: "water", name: "Oceanic Water", upColor: "#06b6d4", downColor: "#3b82f6", description: "Cyan lagoon and deep abyssal sapphire" },
  { id: "neon", name: "Neon Cyberpunk", upColor: "#00f0ff", downColor: "#ff007f", description: "Electric cyan and hot magenta dark terminal" },
  { id: "monochrome", name: "Monochrome Noir", upColor: "#f8fafc", downColor: "#334155", description: "Chalk white and slate obsidian print style" },
  { id: "bloomberg", name: "Bloomberg Terminal", upColor: "#f59e0b", downColor: "#64748b", description: "Amber gold and cool slate terminal" },
  { id: "nordic", name: "Nordic Frost", upColor: "#38bdf8", downColor: "#f472b6", description: "Soft pastel sky blue and coral palette" },
  { id: "matrix", name: "Matrix CRT", upColor: "#22c55e", downColor: "#15803d", description: "Phosphor lime and deep pine green" },
  { id: "sunset", name: "Sunset Dusk", upColor: "#a855f7", downColor: "#f97316", description: "Electric violet and warm tangerine" },
];

export const findCandleTheme = (id: CandleThemeId): CandleThemeDefinition | undefined =>
  CANDLE_THEMES.find((t) => t.id === id);

/** Transforms standard OHLC bars into smoothed Heikin Ashi trend bars. */
export const toHeikinAshi = (bars: readonly Bar[]): readonly Bar[] => {
  const result: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const prev = result[i - 1];
    const open = prev === undefined ? (bar.open + bar.close) / 2 : (prev.open + prev.close) / 2;
    result.push({
      time: bar.time, open, close, volume: bar.volume,
      high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close),
    });
  }
  return result;
};

/** Adds ~50% translucency (0x80) to hex or rgb colors for matching volume bars. */
export const toTranslucentColor = (color: string, alphaHex = "80"): string => {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
    return `#${full}${alphaHex}`;
  }
  if (color.startsWith("rgb")) {
    const m = color.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) return `rgba(${m[0]}, ${m[1]}, ${m[2]}, 0.5)`;
  }
  return color;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const c = hex.replace("#", "");
  const f = c.length === 3 ? c.split("").map((x) => x + x).join("") : c.slice(0, 6);
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};

const toByte = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");

/**
 * Blends a translucent barcolor (8-char hex or rgba) onto the candle's base theme color,
 * producing a solid, rich color so candles never wash out into the dark background
 * and never look like flat neon blocks.
 */
export const blendWithBaseColor = (base: string, tint: string): string => {
  let rgb: [number, number, number] | null = null;
  let alpha = 1;
  if (tint.startsWith("#") && tint.length === 9) {
    rgb = hexToRgb(tint.slice(0, 7));
    alpha = parseInt(tint.slice(7, 9), 16) / 255;
  } else if (tint.startsWith("#") && tint.length === 5) {
    rgb = hexToRgb(tint.slice(0, 4));
    alpha = parseInt(tint[4]! + tint[4]!, 16) / 255;
  } else if (tint.startsWith("rgba")) {
    const m = tint.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 4) {
      rgb = [parseInt(m[0]!, 10), parseInt(m[1]!, 10), parseInt(m[2]!, 10)];
      alpha = parseFloat(m[3]!);
    }
  }
  if (!rgb || alpha >= 0.99) return tint;
  const [b1, b2, b3] = hexToRgb(base);
  return `#${toByte(b1 * (1 - alpha) + rgb[0] * alpha)}${toByte(b2 * (1 - alpha) + rgb[1] * alpha)}${toByte(b3 * (1 - alpha) + rgb[2] * alpha)}`;
};

/** Strips alpha from 8-digit hex or rgba so borders and wicks always remain crisp and opaque. */
export const toOpaqueColor = (color: string): string => {
  if (color.startsWith("#") && color.length === 9) return color.slice(0, 7);
  if (color.startsWith("#") && color.length === 5) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  if (color.startsWith("rgba")) {
    const m = color.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
  }
  return color;
};

/** Formats a single bar into a volume histogram point matching candle up/down colors. */
export const toVolumePoint = (bar: Bar, upColor: string, downColor: string) => ({
  time: Math.floor(bar.time / 1000) as Time,
  value: bar.volume,
  color: bar.close >= bar.open ? toTranslucentColor(upColor) : toTranslucentColor(downColor),
});

/** TradingView hollow candle style: transparent body on close >= open, solid on close < open. */
export const resolveHollowCandleColors = (
  bar: Bar, prevBar: Bar | undefined, upOrSettings: string | CandleSettingsInput, downColorArg?: string,
): { color: string; borderColor: string; wickColor: string } => {
  const isSettings = typeof upOrSettings !== "string";
  const up = isSettings ? upOrSettings.upColor : upOrSettings;
  const down = isSettings ? upOrSettings.downColor : (downColorArg ?? up);
  const borderUp = isSettings ? (upOrSettings.borderUpColor ?? up) : up;
  const borderDown = isSettings ? (upOrSettings.borderDownColor ?? down) : down;
  const wickUp = isSettings ? (upOrSettings.wickUpColor ?? up) : up;
  const wickDown = isSettings ? (upOrSettings.wickDownColor ?? down) : down;
  const isUp = bar.close >= (prevBar?.close ?? bar.open);
  return {
    color: bar.close >= bar.open ? "transparent" : (isUp ? up : down),
    borderColor: isUp ? borderUp : borderDown,
    wickColor: isUp ? wickUp : wickDown,
  };
};

export const getSeriesOptions = (
  type: CandleType,
  candles: CandleSettingsInput,
  placement: "left" | "right",
): Record<string, unknown> => {
  const common = { priceLineVisible: false, priceScaleId: placement };
  if (type === "bars") return { ...common, upColor: candles.upColor, downColor: candles.downColor };
  if (type === "line") return { ...common, color: candles.upColor, lineWidth: 2 };
  if (type === "area") {
    return { ...common, lineColor: candles.upColor, topColor: `${candles.upColor}40`, bottomColor: `${candles.upColor}05`, lineWidth: 2 };
  }
  if (type === "baseline") {
    return {
      ...common,
      topLineColor: candles.upColor, topFillColor1: `${candles.upColor}40`, topFillColor2: `${candles.upColor}05`,
      bottomLineColor: candles.downColor, bottomFillColor1: `${candles.downColor}05`, bottomFillColor2: `${candles.downColor}40`,
      lineWidth: 2,
    };
  }
  return {
    ...common,
    upColor: candles.showBody !== false ? candles.upColor : "rgba(0,0,0,0)",
    downColor: candles.showBody !== false ? candles.downColor : "rgba(0,0,0,0)",
    borderVisible: candles.showBorders !== false,
    borderUpColor: candles.borderUpColor ?? candles.upColor,
    borderDownColor: candles.borderDownColor ?? candles.downColor,
    wickVisible: candles.showWick !== false,
    wickUpColor: candles.wickUpColor ?? candles.upColor,
    wickDownColor: candles.wickDownColor ?? candles.downColor,
  };
};

export const createPrimarySeries = (
  chart: IChartApi,
  type: CandleType,
  options: Record<string, unknown>,
): ISeriesApi<SeriesType> => {
  if (type === "bars") return chart.addSeries(BarSeries, options);
  if (type === "line") return chart.addSeries(LineSeries, options);
  if (type === "area") return chart.addSeries(AreaSeries, options);
  if (type === "baseline") return chart.addSeries(BaselineSeries, options);
  return chart.addSeries(CandlestickSeries, options);
};

export const formatSeriesData = (
  bars: readonly Bar[],
  type: CandleType,
  candles: CandleSettingsInput,
  barColors?: ReadonlyMap<number, string>,
): readonly unknown[] => {
  const displayBars = type === "heikin_ashi" ? toHeikinAshi(bars) : bars;
  if (type === "line" || type === "area" || type === "baseline") {
    return displayBars.map((b) => ({ time: Math.floor(b.time / 1000) as Time, value: b.close }));
  }
  if (type === "bars") {
    return displayBars.map((b) => {
      const color = barColors?.get(Math.floor(b.time / 1000));
      return {
        time: Math.floor(b.time / 1000) as Time,
        open: b.open, high: b.high, low: b.low, close: b.close,
        ...(color !== undefined ? { color } : {}),
      };
    });
  }
  if (type === "hollow") {
    return displayBars.map((b, i) => {
      const color = barColors?.get(Math.floor(b.time / 1000));
      const hollow = resolveHollowCandleColors(b, displayBars[i - 1], candles);
      const blended = color !== undefined ? blendWithBaseColor(hollow.borderColor, color) : undefined;
      return {
        time: Math.floor(b.time / 1000) as Time,
        open: b.open, high: b.high, low: b.low, close: b.close,
        color: hollow.color,
        borderColor: blended ?? hollow.borderColor,
        wickColor: blended ?? hollow.wickColor,
      };
    });
  }
  return displayBars.map((b) => {
    const color = barColors?.get(Math.floor(b.time / 1000));
    const base = b.close >= b.open ? candles.upColor : candles.downColor;
    const blended = color !== undefined ? blendWithBaseColor(base, color) : undefined;
    return {
      time: Math.floor(b.time / 1000) as Time,
      open: b.open, high: b.high, low: b.low, close: b.close,
      ...(blended !== undefined ? { color: blended, borderColor: blended, wickColor: blended } : {}),
    };
  });
};

export const formatSeriesPoint = (
  bar: Bar,
  prevBar: Bar | undefined,
  type: CandleType,
  candles: CandleSettingsInput,
  customColor?: string,
): unknown => {
  const time = Math.floor(bar.time / 1000) as Time;
  if (type === "line" || type === "area" || type === "baseline") return { time, value: bar.close };
  if (type === "bars") {
    return { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, ...(customColor ? { color: customColor } : {}) };
  }
  if (type === "hollow") {
    const hollow = resolveHollowCandleColors(bar, prevBar, candles);
    const blended = customColor !== undefined ? blendWithBaseColor(hollow.borderColor, customColor) : undefined;
    return {
      time, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      color: hollow.color,
      borderColor: blended ?? hollow.borderColor,
      wickColor: blended ?? hollow.wickColor,
    };
  }
  const base = bar.close >= bar.open ? candles.upColor : candles.downColor;
  const blended = customColor !== undefined ? blendWithBaseColor(base, customColor) : undefined;
  return {
    time, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    ...(blended !== undefined ? { color: blended, borderColor: blended, wickColor: blended } : {}),
  };
};
