/**
 * Expired option history from Dhan's rolling-option endpoint, read for a buyer: did each day move more than
 * its options priced, how fast did premium decay, and when in the session was it cheapest. "Rolling" means the
 * series follows whatever strike was at the money at each bar, so it is the ATM straddle's price, not one held
 * contract's: these are market measures, not a trade's P&L.
 */

export const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
const MARKET_OPEN_MINUTE = 9 * 60 + 15;
/** A day's 1-sigma move from an annual IV: trading days a year, the usual convention for daily moves. */
const TRADING_DAYS_PER_YEAR = 252;
export const PROFILE_BUCKET_MINUTES = 15;

export interface LegPoint { readonly strike: number; readonly close: number; readonly iv: number; readonly oi: number; readonly volume: number }

/** One bar with the call and put that were at their rolling strikes then. */
export interface RollingRow { readonly time: number; readonly spot: number; readonly ce: LegPoint; readonly pe: LegPoint }

/** Dhan's columnar answer for one side. */
export interface RawSide {
  readonly timestamp?: readonly number[];
  readonly close?: readonly number[];
  readonly iv?: readonly number[];
  readonly oi?: readonly number[];
  readonly volume?: readonly number[];
  readonly strike?: readonly number[];
  readonly spot?: readonly number[];
}

const legsByTime = (side: RawSide): Map<number, { leg: LegPoint; spot: number }> => {
  const out = new Map<number, { leg: LegPoint; spot: number }>();
  (side.timestamp ?? []).forEach((seconds, i) => {
    const close = side.close?.[i];
    const strike = side.strike?.[i];
    if (close === undefined || strike === undefined) return;
    out.set(seconds * 1000, {
      leg: { strike, close, iv: side.iv?.[i] ?? 0, oi: side.oi?.[i] ?? 0, volume: side.volume?.[i] ?? 0 },
      spot: side.spot?.[i] ?? 0,
    });
  });
  return out;
};

/** Pairs the call and put series bar by bar, oldest first; bars missing either side are dropped. */
export const alignRows = (ce: RawSide, pe: RawSide): RollingRow[] => {
  const calls = legsByTime(ce);
  const puts = legsByTime(pe);
  const rows: RollingRow[] = [];
  for (const [time, call] of calls) {
    const put = puts.get(time);
    if (put !== undefined) rows.push({ time, spot: call.spot || put.spot, ce: call.leg, pe: put.leg });
  }
  return rows.sort((a, b) => a.time - b.time);
};

export interface DayStats {
  /** IST date, YYYY-MM-DD. */
  readonly date: string;
  /** 0 Sunday … 6 Saturday, in IST. */
  readonly weekday: number;
  readonly spotOpen: number;
  readonly spotClose: number;
  readonly spotHigh: number;
  readonly spotLow: number;
  /** Average of the call's and put's IV at the first bar. */
  readonly ivOpen: number;
  readonly ivClose: number;
  /** Call plus put premium: the ATM straddle at width 0. */
  readonly premiumOpen: number;
  readonly premiumClose: number;
  readonly premiumChangePct: number;
  /** One standard deviation of the day's move, priced by the opening IV. */
  readonly impliedMove: number;
  readonly realizedMove: number;
  /** Realized move over implied: above 1, the day moved more than its options priced. */
  readonly moveRatio: number;
  /** High-to-low range over implied move. */
  readonly rangeRatio: number;
  /** The tracked contract expired this day: its premium falls to intrinsic and its IV to zero by the close. */
  readonly isExpiryDay: boolean;
}

/** IV this low at the close means the contract has expired: Dhan reports zero once nothing is left to price. */
const EXPIRED_IV = 0.5;

const istDayIndex = (time: number): number => Math.floor((time + IST_OFFSET_MS) / DAY_MS);
const istDate = (time: number): string => new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
const premium = (row: RollingRow): number => row.ce.close + row.pe.close;
const iv = (row: RollingRow): number => (row.ce.iv + row.pe.iv) / 2;

