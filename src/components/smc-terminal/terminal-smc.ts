import type { Bar } from "./terminal-types";

export const SWING_LEN = 5;
// An unmitigated block stops being drawn after this many bars; stale zones are noise, not support.
export const OB_EXPIRE_BARS = 120;
const MAX_BLOCKS = 8;
// Two swing highs (or lows) within this fraction of price rest the same stops: equal highs/lows.
const EQUAL_LEVEL_TOLERANCE = 0.0005;
const EQUAL_LEVEL_MAX_SPAN_BARS = 80;
// A sweep needs a real wick through the level, not a one-tick poke.
const SWEEP_MIN_WICK_FRACTION = 0.12;
const MAX_SWEEPS = 12;
const MAX_POOLS = 8;
const DAY_MS = 86_400_000;

export type StructureLabel = "HH" | "HL" | "LH" | "LL";

export interface Swing {
  idx: number;
  price: number;
  kind: "high" | "low";
  label?: StructureLabel;
}

export interface StructureBreak {
  kind: "BOS" | "CHoCH";
  dir: "bull" | "bear";
  level: number;
  fromIdx: number;
  idx: number;
}

export interface OrderBlock {
  dir: "bull" | "bear";
  lo: number;
  hi: number;
  start: number;
  /** Bar where price closed through the block, or where it expired. Undefined while still active. */
  end?: number;
  isMitigated: boolean;
}

export interface LiquidityPool {
  kind: "EQH" | "EQL";
  price: number;
  fromIdx: number;
  toIdx: number;
  /** First bar whose wick traded through the pool. */
  sweptAt?: number;
}

export interface Sweep {
  /** "bear": a high was swept and closed back below. "bull": a low was swept and closed back above. */
  dir: "bull" | "bear";
  level: number;
  fromIdx: number;
  idx: number;
}

/** Dealing range between the latest swing high and swing low; `mid` is equilibrium. */
export interface DealingRange {
  hi: number;
  lo: number;
  mid: number;
  fromIdx: number;
}

/** Previous UTC day's extremes, drawn from the first bar of the current day. */
export interface DailyLevels {
  pdh: number;
  pdl: number;
  fromIdx: number;
}

export interface SmcAnalysis {
  swings: Swing[];
  breaks: StructureBreak[];
  blocks: OrderBlock[];
  pools: LiquidityPool[];
  sweeps: Sweep[];
  range?: DealingRange;
  daily?: DailyLevels;
}

function isPivot(bars: Bar[], i: number, len: number, kind: Swing["kind"]): boolean {
  const key = kind === "high" ? "h" : "l";
  const sign = kind === "high" ? 1 : -1;
  for (let j = 1; j <= len; j++) {
    if (sign * (bars[i][key] - bars[i - j][key]) <= 0) return false;
    if (sign * (bars[i][key] - bars[i + j][key]) < 0) return false;
  }
  return true;
}

function labelFor(kind: Swing["kind"], price: number, previous: Swing | undefined): StructureLabel | undefined {
  if (!previous) return undefined;
  if (kind === "high") return price > previous.price ? "HH" : "LH";
  return price > previous.price ? "HL" : "LL";
}

interface Tracker {
  lastHigh?: Swing & { broken: boolean };
  lastLow?: Swing & { broken: boolean };
  trend: 0 | 1 | -1;
}

function registerPivots(bars: Bar[], t: number, tracker: Tracker, swings: Swing[]): void {
  const p = t - SWING_LEN;
  if (p < SWING_LEN) return;
  for (const kind of ["high", "low"] as const) {
    if (!isPivot(bars, p, SWING_LEN, kind)) continue;
    const price = kind === "high" ? bars[p].h : bars[p].l;
    const previous = kind === "high" ? tracker.lastHigh : tracker.lastLow;
    const swing = { idx: p, price, kind, label: labelFor(kind, price, previous), broken: false };
    swings.push(swing);
    if (kind === "high") tracker.lastHigh = swing;
    else tracker.lastLow = swing;
  }
}

