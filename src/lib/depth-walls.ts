import type { BookCoverage, BookSide } from "./order-book";

/**
 * Liquidity walls: the price level with the largest resting quote notional
 * (price × quantity) on each side, inside a window around mid. This is not the
 * best bid/ask, and quote notional keeps sizes comparable across markets.
 *
 * A wall is displayed liquidity, not traded volume: it can be pulled or
 * refilled at any time. `observedSince` is when this client began observing
 * the wall at its price without interruption. It is not the order's age: a
 * public depth feed does not expose when an order was placed.
 */

export const DEFAULT_WALL_WINDOW_PCT = 0.5;
/** Bounds of the configurable window. A window wider than the snapshot covers is clipped, not rejected. */
export const WALL_WINDOW_LIMITS_PCT = { min: 0.05, max: 5 } as const;
export const DEFAULT_MIN_WALL_NOTIONAL = 0;
export const DEFAULT_TOP_WALLS = 5;
const SWITCH_MARGIN_PCT = 15;
// Float tolerance when comparing the searched window with the configured one.
const WINDOW_EPSILON_PCT = 1e-9;

/** Read-only view of a synced order book. */
export interface BookView {
  readonly bestBid: number | undefined;
  readonly bestAsk: number | undefined;
  readonly coverage: BookCoverage;
  /** `[price, quantity]`, best first. */
  levels(side: BookSide): Iterable<readonly [number, number]>;
}

export type LiquidityStatus =
  | "holding"
  | "reduced"
  | "removed"
  | "stacking"
  | "tested"
  | "pulled";

export interface Wall {
  readonly side: BookSide;
  readonly price: number;
  readonly quantity: number;
  /** price × quantity, in the market's quote asset. */
  readonly notional: number;
  /** When this client began continuously observing the wall at `price` (ms). */
  readonly observedSince: number;
  /** Peak resting notional observed during this level's observation. */
  readonly peakNotional?: number;
  /** Initial notional when this level was first detected. */
  readonly initialNotional?: number;
  /** Real-time liquidity behavior status. */
  readonly status?: LiquidityStatus;
  /** Percentage change from peak (when reduced) or initial (when stacking). */
  readonly changePct?: number;
}

export interface WallOptions {
  /** Half-width of the detection window around mid, in percent. */
  readonly windowPct: number;
  /** Minimum notional, in the market's quote asset. Smaller levels are not walls. */
  readonly minNotional: number;
  /** A challenger must exceed the current wall's notional by this % to replace it. */
  readonly switchMarginPct: number;
  /** How many levels `bids` / `asks` keep. `bid` / `ask` stay the single hysteresis wall. */
  readonly topN: number;
}

export const wallOptionsFor = (windowPct: number, minNotional: number, topN = DEFAULT_TOP_WALLS): WallOptions => ({
  windowPct,
  minNotional,
  switchMarginPct: SWITCH_MARGIN_PCT,
  topN,
});

export const DEFAULT_WALL_OPTIONS = wallOptionsFor(DEFAULT_WALL_WINDOW_PCT, DEFAULT_MIN_WALL_NOTIONAL);

export interface WallFrame {
  readonly mid: number;
  readonly bestBid?: number;
  readonly bestAsk?: number;
  readonly bid: Wall | undefined;
  readonly ask: Wall | undefined;
  /** Largest notionals inside the window. Independent of the hysteresis pick in `bid` / `ask`. */
  readonly bids: readonly Wall[];
  readonly asks: readonly Wall[];
  /** The window actually searched: the configured one, narrowed to verified snapshot coverage. */
  readonly searchedPct: number;
  /** Coverage is narrower than the configured window, so some levels were not searched. */
  readonly clippedByCoverage: boolean;
}

interface Level {
  readonly price: number;
  readonly quantity: number;
  readonly notional: number;
}

interface CurrentWalls {
  bid?: Wall;
  ask?: Wall;
}

export class WallTracker {
  private current: CurrentWalls = {};
  private ranked: { bid: Map<number, Wall>; ask: Map<number, Wall> } = { bid: new Map(), ask: new Map() };

  public constructor(private options: WallOptions) {}

  public setOptions(options: WallOptions): void {
    this.options = options;
  }

  /**
   * Recomputes both walls from `book`. Prices are only searched inside the
   * snapshot's verified coverage, whatever the configured window. Undefined
   * until both sides have a price.
   */
  public update(book: BookView, now: number): WallFrame | undefined {
    const { bestBid, bestAsk, coverage } = book;
    if (bestBid === undefined || bestAsk === undefined) return undefined;
    const mid = (bestBid + bestAsk) / 2;
    const distance = this.options.windowPct / 100;
    const bidLow = Math.max(mid * (1 - distance), coverage.bidFloor);
    const askHigh = Math.min(mid * (1 + distance), coverage.askCeiling);

    const bidLevels = levelsWithin(book.levels("bid"), bidLow, Number.POSITIVE_INFINITY);
    const askLevels = levelsWithin(book.levels("ask"), 0, askHigh);
    const bid = this.next("bid", bidLevels, now, mid);
    const ask = this.next("ask", askLevels, now, mid);
    this.current = { bid, ask };
    const searchedPct = Math.max(0, Math.min((mid - bidLow) / mid, (askHigh - mid) / mid)) * 100;
    return {
      mid, bestBid, bestAsk, bid, ask,
      bids: this.listed("bid", bidLevels, now, mid),
      asks: this.listed("ask", askLevels, now, mid),
      searchedPct,
      clippedByCoverage: searchedPct < this.options.windowPct - WINDOW_EPSILON_PCT,
    };
  }

