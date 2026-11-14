import type { ChainAnalytics } from "./option-analytics";

/** A long option held to expiry: what it costs and what it is worth at each price of the underlying. */
export interface LongOption {
  readonly side: "call" | "put";
  readonly strike: number;
  /** What you pay, per unit (index points). */
  readonly premium: number;
}

export interface Target {
  readonly label: string;
  readonly price: number;
  /** Profit or loss per unit at expiry if the underlying finishes at `price`. */
  readonly pnl: number;
}

export interface PayoffSummary {
  readonly breakeven: number;
  /** Everything at risk, per unit: a long option cannot lose more than its premium. */
  readonly maxLoss: number;
  /** Points the underlying must move from spot to reach breakeven; positive means up. */
  readonly moveToBreakeven: number;
  readonly moveToBreakevenPct: number;
  /** Whether the straddle's expected move reaches breakeven: undefined without a straddle. */
  readonly isWithinExpectedMove: boolean | undefined;
  readonly targets: readonly Target[];
}

/** Profit or loss per unit at expiry if the underlying finishes at `price`. */
export const payoffAtExpiry = (option: LongOption, price: number): number =>
  Math.max(0, option.side === "call" ? price - option.strike : option.strike - price) - option.premium;

export const breakevenOf = (option: LongOption): number =>
  option.side === "call" ? option.strike + option.premium : option.strike - option.premium;

/** Evenly spaced points of the payoff for drawing. Needs at least two steps. */
export const payoffCurve = (option: LongOption, from: number, to: number, steps: number): { readonly price: number; readonly pnl: number }[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const price = from + ((to - from) * i) / steps;
    return { price, pnl: payoffAtExpiry(option, price) };
  });

/** The price range worth drawing: wide enough to show the strike, the breakeven and the expected move. */
export const payoffRange = (option: LongOption, spot: number, expectedMove: number | undefined): { readonly from: number; readonly to: number } => {
  const reach = Math.max(expectedMove ?? 0, Math.abs(breakevenOf(option) - spot), Math.abs(option.strike - spot)) * 1.4;
  const half = reach > 0 ? reach : spot * 0.02;
  return { from: spot - half, to: spot + half };
};

/**
 * The figures a buyer weighs: where it breaks even, how far that is, and what it pays at the levels the chain
 * points to. Targets only include prices on the side the option profits from, plus the expected-move edges.
 */
export const summarizePayoff = (option: LongOption, spot: number, analytics: ChainAnalytics, straddle: number | undefined): PayoffSummary => {
  const breakeven = breakevenOf(option);
  const move = breakeven - spot;
  const favourable = option.side === "call" ? analytics.resistances[0] : analytics.supports[0];
  const raw: readonly (readonly [string, number | undefined])[] = [
    [option.side === "call" ? "Call wall" : "Put wall", favourable?.strike],
    ["Upper edge of expected range", analytics.upperBreakeven],
    ["Lower edge of expected range", analytics.lowerBreakeven],
    ["+1σ to expiry", analytics.oneSigmaMove === undefined ? undefined : spot + analytics.oneSigmaMove],
    ["−1σ to expiry", analytics.oneSigmaMove === undefined ? undefined : spot - analytics.oneSigmaMove],
  ];
  const targets = raw.flatMap(([label, price]) => (price === undefined ? [] : [{ label, price, pnl: payoffAtExpiry(option, price) }]));
  return {
    breakeven,
    maxLoss: option.premium,
    moveToBreakeven: move,
    moveToBreakevenPct: (move / spot) * 100,
    isWithinExpectedMove: straddle === undefined ? undefined : Math.abs(move) <= straddle,
    targets,
  };
};
