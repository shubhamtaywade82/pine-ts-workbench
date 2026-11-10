import { DEFAULT_MIN_WALL_NOTIONAL, DEFAULT_TOP_WALLS, DEFAULT_WALL_WINDOW_PCT, WALL_WINDOW_LIMITS_PCT } from "./depth-walls";

export type DepthWallStyle = "shelf" | "dom" | "bracket" | "bubbles";
export const DEPTH_WALL_STYLES: readonly DepthWallStyle[] = ["shelf", "dom", "bracket", "bubbles"] as const;

export type WallLabel = "compact" | "detailed";
export const WALL_LABELS: readonly WallLabel[] = ["compact", "detailed"] as const;

export type FootprintMode = "bid-ask" | "delta" | "total";
const FOOTPRINT_MODES: readonly FootprintMode[] = ["bid-ask", "delta", "total"];

export interface TradingSettings {
  /** Strategy entry/exit arrows on the chart ("Execution marks"). */
  readonly showExecutionMarks: boolean;
  /** "Long" / "Short" / "Close" text on those arrows ("Execution labels"). */
  readonly showExecutionLabels: boolean;
  /** Live order book depth walls visualization. */
  readonly showOrderBookWalls: boolean;
  /** Live Best Bid and Best Ask horizontal price lines with scale badges. */
  readonly showBidAskLines: boolean;
  /** Visual representation style for depth walls. */
  readonly depthWallStyle: DepthWallStyle;
  /** Label format for depth wall pills (compact price + notional vs detailed status + age). */
  readonly wallLabel: WallLabel;
  /** Half-width of the wall search around mid, in percent. Clipped to the snapshot's verified coverage. */
  readonly wallWindowPct: number;
  /** Smallest wall, in the chart's quote currency. */
  readonly minWallNotional: number;
  readonly dom: {
    readonly enabled: boolean;
    /** Price levels per ladder row. */
    readonly bucketTicks: number;
    /** Rows centred on mid: half above, half below, clipped to book coverage. */
    readonly visibleBuckets: number;
  };
  readonly heatmap: {
    readonly enabled: boolean;
    readonly opacity: number;
    readonly minutes: number;
  };
  /** Ranked walls per side in the monitor. The chart bubble stays the single hysteresis wall. */
  readonly wallTopN: number;
  readonly footprint: {
    readonly enabled: boolean;
    readonly mode: FootprintMode;
    /** Price levels per footprint row. */
    readonly bucketTicks: number;
  };
  readonly outcomes: {
    readonly enabled: boolean;
  };
}

export const DEFAULT_TRADING: TradingSettings = {
  showExecutionMarks: true,
  showExecutionLabels: true,
  showOrderBookWalls: true,
  showBidAskLines: true,
  depthWallStyle: "shelf",
  wallLabel: "compact",
  wallWindowPct: DEFAULT_WALL_WINDOW_PCT,
  minWallNotional: DEFAULT_MIN_WALL_NOTIONAL,
  dom: { enabled: false, bucketTicks: 10, visibleBuckets: 40 },
  heatmap: { enabled: false, opacity: 0.5, minutes: 10 },
  wallTopN: DEFAULT_TOP_WALLS,
  footprint: { enabled: false, mode: "delta", bucketTicks: 10 },
  outcomes: { enabled: false },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** A finite number clamped to `[min, max]`; anything else (missing, text, NaN) takes the fallback. */
const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** An integer clamped to `[min, max]`; fractions and non-numbers take the fallback. */
const integerIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

const normalizeDom = (stored: unknown): TradingSettings["dom"] => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_TRADING.dom;
  return {
    enabled: booleanOr(raw["enabled"], defaults.enabled),
    bucketTicks: integerIn(raw["bucketTicks"], 1, 10_000, defaults.bucketTicks),
    visibleBuckets: integerIn(raw["visibleBuckets"], 5, 200, defaults.visibleBuckets),
  };
};

const normalizeHeatmap = (stored: unknown): TradingSettings["heatmap"] => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_TRADING.heatmap;
  return {
    enabled: booleanOr(raw["enabled"], defaults.enabled),
    opacity: numberIn(raw["opacity"], 0.05, 1, defaults.opacity),
    minutes: integerIn(raw["minutes"], 1, 60, defaults.minutes),
  };
};

const isFootprintMode = (value: unknown): value is FootprintMode =>
  typeof value === "string" && (FOOTPRINT_MODES as readonly string[]).includes(value);

const normalizeFootprint = (stored: unknown): TradingSettings["footprint"] => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_TRADING.footprint;
  return {
    enabled: booleanOr(raw["enabled"], defaults.enabled),
    mode: isFootprintMode(raw["mode"]) ? raw["mode"] : defaults.mode,
    bucketTicks: integerIn(raw["bucketTicks"], 1, 10_000, defaults.bucketTicks),
  };
};

const isDepthWallStyle = (val: unknown): val is DepthWallStyle =>
  typeof val === "string" && (DEPTH_WALL_STYLES as readonly string[]).includes(val);

const isWallLabel = (val: unknown): val is WallLabel =>
  typeof val === "string" && (WALL_LABELS as readonly string[]).includes(val);

const normalizeOutcomes = (stored: unknown): TradingSettings["outcomes"] => {
  const raw = isRecord(stored) ? stored : {};
  return { enabled: booleanOr(raw["enabled"], DEFAULT_TRADING.outcomes.enabled) };
};

export const normalizeTrading = (stored: unknown): TradingSettings => {
  const raw = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_TRADING;
  return {
    showExecutionMarks: booleanOr(raw["showExecutionMarks"], defaults.showExecutionMarks),
    showExecutionLabels: booleanOr(raw["showExecutionLabels"], defaults.showExecutionLabels),
    showOrderBookWalls: booleanOr(raw["showOrderBookWalls"], defaults.showOrderBookWalls),
    showBidAskLines: booleanOr(raw["showBidAskLines"], defaults.showBidAskLines),
    depthWallStyle: isDepthWallStyle(raw["depthWallStyle"]) ? raw["depthWallStyle"] : defaults.depthWallStyle,
    wallLabel: isWallLabel(raw["wallLabel"]) ? raw["wallLabel"] : defaults.wallLabel,
    wallWindowPct: numberIn(raw["wallWindowPct"], WALL_WINDOW_LIMITS_PCT.min, WALL_WINDOW_LIMITS_PCT.max, defaults.wallWindowPct),
    minWallNotional: numberIn(raw["minWallNotional"], 0, Number.POSITIVE_INFINITY, defaults.minWallNotional),
    dom: normalizeDom(raw["dom"]),
    heatmap: normalizeHeatmap(raw["heatmap"]),
    wallTopN: integerIn(raw["wallTopN"], 1, 20, defaults.wallTopN),
    footprint: normalizeFootprint(raw["footprint"]),
    outcomes: normalizeOutcomes(raw["outcomes"]),
  };
};
