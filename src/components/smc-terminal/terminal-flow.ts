import type { Bar } from "./terminal-types";
import type { Swing } from "./terminal-smc";

// Bar-level proxy of the footprint read: without per-price bid/ask we judge effort (volume, delta) against result (range).
const BASELINE_BARS = 20;
const ABSORB_VOLUME_MULT = 2;
const ABSORB_MIN_IMBALANCE = 0.15;
// Aggressors moved price less than this fraction of a normal bar's range: someone passive took the other side.
const ABSORB_MAX_PROGRESS = 0.3;
const EXHAUST_VOLUME_MULT = 0.7;
const EXHAUST_MAX_IMBALANCE = 0.15;
const EXHAUST_FADE_BARS = 3;
const EXHAUST_TREND_BARS = 6;
// The move into the stall must be real, not chop: at least this many average ranges.
const EXHAUST_MIN_MOVE_RANGES = 2;
const DIVERGENCE_MAX_SPAN_BARS = 60;
const MAX_DIVERGENCES = 6;

export type FlowDir = "bull" | "bear";

export interface FlowMark {
  kind: "absorb" | "exhaust";
  /** "bull": sellers absorbed or exhausted at a low (watch long). "bear": the mirror at a high. */
  dir: FlowDir;
  /** First bar of the pattern; equals `idx` for absorption, the start of the fading run for exhaustion. */
  fromIdx: number;
  idx: number;
  price: number;
  /** Bar volume relative to the rolling baseline. */
  volumeRatio: number;
}

export interface CvdDivergence {
  dir: FlowDir;
  fromIdx: number;
  toIdx: number;
}

export interface FlowAnalysis {
  cvd: number[];
  marks: FlowMark[];
  divergences: CvdDivergence[];
}

/** Signed aggressor volume of a bar: buys minus sells. */
export const barDelta = (bar: Bar): number => bar.v * (2 * bar.buyR - 1);

interface Baseline {
  volume: number;
  range: number;
}

function baselineAt(bars: Bar[], i: number): Baseline | undefined {
  if (i < BASELINE_BARS) return undefined;
  let volume = 0;
  let range = 0;
  for (let j = i - BASELINE_BARS; j < i; j++) {
    volume += bars[j].v;
    range += bars[j].h - bars[j].l;
  }
  if (volume <= 0 || range <= 0) return undefined;
  return { volume: volume / BASELINE_BARS, range: range / BASELINE_BARS };
}

/** High effort, no result: heavy one-sided aggression that barely moved price. */
function detectAbsorption(bar: Bar, i: number, base: Baseline): FlowMark | undefined {
  if (bar.v < base.volume * ABSORB_VOLUME_MULT) return undefined;
  const delta = barDelta(bar);
  if (Math.abs(delta) / bar.v < ABSORB_MIN_IMBALANCE) return undefined;
  const isSellerAggression = delta < 0;
  const progress = isSellerAggression ? bar.o - bar.c : bar.c - bar.o;
  if (progress > base.range * ABSORB_MAX_PROGRESS) return undefined;
  return {
    kind: "absorb", dir: isSellerAggression ? "bull" : "bear", fromIdx: i, idx: i,
    price: isSellerAggression ? bar.l : bar.h, volumeRatio: bar.v / base.volume,
  };
}

/** No effort left: shrinking, balanced volume right after a directional move. */
function detectExhaustion(bars: Bar[], i: number, base: Baseline): FlowMark | undefined {
  const fromIdx = i - EXHAUST_FADE_BARS + 1;
  if (fromIdx - EXHAUST_TREND_BARS < 0) return undefined;
  const bar = bars[i];
  if (bar.v > base.volume * EXHAUST_VOLUME_MULT || bar.v <= 0) return undefined;
  if (Math.abs(barDelta(bar)) / bar.v > EXHAUST_MAX_IMBALANCE) return undefined;
  for (let j = fromIdx + 1; j <= i; j++) if (bars[j].v >= bars[j - 1].v) return undefined;
  const move = bars[i].c - bars[fromIdx - EXHAUST_TREND_BARS].c;
  if (Math.abs(move) < base.range * EXHAUST_MIN_MOVE_RANGES) return undefined;
  const run = bars.slice(fromIdx, i + 1);
  const isDownMove = move < 0;
  return {
    kind: "exhaust", dir: isDownMove ? "bull" : "bear", fromIdx, idx: i,
    price: isDownMove ? Math.min(...run.map((b) => b.l)) : Math.max(...run.map((b) => b.h)),
    volumeRatio: bar.v / base.volume,
  };
}

function detectMarks(bars: Bar[]): FlowMark[] {
  const marks: FlowMark[] = [];
  for (let i = 0; i < bars.length; i++) {
    const base = baselineAt(bars, i);
    if (!base) continue;
    const absorb = detectAbsorption(bars[i], i, base);
    if (absorb) { marks.push(absorb); continue; }
    const exhaust = detectExhaustion(bars, i, base);
    const last = marks[marks.length - 1];
    // One box per stall: a fading run that keeps fading is the same exhaustion, not a new one.
    if (exhaust && !(last?.kind === "exhaust" && last.idx >= exhaust.fromIdx - 1)) marks.push(exhaust);
  }
  return marks;
}

/** Lower price low with a higher CVD low (bull), or higher high with lower CVD high (bear). */
function detectDivergences(swings: Swing[], cvd: number[]): CvdDivergence[] {
  const found: CvdDivergence[] = [];
  for (const kind of ["low", "high"] as const) {
    const points = swings.filter((s) => s.kind === kind && s.idx < cvd.length);
    for (let k = 1; k < points.length; k++) {
      const [a, b] = [points[k - 1], points[k]];
      if (b.idx - a.idx > DIVERGENCE_MAX_SPAN_BARS) continue;
      const isBull = kind === "low" && b.price < a.price && cvd[b.idx] > cvd[a.idx];
      const isBear = kind === "high" && b.price > a.price && cvd[b.idx] < cvd[a.idx];
      if (isBull || isBear) found.push({ dir: isBull ? "bull" : "bear", fromIdx: a.idx, toIdx: b.idx });
    }
  }
  return found.sort((x, y) => x.toIdx - y.toIdx).slice(-MAX_DIVERGENCES);
}

/** Absorption/exhaustion marks, CVD series and CVD divergences over the first `count` (confirmed) bars. */
export function analyzeFlow(bars: Bar[], count: number, swings: Swing[]): FlowAnalysis {
  const confirmed = bars.slice(0, count);
  const cvd: number[] = [];
  let running = 0;
  for (const bar of confirmed) cvd.push((running += barDelta(bar)));
  return { cvd, marks: detectMarks(confirmed), divergences: detectDivergences(swings, cvd) };
}
