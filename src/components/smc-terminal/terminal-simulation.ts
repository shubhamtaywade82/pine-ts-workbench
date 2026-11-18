import {
  BASE_BIN, MAX_BARS, NORMAL, SEEDS, SESSION_BARS, START_PLAY, TF_MS,
  type Bar, type BigWall, type FvgZone, type MarketEvent,
} from "./terminal-types";

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function createRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationState {
  seedIdx: number;
  seed: number;
  tf: number;
  rng: () => number;
  bars: Bar[];
  snaps: [number, number][][];
  bigsSnap: BigWall[][];
  events: MarketEvent[];
  zones: FvgZone[];
  book: Map<number, number>;
  bigs: Map<number, { born: number; side: "bid" | "ask" }>;
  playhead: number;
  startTime: number;
  tick: number;
  /** Live mode only: eased on-screen price of the forming candle. */
  shown?: number;
}

function getRegime(i: number, tf: number, lastClose: number): { d: number; v: number } {
  const sc = Math.sqrt(tf / 5);
  if (i < 55) return { d: -0.048 * sc, v: 0.09 * sc };
  if (i < 80) return { d: 0.022 * sc, v: 0.07 * sc };
  if (i < 125) return { d: -0.012 * sc, v: 0.06 * sc };
  if (i < 185) return { d: 0.018 * sc, v: 0.07 * sc };
  if (i < SESSION_BARS) return { d: -0.008 * sc, v: 0.055 * sc };
  return { d: (72.4 - lastClose) * 0.02 + Math.sin(i * 0.7) * 0.01, v: 0.06 * sc };
}

export function buildIntraBarPath(
  bar: { o: number; c: number; h: number; l: number }, vol: number = 0.2, rng: () => number = Math.random,
): number[] {
  const { o, c, h, l } = bar;
  const ph = 2 + Math.floor(rng() * 4);
  const pl = 6 + Math.floor(rng() * 4);
  const path: number[] = [];
  const snap = (p: number) => Math.round(p * 20) / 20;
  for (let k = 0; k < 12; k++) {
    let p = lerp(o, c, k / 11);
    if (k === ph) p = h;
    else if (k === pl) p = l;
    else if (k > 0 && k < 11) p += (rng() - 0.5) * vol * 0.5;
    path.push(snap(clamp(p, l, h)));
  }
  path[0] = o;
  path[11] = c;
  return path;
}

function createBar(i: number, state: SimulationState): Bar {
  const snap = (p: number) => Math.round(p * 20) / 20;
  const prev = state.bars.length > 0 ? state.bars[state.bars.length - 1].c : 74.42;
  const { d, v } = getRegime(i, state.tf, prev);
  const o = snap(prev);
  const c = snap(o + d + (state.rng() * 2 - 1) * v + Math.sin(i * 0.35) * v * 0.25);
  const h = snap(Math.max(o, c) + state.rng() * v * 0.9);
  const l = snap(Math.min(o, c) - state.rng() * v * 0.9);
  const vol = 9000 * (0.5 + state.rng() * 1.6) * (1 + 2 * Math.abs(c - o) / v);
  const buyR = clamp(0.5 + (c - o) / (v * 2) * 0.4 + (state.rng() - 0.5) * 0.2, 0.1, 0.9);
  return {
    t: state.startTime + i * TF_MS[state.tf], o, h, l, c, v: vol, buyR,
    path: buildIntraBarPath({ o, c, h, l }, v, state.rng),
  };
}

function updateOrderBook(state: SimulationState, mid: number): void {
  const { book, bigs, rng } = state;
  const lo = Math.round((mid - 2.6) / BASE_BIN);
  const hi = Math.round((mid + 2.6) / BASE_BIN);
  for (const idx of [...book.keys()]) {
    const p = idx * BASE_BIN;
    if (p < mid - 3 || p > mid + 3) { book.delete(idx); bigs.delete(idx); }
  }
  for (let idx = lo; idx <= hi; idx++) {
    const p = idx * BASE_BIN;
    const isRound = Math.abs(p % 0.5) < 0.001 || Math.abs(p % 0.5 - 0.5) < 0.001;
    if (!book.has(idx)) {
      if (rng() < 0.85) book.set(idx, NORMAL * (0.25 + rng() * 1.1) * (isRound ? 1.5 : 1));
    } else {
      let s = (book.get(idx) ?? 0) * (0.86 + rng() * 0.28);
      if (!bigs.has(idx) && rng() < 0.015) s = 0;
      if (s > 2) book.set(idx, s);
      else book.delete(idx);
    }
  }
}