const statsOfDay = (rows: readonly RollingRow[]): DayStats | undefined => {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined || first.spot <= 0 || premium(first) <= 0) return undefined;
  const spots = rows.map((r) => r.spot);
  const impliedMove = first.spot * (iv(first) / 100) / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const realizedMove = Math.abs(last.spot - first.spot);
  const high = Math.max(...spots);
  const low = Math.min(...spots);
  return {
    date: istDate(first.time),
    weekday: new Date(first.time + IST_OFFSET_MS).getUTCDay(),
    spotOpen: first.spot, spotClose: last.spot, spotHigh: high, spotLow: low,
    ivOpen: iv(first), ivClose: iv(last),
    premiumOpen: premium(first), premiumClose: premium(last),
    premiumChangePct: ((premium(last) - premium(first)) / premium(first)) * 100,
    impliedMove,
    realizedMove,
    moveRatio: impliedMove > 0 ? realizedMove / impliedMove : 0,
    rangeRatio: impliedMove > 0 ? (high - low) / impliedMove : 0,
    isExpiryDay: iv(last) < EXPIRED_IV,
  };
};

/** Splits rows into IST trading days, oldest first. */
export const groupByDay = (rows: readonly RollingRow[]): RollingRow[][] => {
  const days = new Map<number, RollingRow[]>();
  for (const row of rows) {
    const key = istDayIndex(row.time);
    const day = days.get(key) ?? [];
    day.push(row);
    days.set(key, day);
  }
  return [...days.entries()].sort(([a], [b]) => a - b).map(([, day]) => day);
};

export const dayStats = (rows: readonly RollingRow[]): DayStats[] =>
  groupByDay(rows).flatMap((day) => statsOfDay(day) ?? []);

export interface Group { readonly days: number; readonly movedMoreShare: number; readonly avgMoveRatio: number; readonly avgPremiumChangePct: number; readonly avgIvOpen: number }

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

export const groupOf = (days: readonly DayStats[]): Group => ({
  days: days.length,
  movedMoreShare: days.length === 0 ? 0 : (days.filter((d) => d.moveRatio > 1).length / days.length) * 100,
  avgMoveRatio: mean(days.map((d) => d.moveRatio)),
  avgPremiumChangePct: mean(days.map((d) => d.premiumChangePct)),
  avgIvOpen: mean(days.map((d) => d.ivOpen)),
});

/**
 * The same figures split by weekday, Monday first, over ordinary days only: an expiry day's collapse to zero
 * would swamp its weekday's average, so those are grouped on their own by the caller. Empty weekdays are left out.
 */
export const byWeekday = (days: readonly DayStats[]): (Group & { readonly weekday: number })[] =>
  [1, 2, 3, 4, 5, 6, 0].flatMap((weekday) => {
    const these = days.filter((d) => d.weekday === weekday && !d.isExpiryDay);
    return these.length === 0 ? [] : [{ weekday, ...groupOf(these) }];
  });

export interface ProfilePoint {
  /** Minutes after the 09:15 open, at the start of the bucket. */
  readonly minute: number;
  /** Average straddle premium against that day's opening premium, in percent. */
  readonly premiumPct: number;
  /** Average distance of spot from that day's open, in percent. */
  readonly spotMovePct: number;
  readonly samples: number;
}

/**
 * The average shape of an ordinary session: how premium and spot evolve from the open, in 15-minute buckets.
 * Expiry days are left out: their decay to zero is a different shape and would dominate the average.
 */
export const intradayProfile = (rows: readonly RollingRow[]): ProfilePoint[] => {
  const buckets = new Map<number, { premium: number[]; spot: number[] }>();
  for (const day of groupByDay(rows)) {
    const open = day[0];
    const close = day[day.length - 1];
    if (open === undefined || close === undefined || premium(open) <= 0 || open.spot <= 0 || iv(close) < EXPIRED_IV) continue;
    for (const row of day) {
      const minute = new Date(row.time + IST_OFFSET_MS).getUTCHours() * 60 + new Date(row.time + IST_OFFSET_MS).getUTCMinutes() - MARKET_OPEN_MINUTE;
      if (minute < 0) continue;
      const bucket = Math.floor(minute / PROFILE_BUCKET_MINUTES) * PROFILE_BUCKET_MINUTES;
      const held = buckets.get(bucket) ?? { premium: [], spot: [] };
      held.premium.push((premium(row) / premium(open) - 1) * 100);
      held.spot.push((Math.abs(row.spot - open.spot) / open.spot) * 100);
      buckets.set(bucket, held);
    }
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b)
    .map(([minute, b]) => ({ minute, premiumPct: mean(b.premium), spotMovePct: mean(b.spot), samples: b.premium.length }));
};
