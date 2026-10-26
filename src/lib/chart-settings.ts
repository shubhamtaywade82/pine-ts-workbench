import type { DeepPartial, ChartOptions, CandlestickSeriesOptions, PriceScaleOptions } from "lightweight-charts";

/**
 * Chart appearance shared by every chart cell, edited in the Settings dialog
 * and the price-scale menu, persisted in localStorage like TradingView's.
 * Only options lightweight-charts can actually render are offered.
 */

export type ScaleMode = "regular" | "percent" | "indexed" | "logarithmic";

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
  scales: { mode: "regular", autoScale: true, invert: false, showLastPriceLine: true },
  canvas: {
    background: "#131722", showVertGrid: true, showHorzGrid: true, gridColor: "#1e222d", crosshairColor: "#9598a1",
    textColor: "#b2b5be", fontSize: 11, marginTopPercent: 10, marginBottomPercent: 10, rightOffsetBars: 10,
  },
};

const STORAGE_KEY = "pine-ts-workbench-chart-settings";

/** Stored settings over the defaults, section by section, so new fields get defaults. */
export const loadChartSettings = (): ChartSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_CHART_SETTINGS;
    const stored = JSON.parse(raw) as Partial<ChartSettings>;
    return {
      candles: { ...DEFAULT_CHART_SETTINGS.candles, ...stored.candles },
      statusLine: { ...DEFAULT_CHART_SETTINGS.statusLine, ...stored.statusLine },
      scales: { ...DEFAULT_CHART_SETTINGS.scales, ...stored.scales },
      canvas: { ...DEFAULT_CHART_SETTINGS.canvas, ...stored.canvas },
    };
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
    rightPriceScale: toPriceScaleOptions(settings),
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
  priceLineVisible: scales.showLastPriceLine,
});
