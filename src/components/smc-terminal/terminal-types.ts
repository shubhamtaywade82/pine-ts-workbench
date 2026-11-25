export const SEEDS = [1337, 4242, 9001, 2718, 3141, 8080] as const;
// Tick of the simulated (non-live) market; live mode uses the symbol's real tick.
export const BASE_BIN = 0.05;
export const NORMAL = 220;
export const SESSION_BARS = 240;
export const START_PLAY = 200;
export const MAX_BARS = 900;
export const TF_MS: Record<number, number> = { 1: 60e3, 5: 300e3, 15: 900e3, 60: 3600e3 };

export type ThemeName = "ion" | "classic" | "ultra";
export type CandleStyle = "hollow" | "solid";
export type RaySpan = "birth" | "window" | "full";
export type WallEventType = "wall" | "pull" | "held" | "brk";
export type LevelFilter = "all" | "bid" | "ask" | "evt" | "dom";
export type SortOption = "dist" | "size" | "new";

export interface ThemeColors {
  readonly bid: string;
  readonly ask: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  ion: { bid: "#19E3B1", ask: "#FF4D6D" },
  classic: { bid: "#22D07E", ask: "#FF5A52" },
  ultra: { bid: "#8F7BFF", ask: "#FFB224" },
};

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  buyR: number;
  path: number[];
}

export interface BigWall {
  idx: number;
  born: number;
  side: "bid" | "ask";
  size: number;
}

export interface MarketEvent {
  bar: number;
  type: WallEventType;
  price: number;
  size: number;
  side: "bid" | "ask";
}

export interface FvgZone {
  lo: number;
  hi: number;
  start: number;
  side: "bull" | "bear";
  filled: number | null;
}

export interface TerminalParams {
  zoom: number;
  candle: CandleStyle;
  theme: ThemeName;
  rays: boolean;
  ladder: boolean;
  fvg: boolean;
  filled: boolean;
  vol: boolean;
  grid: boolean;
  gridAlpha: number;
  bos: boolean;
  ob: boolean;
  liq: boolean;
  pd: boolean;
  /** Absorption/exhaustion marks, CVD strip and CVD divergences. */
  flow: boolean;
  pulled: boolean;
  bin: number;
  rayScale: number;
  ladderW: number;
  glow: number;
  density: number;
  raySpan: RaySpan;
  speed: number;
  follow: boolean;
}

export interface PlotLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  b: number;
}

export interface ViewportState {
  center: number;
  visible: number;
  tCenter: number;
  tVisible: number;
  minP: number;
  maxP: number;
  tMinP: number;
  tMaxP: number;
}

export interface RayHit {
  price: number;
  y: number;
  x0: number;
  x1: number;
  size: number;
  side: "bid" | "ask";
  born: number;
}

export interface ToastItem {
  id: string;
  msg: string;
  kind?: "warn" | "danger" | "ok";
}
