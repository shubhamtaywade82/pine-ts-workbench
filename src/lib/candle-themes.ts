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
  { id: "candles", label: "Candles" },
  { id: "heikin_ashi", label: "Heikin Ashi" },
  { id: "hollow", label: "Hollow Candles" },
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "baseline", label: "Baseline" },
];

export const CANDLE_THEMES: readonly CandleThemeDefinition[] = [
  { id: "tradingview", name: "TradingView Classic", upColor: "#089981", downColor: "#f23645", description: "Emerald green and crimson ruby" },
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
  if (bars.length === 0) return [];
  const result: Bar[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const prev = result[i - 1];
    // First bar anchors to actual open and close average.
    const open = prev === undefined ? (bar.open + bar.close) / 2 : (prev.open + prev.close) / 2;
    const high = Math.max(bar.high, open, close);
    const low = Math.min(bar.low, open, close);

    result.push({
      time: bar.time,
      open,
      high,
      low,
      close,
      volume: bar.volume,
    });
  }

  return result;
};

/** TradingView hollow candle style: transparent body on close >= open, solid on close < open. */
export const resolveHollowCandleColors = (
  bar: Bar,
  prevBar: Bar | undefined,
  upColor: string,
  downColor: string,
): { color: string; borderColor: string; wickColor: string } => {
  // Outline color is determined by direction against previous close (or open for bar 0).
  const referenceClose = prevBar?.close ?? bar.open;
  const outlineColor = bar.close >= referenceClose ? upColor : downColor;
  const isUpClose = bar.close >= bar.open;

  return {
    // Transparent body gives hollow appearance while keeping borders and wicks colored.
    color: isUpClose ? "transparent" : outlineColor,
    borderColor: outlineColor,
    wickColor: outlineColor,
  };
};

export const getSeriesOptions = (
  type: CandleType,
  candles: CandleSettingsInput,
  placement: "left" | "right",
): Record<string, unknown> => {
  const common = { priceLineVisible: false, priceScaleId: placement };
  if (type === "bars") {
    return { ...common, upColor: candles.upColor, downColor: candles.downColor };
  }
  if (type === "line") {
    return { ...common, color: candles.upColor, lineWidth: 2 };
  }
  if (type === "area") {
    return {
      ...common,
      lineColor: candles.upColor,
      topColor: `${candles.upColor}40`,
      bottomColor: `${candles.upColor}05`,
      lineWidth: 2,
    };
  }
  if (type === "baseline") {
    return {
      ...common,
      topLineColor: candles.upColor,
      topFillColor1: `${candles.upColor}40`,
      topFillColor2: `${candles.upColor}05`,
      bottomLineColor: candles.downColor,
      bottomFillColor1: `${candles.downColor}05`,
      bottomFillColor2: `${candles.downColor}40`,
      lineWidth: 2,
    };
  }
  return {
    ...common,
    upColor: candles.showBody !== false ? candles.upColor : "rgba(0,0,0,0)",
    downColor: candles.showBody !== false ? candles.downColor : "rgba(0,0,0,0)",
    borderVisible: candles.showBorders !== false,
    borderUpColor: candles.upColor,
    borderDownColor: candles.downColor,
    wickVisible: candles.showWick !== false,
    wickUpColor: candles.upColor,
    wickDownColor: candles.downColor,
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
      const hollow = resolveHollowCandleColors(b, displayBars[i - 1], candles.upColor, candles.downColor);
      return {
        time: Math.floor(b.time / 1000) as Time,
        open: b.open, high: b.high, low: b.low, close: b.close,
        color: hollow.color,
        borderColor: color ?? hollow.borderColor,
        wickColor: color ?? hollow.wickColor,
      };
    });
  }
  return displayBars.map((b) => {
    const color = barColors?.get(Math.floor(b.time / 1000));
    return {
      time: Math.floor(b.time / 1000) as Time,
      open: b.open, high: b.high, low: b.low, close: b.close,
      ...(color !== undefined ? { color, borderColor: color, wickColor: color } : {}),
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
  if (type === "line" || type === "area" || type === "baseline") {
    return { time, value: bar.close };
  }
  if (type === "bars") {
    return {
      time, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      ...(customColor !== undefined ? { color: customColor } : {}),
    };
  }
  if (type === "hollow") {
    const hollow = resolveHollowCandleColors(bar, prevBar, candles.upColor, candles.downColor);
    return {
      time, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      color: hollow.color,
      borderColor: customColor ?? hollow.borderColor,
      wickColor: customColor ?? hollow.wickColor,
    };
  }
  return {
    time, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    ...(customColor !== undefined ? { color: customColor, borderColor: customColor, wickColor: customColor } : {}),
  };
};