function spawnWall(state: SimulationState, i: number, mid: number): void {
  if (state.rng() >= 0.13) return;
  const side = state.rng() < 0.5 ? "bid" : "ask";
  const dist = 0.15 + state.rng() * 0.85;
  const price = Math.round((mid + (side === "bid" ? -dist : dist)) / BASE_BIN) * BASE_BIN;
  const idx = Math.round(price / BASE_BIN);
  if (!state.bigs.has(idx)) {
    const size = NORMAL * (4 + state.rng() * 8);
    state.book.set(idx, size);
    state.bigs.set(idx, { born: i, side });
    state.events.push({ bar: i, type: "wall", price, size, side });
  }
}

function processWallEvents(state: SimulationState, i: number, bar: Bar): void {
  for (const [idx, meta] of [...state.bigs.entries()]) {
    const p = idx * BASE_BIN;
    const size = state.book.get(idx) || 0;
    const touched = meta.side === "ask" ? bar.h >= p : bar.l <= p;
    const near = Math.abs(p - bar.c) < 0.12;
    if (i - meta.born > 70 && !touched) {
      state.bigs.delete(idx); state.book.delete(idx);
      continue;
    }
    if (!touched && !near) continue;
    const r = state.rng();
    if (r < 0.45) {
      state.events.push({ bar: i, type: "pull", price: p, size, side: meta.side });
      state.bigs.delete(idx); state.book.delete(idx);
    } else if (touched) {
      if (r < 0.75) {
        const ns = size * 0.45;
        state.events.push({ bar: i, type: "held", price: p, size, side: meta.side });
        if (ns < NORMAL * 1.8) { state.bigs.delete(idx); state.book.delete(idx); }
        else state.book.set(idx, ns);
      } else {
        state.events.push({ bar: i, type: "brk", price: p, size, side: meta.side });
        state.bigs.delete(idx); state.book.delete(idx);
      }
    }
  }
}

function updateFvg(state: SimulationState, i: number, bar: Bar): void {
  if (i >= 2) {
    const prev2 = state.bars[i - 2];
    if (bar.l - prev2.h > 0.055) state.zones.push({ lo: prev2.h, hi: bar.l, start: i, side: "bull", filled: null });
    if (prev2.l - bar.h > 0.055) state.zones.push({ lo: bar.h, hi: prev2.l, start: i, side: "bear", filled: null });
  }
  for (const z of state.zones) {
    if (z.filled === null && z.start < i) {
      if (z.side === "bull" && bar.l <= z.lo) z.filled = i;
      if (z.side === "bear" && bar.h >= z.hi) z.filled = i;
    }
  }
  if (state.zones.length > 80) {
    state.zones.splice(0, state.zones.length - 80);
  }
}

export function stepBar(state: SimulationState, i: number): void {
  const bar = createBar(i, state);
  updateOrderBook(state, bar.c);
  spawnWall(state, i, bar.c);
  processWallEvents(state, i, bar);
  state.snaps[i] = [...state.book.entries()].filter((e) => e[1] > 2);
  state.bigsSnap[i] = [...state.bigs.entries()].map(([idx, m]) => ({
    idx, born: m.born, side: m.side, size: state.book.get(idx) || 0,
  }));
  updateFvg(state, i, bar);
  state.bars.push(bar);
}

export function ensureBars(state: SimulationState, count: number): void {
  const limit = Math.min(count, MAX_BARS - 1);
  while (state.bars.length <= limit) stepBar(state, state.bars.length);
}

export function syncOrderBookSnap(sim: SimulationState, book: Map<number, number>): void {
  const f = Math.floor(sim.playhead);
  const snapEntries = [...book.entries()].filter((e) => e[1] > 0);
  sim.snaps[f] = snapEntries;
  let total = 0;
  for (const [, size] of snapEntries) total += size;
  const avg = snapEntries.length > 0 ? total / snapEntries.length : NORMAL;
  const curP = sim.bars[f]?.c ?? 0;
  // Birth persists across polls so a rail starts where its wall first appeared, not at a fixed offset.
  const previous = sim.bigs;
  sim.bigs = new Map();
  sim.bigsSnap[f] = snapEntries
    .filter(([, s]) => s >= avg * 1.5)
    .map(([idx, size]) => {
      const side = idx * sim.tick < curP ? ("bid" as const) : ("ask" as const);
      const born = previous.get(idx)?.born ?? f;
      sim.bigs.set(idx, { born, side });
      return { idx, born, side, size };
    });
}

