import type { BookCoverage, BookSide } from "./order-book";

/**
 * Liquidity walls: the price level with the largest resting quote notional
 * (price × quantity) on each side, within a window around mid. This is not
 * the best bid/ask (the touch), and quote notional — not base quantity — makes
 * sizes comparable across BTC, ETH and SOL.
 *
 * A wall is displayed liquidity, not traded volume: it can be pulled or
 * refilled at any time, so `since` says how long it has persisted.
 */

/** Read-only view of a synced order book. */
export interface BookView {
  readonly bestBid: number | undefined;
  readonly bestAsk: number | undefined;
  readonly coverage: BookCoverage;
  /** `[price, quantity]`, best first. */
  levels(side: BookSide): Iterable<readonly [number, number]>;
}

export interface Wall {
  readonly side: BookSide;
  readonly price: number;
  readonly quantity: number;
  /** price × quantity, in the quote asset (USDT). */
  readonly notional: number;
  /** When this price became the side's wall (ms). */
  readonly since: number;
}

export interface WallOptions {
  /** Only levels within this % of mid count. */
  readonly maxDistancePct: number;
  /** Levels below this quote notional are not walls. */
  readonly minNotional: number;
  /** A challenger must exceed the current wall's notional by this % to replace it. */
  readonly switchMarginPct: number;
}

export interface WallFrame {
  readonly mid: number;
  readonly bid: Wall | undefined;
  readonly ask: Wall | undefined;
  /** The window reaches past the snapshot's known range: a fresh snapshot would widen it. */
  readonly windowExceedsCoverage: boolean;
}

interface Level {
  readonly price: number;
  readonly quantity: number;
  readonly notional: number;
}

export class WallTracker {
  private current: { bid: Wall | undefined; ask: Wall | undefined } = { bid: undefined, ask: undefined };

  public constructor(private readonly options: WallOptions) {}

  /** Recomputes both walls from `book`; undefined until both sides have a price. */
  public update(book: BookView, now: number): WallFrame | undefined {
    const { bestBid, bestAsk, coverage } = book;
    if (bestBid === undefined || bestAsk === undefined) return undefined;
    const mid = (bestBid + bestAsk) / 2;
    const distance = this.options.maxDistancePct / 100;
    const low = mid * (1 - distance);
    const high = mid * (1 + distance);

    const bidLevels = levelsWithin(book.levels("bid"), Math.max(low, coverage.bidFloor), Number.POSITIVE_INFINITY);
    const askLevels = levelsWithin(book.levels("ask"), 0, Math.min(high, coverage.askCeiling));
    this.current = {
      bid: this.next("bid", bidLevels, now),
      ask: this.next("ask", askLevels, now),
    };
    return {
      mid,
      ...this.current,
      windowExceedsCoverage: low < coverage.bidFloor || high > coverage.askCeiling,
    };
  }

  public reset(): void {
    this.current = { bid: undefined, ask: undefined };
  }

  /** Hysteresis: keep the incumbent unless it is gone or clearly beaten, so near-equal levels don't flicker. */
  private next(side: BookSide, levels: readonly Level[], now: number): Wall | undefined {
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
      if (!beaten) return { side, ...held, since: incumbent.since };
    }
    return { side, ...strongest, since: incumbent?.price === strongest.price ? incumbent.since : now };
  }
}

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
