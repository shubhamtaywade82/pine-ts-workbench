/**
 * TradingView "Technical Ratings" rules, per its help-center article
 * (https://www.tradingview.com/support/solutions/43000614331-technical-ratings/).
 * Each rule maps an indicator's current and previous values to buy (+1),
 * sell (-1) or neutral (0); na inputs are neutral.
 *
 * The article leaves "uptrend"/"downtrend" (Stochastic RSI, Bull Bear Power)
 * undefined; here an uptrend is close above its SMA(50). That is an
 * assumption, not TradingView's documented definition.
 */

export type Action = 1 | 0 | -1;

/** Current and previous bar values of one series. */
export interface Pair {
  readonly now: number;
  readonly prev: number;
}

const isNa = (...values: number[]): boolean => values.some((v) => !Number.isFinite(v));
const act = (isBuy: boolean, isSell: boolean): Action => (isBuy ? 1 : isSell ? -1 : 0);

export const rateRsi = ({ now, prev }: Pair): Action =>
  isNa(now, prev) ? 0 : act(now < 30 && now > prev, now > 70 && now < prev);

export const rateStochastic = (k: number, d: number): Action =>
  isNa(k, d) ? 0 : act(k < 20 && d < 20 && k > d, k > 80 && d > 80 && k < d);

export const rateCci = ({ now, prev }: Pair): Action =>
  isNa(now, prev) ? 0 : act(now < -100 && now > prev, now > 100 && now < prev);

export const rateAdx = (adx: Pair, plusDi: number, minusDi: number): Action => {
  if (isNa(adx.now, adx.prev, plusDi, minusDi)) return 0;
  return act(plusDi > minusDi && adx.now > 20 && adx.now > adx.prev, plusDi < minusDi && adx.now > 20 && adx.now < adx.prev);
};

/** Crosses zero, or stayed on one side of zero for two bars and turned that way. */
export const rateAwesome = (now: number, prev: number, prev2: number): Action => {
  if (isNa(now, prev, prev2)) return 0;
  const isBuy = (prev <= 0 && now > 0) || (now > 0 && prev > 0 && now > prev && prev < prev2);
  const isSell = (prev >= 0 && now < 0) || (now < 0 && prev < 0 && now < prev && prev > prev2);
  return act(isBuy, isSell);
};

export const rateMomentum = ({ now, prev }: Pair): Action => (isNa(now, prev) ? 0 : act(now > prev, now < prev));

export const rateMacd = (macd: number, signal: number): Action => (isNa(macd, signal) ? 0 : act(macd > signal, macd < signal));

export const rateStochRsi = (k: number, d: number, isUptrend: boolean): Action =>
  isNa(k, d) ? 0 : act(!isUptrend && k < 20 && d < 20 && k > d, isUptrend && k > 80 && d > 80 && k < d);

export const rateWilliams = ({ now, prev }: Pair): Action =>
  isNa(now, prev) ? 0 : act(now < -80 && now > prev, now > -20 && now < prev);

export const rateBullBear = (bear: Pair, bull: Pair, isUptrend: boolean): Action => {
  if (isNa(bear.now, bear.prev, bull.now, bull.prev)) return 0;
  return act(isUptrend && bear.now < 0 && bear.now > bear.prev, !isUptrend && bull.now > 0 && bull.now < bull.prev);
};

export const rateUltimate = (uo: number): Action => (isNa(uo) ? 0 : act(uo > 70, uo < 30));

/** MAs and filters: buy when the average is below price. */
export const rateMovingAverage = (average: number, close: number): Action =>
  isNa(average, close) ? 0 : act(average < close, average > close);

export interface IchimokuLines {
  readonly conversion: number;
  readonly base: number;
  readonly leadA: number;
  readonly leadB: number;
}

export const rateIchimoku = ({ conversion, base, leadA, leadB }: IchimokuLines, close: number): Action => {
  if (isNa(conversion, base, leadA, leadB, close)) return 0;
  return act(
    leadA > leadB && base > leadA && conversion > base && close > conversion,
    leadA < leadB && base < leadA && conversion < base && close < conversion,
  );
};

export type Rating = "Strong Sell" | "Sell" | "Neutral" | "Buy" | "Strong Buy";

/** The article's bands: below -0.5 strong sell, to -0.1 sell, to 0.1 neutral, to 0.5 buy, above strong buy. */
export const toRating = (score: number): Rating => {
  if (score < -0.5) return "Strong Sell";
  if (score < -0.1) return "Sell";
  if (score <= 0.1) return "Neutral";
  if (score <= 0.5) return "Buy";
  return "Strong Buy";
};

export const averageAction = (actions: readonly Action[]): number =>
  actions.length === 0 ? 0 : actions.reduce<number>((total, a) => total + a, 0) / actions.length;