function detectBreak(close: number, t: number, tracker: Tracker): StructureBreak | undefined {
  const { lastHigh, lastLow } = tracker;
  if (lastHigh && !lastHigh.broken && close > lastHigh.price) {
    lastHigh.broken = true;
    const kind = tracker.trend === -1 ? "CHoCH" : "BOS";
    tracker.trend = 1;
    return { kind, dir: "bull", level: lastHigh.price, fromIdx: lastHigh.idx, idx: t };
  }
  if (lastLow && !lastLow.broken && close < lastLow.price) {
    lastLow.broken = true;
    const kind = tracker.trend === 1 ? "CHoCH" : "BOS";
    tracker.trend = -1;
    return { kind, dir: "bear", level: lastLow.price, fromIdx: lastLow.idx, idx: t };
  }
  return undefined;
}

/** Last opposite-colour candle before the impulse that broke structure. */
function findOriginBar(bars: Bar[], brk: StructureBreak): number | undefined {
  for (let i = brk.idx - 1; i >= brk.fromIdx; i--) {
    const isBearishCandle = bars[i].c < bars[i].o;
    if (brk.dir === "bull" ? isBearishCandle : bars[i].c > bars[i].o) return i;
  }
  return undefined;
}

function resolveBlockEnd(bars: Bar[], block: OrderBlock, afterIdx: number): OrderBlock {
  const lastIdx = Math.min(bars.length - 1, block.start + OB_EXPIRE_BARS);
  for (let i = afterIdx + 1; i <= lastIdx; i++) {
    const isThrough = block.dir === "bull" ? bars[i].c < block.lo : bars[i].c > block.hi;
    if (isThrough) return { ...block, end: i, isMitigated: true };
  }
  const isExpired = block.start + OB_EXPIRE_BARS < bars.length;
  return isExpired ? { ...block, end: block.start + OB_EXPIRE_BARS } : block;
}

/** Order blocks behind each structure break, with mitigation (close through) and expiry resolved. */
export function findOrderBlocks(bars: Bar[], breaks: StructureBreak[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  for (const brk of breaks) {
    const origin = findOriginBar(bars, brk);
    if (origin === undefined) continue;
    const block: OrderBlock = { dir: brk.dir, lo: bars[origin].l, hi: bars[origin].h, start: origin, isMitigated: false };
    blocks.push(resolveBlockEnd(bars, block, brk.idx));
  }
  return blocks.slice(-MAX_BLOCKS);
}

const isBeyond = (bar: Bar, kind: Swing["kind"], price: number): boolean =>
  kind === "high" ? bar.h > price : bar.l < price;

function firstWickThrough(bars: Bar[], kind: Swing["kind"], price: number, afterIdx: number): number | undefined {
  for (let i = afterIdx + 1; i < bars.length; i++) if (isBeyond(bars[i], kind, price)) return i;
  return undefined;
}

/** Pairs of same-side swings resting at nearly the same price, with the first wick through them. */
export function findLiquidityPools(bars: Bar[], swings: Swing[]): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  for (let b = 1; b < swings.length; b++) {
    const later = swings[b];
    const earlier = swings.slice(0, b).reverse()
      .find((s) => s.kind === later.kind && later.idx - s.idx <= EQUAL_LEVEL_MAX_SPAN_BARS
        && Math.abs(s.price - later.price) <= later.price * EQUAL_LEVEL_TOLERANCE);
    if (!earlier) continue;
    // The outer of the two levels: stops sit just beyond it, so a wick past the inner one is not yet a sweep.
    const price = later.kind === "high" ? Math.max(earlier.price, later.price) : Math.min(earlier.price, later.price);
    const sweptAt = firstWickThrough(bars, later.kind, price, later.idx);
    pools.push({ kind: later.kind === "high" ? "EQH" : "EQL", price, fromIdx: earlier.idx, toIdx: later.idx, sweptAt });
  }
  return pools.slice(-MAX_POOLS);
}