  /** Forgets the walls. The next observation of any level starts a new `observedSince`. */
  public reset(): void {
    this.current = {};
    this.ranked = { bid: new Map(), ask: new Map() };
  }

  /** Hysteresis: keep the incumbent unless it is gone or clearly beaten, so near-equal levels don't flicker. */
  private next(side: BookSide, levels: readonly Level[], now: number, mid: number): Wall | undefined {
    const eligible = levels.filter((level) => level.notional >= this.options.minNotional);
    const strongest = eligible.reduce<Level | undefined>(
      (best, level) => (best === undefined || level.notional > best.notional ? level : best),
      undefined,
    );
    if (strongest === undefined) return undefined;

    const incumbent = this.current[side];
    const held = incumbent === undefined ? undefined : eligible.find((level) => level.price === incumbent.price);
    if (incumbent !== undefined && held !== undefined) {
      const beaten = strongest.notional > held.notional * (1 + this.options.switchMarginPct / 100);
      if (!beaten) return this.evolveWall(side, held, incumbent, mid);
    }
    const sameLevel = incumbent !== undefined && incumbent.price === strongest.price;
    if (sameLevel && incumbent !== undefined) {
      return this.evolveWall(side, strongest, incumbent, mid);
    }
    return freshWall(side, strongest, now);
  }

  private listed(side: BookSide, levels: readonly Level[], now: number, mid: number): Wall[] {
    const eligible = levels.filter((level) => level.notional >= this.options.minNotional);
    const prior = this.ranked[side];
    const walls = topWalls(eligible, this.options.topN, mid).map((level) =>
      this.wallAt(side, level, prior.get(level.price), { now, mid }));
    this.ranked[side] = new Map(walls.map((wall) => [wall.price, wall]));
    return walls;
  }

  private wallAt(side: BookSide, level: Level, prior: Wall | undefined, clock: { now: number; mid: number }): Wall {
    if (prior === undefined) return freshWall(side, level, clock.now);
    return this.evolveWall(side, level, prior, clock.mid);
  }

  private evolveWall(side: BookSide, level: Level, incumbent: Wall, mid: number): Wall {
    const peak = Math.max(incumbent.peakNotional ?? incumbent.notional, level.notional);
    const initial = incumbent.initialNotional ?? incumbent.notional;
    const isNearMid = Math.abs(mid - level.price) / mid <= 0.001;
    const { status, changePct } = deriveLiquidityStatus(level.notional, peak, initial, isNearMid);
    return {
      side,
      ...level,
      observedSince: incumbent.observedSince,
      peakNotional: peak,
      initialNotional: initial,
      status,
      changePct,
    };
  }
}

/** Classifies resting-size change. A drop is reduced or removed, never a proven fill. */
export const deriveLiquidityStatus = (
  currentNotional: number,
  peakNotional: number,
  initialNotional: number,
  isNearMid: boolean,
): { status: LiquidityStatus; changePct: number } => {
  if (peakNotional > 0 && currentNotional <= peakNotional * 0.25) {
    return { status: "removed", changePct: ((currentNotional - peakNotional) / peakNotional) * 100 };
  }
  if (peakNotional > 0 && currentNotional <= peakNotional * 0.85) {
    return { status: "reduced", changePct: ((currentNotional - peakNotional) / peakNotional) * 100 };
  }
  if (initialNotional > 0 && currentNotional >= initialNotional * 1.15) {
    return { status: "stacking", changePct: ((currentNotional - initialNotional) / initialNotional) * 100 };
  }
  if (isNearMid) return { status: "tested", changePct: 0 };
  return { status: "holding", changePct: 0 };
};

const freshWall = (side: BookSide, level: Level, now: number): Wall => ({
  side,
  ...level,
  observedSince: now,
  peakNotional: level.notional,
  initialNotional: level.notional,
  status: "holding",
  changePct: 0,
});

const byNotional = (mid: number) => (a: { price: number; notional: number }, b: { price: number; notional: number }): number => {
  if (a.notional !== b.notional) return b.notional - a.notional;
  const byDistance = Math.abs(a.price - mid) - Math.abs(b.price - mid);
  return byDistance !== 0 ? byDistance : a.price - b.price;
};

/** `mid` is the book mid: a level does not know which price the tie should prefer. */
export const topWalls = <T extends { price: number; notional: number }>(
  levels: readonly T[],
  count: number,
  mid: number,
): T[] => (count > 0 ? [...levels].sort(byNotional(mid)).slice(0, count) : []);

const levelsWithin = (levels: Iterable<readonly [number, number]>, low: number, high: number): Level[] => {
  const within: Level[] = [];
  for (const [price, quantity] of levels) {
    if (price >= low && price <= high) within.push({ price, quantity, notional: price * quantity });
  }
  return within;
};

/**
 * Bubble radius on a bounded square-root scale: area tracks notional, and one
 * outsized wall can't cover the chart.
 */
export const bubbleRadius = (notional: number, reference: number, range: { readonly min: number; readonly max: number }): number => {
  if (!(reference > 0)) return range.min;
  const ratio = Math.min(1, Math.max(0, notional / reference));
  return range.min + (range.max - range.min) * Math.sqrt(ratio);
};

/**
 * The size reference: jumps to a new peak at once, otherwise decays with a
 * half-life, so a shrinking wall visibly shrinks instead of staying max-size.
 */
export const decayedReference = (previous: number, current: number, elapsedMs: number, halfLifeMs: number): number =>
  Math.max(current, previous * 0.5 ** (Math.max(0, elapsedMs) / halfLifeMs));