export function computeAllFvgZones(bars: Bar[], tick: number = BASE_BIN): FvgZone[] {
  const zones: FvgZone[] = [];
  for (let i = 2; i < bars.length; i++) {
    const b = bars[i];
    const p2 = bars[i - 2];
    if (b.l - p2.h > tick) zones.push({ lo: p2.h, hi: b.l, start: i, side: "bull", filled: null });
    if (p2.l - b.h > tick) zones.push({ lo: b.h, hi: p2.l, start: i, side: "bear", filled: null });
  }
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    for (const z of zones) {
      if (z.filled === null && z.start < i) {
        if (z.side === "bull" && b.l <= z.lo) z.filled = i;
        if (z.side === "bear" && b.h >= z.hi) z.filled = i;
      }
    }
  }
  return zones.slice(-80);
}

export function restoreSnapshot(state: SimulationState, frame: number): void {
  const f = clamp(frame, 0, state.bars.length - 1);
  state.book = new Map(state.snaps[f] || []);
  state.bigs = new Map((state.bigsSnap[f] || []).map((b) => [b.idx, { born: b.born, side: b.side }]));
}

export function buildSession(seedIdx: number, tf: number): SimulationState {
  const seed = SEEDS[seedIdx % SEEDS.length];
  const startTime = Math.floor(Date.now() / TF_MS[tf]) * TF_MS[tf] - SESSION_BARS * TF_MS[tf];
  const state: SimulationState = {
    seedIdx, seed, tf, rng: createRng(seed), bars: [], snaps: [], bigsSnap: [],
    events: [], zones: [], book: new Map(), bigs: new Map(), playhead: START_PLAY, startTime, tick: BASE_BIN,
  };
  ensureBars(state, SESSION_BARS - 1);
  state.playhead = START_PLAY;
  restoreSnapshot(state, START_PLAY);
  return state;
}

/** Number of ticks merged into one ladder bin; never below one tick. */
export const binTicks = (binSize: number, tick: number): number => Math.max(1, Math.round(binSize / tick));

export function aggregateOrderBook(snaps: [number, number][][], binSize: number, tick: number = BASE_BIN): Map<number, number>[] {
  const k = binTicks(binSize, tick);
  return snaps.map((snap) => {
    const map = new Map<number, number>();
    for (const [idx, s] of snap) {
      const ai = Math.round(idx / k);
      map.set(ai, (map.get(ai) || 0) + s);
    }
    return map;
  });
}

export interface UiState {
  curPrice: number;
  openPrice: number;
  tf: number;
  currentTime: number;
  playhead: number;
  totalBars: number;
  seed: number;
  seedIdx: number;
  curBar: Bar;
  sim: SimulationState;
}

export function makeUiState(sim: SimulationState): UiState {
  const f = Math.floor(sim.playhead);
  const curBar = sim.bars[Math.min(f, sim.bars.length - 1)] || sim.bars[0] || {
    t: 0, o: 74, h: 74, l: 74, c: 74, v: 0, buyR: 0.5, path: [74],
  };
  const curPrice = curBar.c;
  return {
    curPrice, openPrice: sim.bars[0]?.o ?? curPrice, tf: sim.tf,
    currentTime: curBar.t, playhead: sim.playhead, totalBars: sim.bars.length,
    seed: sim.seed, seedIdx: sim.seedIdx, curBar, sim: { ...sim },
  };
}

export function updatePriceBounds(
  v: { center: number; visible: number; tMinP: number; tMaxP: number; minP: number; maxP: number },
  sim: SimulationState,
  focus: { price: number; until: number } | null,
  k: number,
): void {
  const f = Math.floor(sim.playhead);
  const i0 = Math.max(0, Math.floor(v.center - v.visible / 2));
  const i1 = Math.min(f, sim.bars.length - 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    if (sim.bars[i]) { lo = Math.min(lo, sim.bars[i].l); hi = Math.max(hi, sim.bars[i].h); }
  }
  if (focus && performance.now() < focus.until) {
    lo = Math.min(lo, focus.price - 0.25);
    hi = Math.max(hi, focus.price + 0.25);
  }
  if (!isFinite(lo)) { lo = 71; hi = 74; }
  const pad = (hi - lo) * 0.08 + sim.tick;
  v.tMinP = Math.floor((lo - pad) / sim.tick) * sim.tick;
  v.tMaxP = Math.ceil((hi + pad) / sim.tick) * sim.tick;
  v.minP += (v.tMinP - v.minP) * k;
  v.maxP += (v.tMaxP - v.maxP) * k;
}