function hasRealWick(bar: Bar, kind: Swing["kind"], level: number): boolean {
  const range = bar.h - bar.l;
  const wick = kind === "high" ? bar.h - level : level - bar.l;
  return range > 0 && wick / range >= SWEEP_MIN_WICK_FRACTION;
}

/** First wick through each swing level that closes back inside it. A close through is a break, not a sweep. */
export function findSweeps(bars: Bar[], swings: Swing[]): Sweep[] {
  const sweeps: Sweep[] = [];
  for (const swing of swings) {
    const touched = firstWickThrough(bars, swing.kind, swing.price, swing.idx + SWING_LEN);
    if (touched === undefined) continue;
    const closedBack = swing.kind === "high" ? bars[touched].c < swing.price : bars[touched].c > swing.price;
    if (!closedBack || !hasRealWick(bars[touched], swing.kind, swing.price)) continue;
    sweeps.push({ dir: swing.kind === "high" ? "bear" : "bull", level: swing.price, fromIdx: swing.idx, idx: touched });
  }
  return sweeps.sort((a, b) => a.idx - b.idx).slice(-MAX_SWEEPS);
}

export function findDealingRange(swings: Swing[]): DealingRange | undefined {
  const hi = swings.findLast((s) => s.kind === "high");
  const lo = swings.findLast((s) => s.kind === "low");
  if (!hi || !lo || hi.price <= lo.price) return undefined;
  return { hi: hi.price, lo: lo.price, mid: (hi.price + lo.price) / 2, fromIdx: Math.min(hi.idx, lo.idx) };
}

export function findDailyLevels(bars: Bar[]): DailyLevels | undefined {
  const last = bars.at(-1);
  if (!last) return undefined;
  const today = Math.floor(last.t / DAY_MS);
  let fromIdx = bars.length - 1;
  while (fromIdx > 0 && Math.floor(bars[fromIdx - 1].t / DAY_MS) === today) fromIdx--;
  if (fromIdx === 0) return undefined;
  const previousDay = Math.floor(bars[fromIdx - 1].t / DAY_MS);
  let pdh = -Infinity;
  let pdl = Infinity;
  for (let i = fromIdx - 1; i >= 0 && Math.floor(bars[i].t / DAY_MS) === previousDay; i--) {
    pdh = Math.max(pdh, bars[i].h);
    pdl = Math.min(pdl, bars[i].l);
  }
  return { pdh, pdl, fromIdx };
}

/** Swing pivots with HH/HL/LH/LL labels and close-confirmed BOS/CHoCH breaks over confirmed bars. */
export function analyzeStructure(bars: Bar[]): SmcAnalysis {
  const swings: Swing[] = [];
  const breaks: StructureBreak[] = [];
  const tracker: Tracker = { trend: 0 };
  for (let t = 0; t < bars.length; t++) {
    registerPivots(bars, t, tracker, swings);
    const found = detectBreak(bars[t].c, t, tracker);
    if (found) breaks.push(found);
  }
  return {
    swings, breaks, blocks: findOrderBlocks(bars, breaks),
    pools: findLiquidityPools(bars, swings), sweeps: findSweeps(bars, swings),
    range: findDealingRange(swings), daily: findDailyLevels(bars),
  };
}

let cache: { bars: Bar[]; count: number; result: SmcAnalysis } | undefined;

/** Analysis of the first `count` (confirmed) bars, recomputed only when the bar list or count changes. */
export function analyzeSmc(bars: Bar[], count: number): SmcAnalysis {
  if (cache && cache.bars === bars && cache.count === count) return cache.result;
  const result = analyzeStructure(bars.slice(0, count));
  cache = { bars, count, result };
  return result;
}
