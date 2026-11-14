import { groupByDay, IST_OFFSET_MS, type DayStats, type RollingRow } from "./rolling-options";

/**
 * How options behaved, measured from the rolling history rather than from a pricing model: how the underlying's
 * own volatility compared with the IV options charged, how premium responded to the underlying and to time,
 * and how all of it changed through an expiry cycle.
 */

const TRADING_DAYS_PER_YEAR = 252;
const MINUTES_PER_HOUR = 60;

export interface DailyBar { readonly time: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number }

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);
const istDate = (time: number): string => new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Annualized close-to-close volatility over the trailing `window` days, in percent, keyed by IST date. */
export const realizedVolatility = (bars: readonly DailyBar[], window = 20): Map<string, number> => {
  const out = new Map<string, number>();
  const returns = bars.slice(1).map((bar, i) => Math.log(bar.close / bars[i]!.close));
  for (let i = window - 1; i < returns.length; i += 1) {
    const slice = returns.slice(i - window + 1, i + 1);
    const average = mean(slice);
    const variance = slice.reduce((s, r) => s + (r - average) ** 2, 0) / (slice.length - 1);
    out.set(istDate(bars[i + 1]!.time), Math.sqrt(variance * TRADING_DAYS_PER_YEAR) * 100);
  }
  return out;
};

export interface IvVsRealized {
  readonly points: readonly { readonly date: string; readonly iv: number; readonly rv: number }[];
  /** Average IV minus realized volatility: positive means options charged more than the market then moved. */
  readonly averageSpread: number;
}

/** Each loaded day's opening ATM IV beside the underlying's realized volatility that day. Expiry days are skipped. */
export const ivVsRealized = (days: readonly DayStats[], rv: ReadonlyMap<string, number>): IvVsRealized => {
  const points = days.flatMap((d) => {
    const realized = rv.get(d.date);
    return d.isExpiryDay || realized === undefined ? [] : [{ date: d.date, iv: d.ivOpen, rv: realized }];
  });
  return { points, averageSpread: mean(points.map((p) => p.iv - p.rv)) };
};

export interface IvReaction {
  readonly upDays: number;
  readonly downDays: number;
  /** Average change in ATM IV from open to close, in IV points. */
  readonly ivChangeOnUpDays: number;
  readonly ivChangeOnDownDays: number;
  /** Correlation of the day's underlying return with its IV change: negative means IV rises as the market falls. */
  readonly correlation: number;
}

const correlation = (xs: readonly number[], ys: readonly number[]): number => {
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0; let vx = 0; let vy = 0;
  xs.forEach((x, i) => { cov += (x - mx) * (ys[i]! - my); vx += (x - mx) ** 2; vy += (ys[i]! - my) ** 2; });
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
};

/** How IV moved with the underlying over ordinary days: on up days, on down days, and as a correlation. */
export const ivReaction = (days: readonly DayStats[]): IvReaction => {
  const ordinary = days.filter((d) => !d.isExpiryDay);
  const up = ordinary.filter((d) => d.spotClose > d.spotOpen);
  const down = ordinary.filter((d) => d.spotClose < d.spotOpen);
  const change = (d: DayStats): number => d.ivClose - d.ivOpen;
  return {
    upDays: up.length,
    downDays: down.length,
    ivChangeOnUpDays: mean(up.map(change)),
    ivChangeOnDownDays: mean(down.map(change)),
    correlation: correlation(ordinary.map((d) => (d.spotClose - d.spotOpen) / d.spotOpen), ordinary.map(change)),
  };
};

export interface Sensitivity {
  /** Premium change for a 1% move in the underlying: the measured delta, in premium points. */
  readonly perOnePercent: number;
  /** Premium change per hour with the underlying unchanged: the measured time decay. */
  readonly perHour: number;
  /** How much of the premium's movement the underlying explains, 0 to 1. */
  readonly fit: number;
  readonly samples: number;
}

export interface SensitivityReport { readonly call: Sensitivity; readonly put: Sensitivity; readonly straddle: Sensitivity }

/** Least squares of y on x with an intercept. */
const regress = (xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number; fit: number } => {
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0; let vx = 0; let vy = 0;
  xs.forEach((x, i) => { cov += (x - mx) * (ys[i]! - my); vx += (x - mx) ** 2; vy += (ys[i]! - my) ** 2; });
  const slope = vx === 0 ? 0 : cov / vx;
  return { slope, intercept: my - slope * mx, fit: vx === 0 || vy === 0 ? 0 : (cov * cov) / (vx * vy) };
};

const medianGapMinutes = (rows: readonly RollingRow[]): number => {
  const gaps = rows.slice(1).map((r, i) => (r.time - rows[i]!.time) / 60_000).filter((g) => g > 0).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 1;
};

/**
 * Measured from consecutive bars on ordinary days where neither strike rolled, so each pair is one contract:
 * premium change = decay + sensitivity × underlying change. Expiry days are left out; their decay is different.
 */
export const measureSensitivity = (rows: readonly RollingRow[], expiryDates: ReadonlySet<string>): SensitivityReport => {
  const spot: number[] = []; const call: number[] = []; const put: number[] = []; const level: number[] = [];
  for (const day of groupByDay(rows)) {
    if (day[0] === undefined || expiryDates.has(istDate(day[0].time))) continue;
    for (let i = 1; i < day.length; i += 1) {
      const [a, b] = [day[i - 1]!, day[i]!];
      if (a.ce.strike !== b.ce.strike || a.pe.strike !== b.pe.strike) continue;
      spot.push(b.spot - a.spot); call.push(b.ce.close - a.ce.close); put.push(b.pe.close - a.pe.close); level.push(a.spot);
    }
  }
  const barsPerHour = MINUTES_PER_HOUR / medianGapMinutes(rows);
  const onePercent = mean(level) / 100;
  const of = (ys: readonly number[]): Sensitivity => {
    const { slope, intercept, fit } = regress(spot, ys);
    return { perOnePercent: slope * onePercent, perHour: intercept * barsPerHour, fit, samples: ys.length };
  };
  return { call: of(call), put: of(put), straddle: of(call.map((c, i) => c + put[i]!)) };
};

export interface DteGroup {
  /** Trading days until the next expiry in the data; 0 is expiry day. */
  readonly dte: number;
  readonly days: number;
  /** Opening straddle as a share of spot, in percent: what a move to breakeven costs. */
  readonly straddlePct: number;
  readonly premiumChangePct: number;
  readonly ivOpen: number;
  readonly moveRatio: number;
}

/**
 * Groups days by trading days to the next expiry seen in the data. Days after the last expiry in the range have
 * no known distance, so they are left out rather than guessed.
 */
export const byDaysToExpiry = (days: readonly DayStats[]): DteGroup[] => {
  const groups = new Map<number, DayStats[]>();
  days.forEach((day, i) => {
    const next = days.findIndex((d, j) => j >= i && d.isExpiryDay);
    if (next < 0) return;
    const dte = next - i;
    groups.set(dte, [...(groups.get(dte) ?? []), day]);
  });
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([dte, these]) => ({
    dte,
    days: these.length,
    straddlePct: mean(these.map((d) => (d.premiumOpen / d.spotOpen) * 100)),
    premiumChangePct: mean(these.map((d) => d.premiumChangePct)),
    ivOpen: mean(these.map((d) => d.ivOpen)),
    moveRatio: mean(these.map((d) => d.moveRatio)),
  }));
};
