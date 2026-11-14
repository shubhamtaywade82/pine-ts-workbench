/** Checks a rolling-option query and splits its dates into the two-day windows Dhan accepts. Pure, so it is tested alone. */

export interface RollingQuery {
  readonly segment: "NSE_FNO" | "BSE_FNO";
  readonly securityId: number;
  readonly instrument: "OPTIDX" | "OPTSTK";
  readonly expiryFlag: "WEEK" | "MONTH";
  readonly expiryCode: 1 | 2 | 3;
  /** Strikes from the money: the call at ATM+width, the put at ATM−width. 0 is the straddle. */
  readonly width: number;
  readonly interval: "1" | "5" | "15" | "25" | "60";
  readonly from: string;
  readonly to: string;
}

const INTERVALS = ["1", "5", "15", "25", "60"] as const;
const DAY_MS = 86_400_000;
/** Dhan rejects a window wider than two calendar days (measured: 11→12 Nov works, 10→12 Nov is a 400). */
const WINDOW_DAYS = 2;
/** Longest range served, so one request stays a few dozen calls. One-minute bars are 5× the rows, so less. */
const MAX_RANGE_DAYS = 31;
const MAX_RANGE_DAYS_ONE_MINUTE = 7;
/** Dhan keeps five years of expired options. */
const MAX_AGE_DAYS = 5 * 366;

const toDay = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const fromDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(toDay(value));

/** The query, or the reason it cannot be served. `today` is the IST date. */
export const parseRollingQuery = (params: URLSearchParams, today: string): RollingQuery | string => {
  const segment = params.get("segment");
  const instrument = params.get("instrument");
  const expiryFlag = params.get("expiryFlag");
  const expiryCode = Number(params.get("expiryCode"));
  const width = Number(params.get("width") ?? "0");
  const interval = params.get("interval") ?? "5";
  const securityId = Number(params.get("securityId"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (segment !== "NSE_FNO" && segment !== "BSE_FNO") return "segment must be NSE_FNO or BSE_FNO";
  if (instrument !== "OPTIDX" && instrument !== "OPTSTK") return "instrument must be OPTIDX or OPTSTK";
  if (expiryFlag !== "WEEK" && expiryFlag !== "MONTH") return "expiryFlag must be WEEK or MONTH";
  if (expiryCode !== 1 && expiryCode !== 2 && expiryCode !== 3) return "expiryCode must be 1, 2 or 3";
  if (!Number.isInteger(securityId) || securityId <= 0) return "securityId must be a positive integer";
  if (!(INTERVALS as readonly string[]).includes(interval)) return `interval must be one of ${INTERVALS.join(", ")}`;
  // Dhan serves ±10 strikes only for index options on the nearest expiry, ±3 for everything else.
  const maxWidth = instrument === "OPTIDX" && expiryCode === 1 ? 10 : 3;
  if (!Number.isInteger(width) || width < 0 || width > maxWidth) return `width must be 0 to ${maxWidth} here`;
  if (!isDate(from) || !isDate(to)) return "from and to must be YYYY-MM-DD dates";
  const span = toDay(to) - toDay(from) + 1;
  const maxSpan = interval === "1" ? MAX_RANGE_DAYS_ONE_MINUTE : MAX_RANGE_DAYS;
  if (span < 1) return "from must not be after to";
  if (span > maxSpan) return `range is limited to ${maxSpan} days at a ${interval}-minute interval`;
  if (toDay(to) > toDay(today)) return "to cannot be in the future";
  if (toDay(today) - toDay(from) > MAX_AGE_DAYS) return "Dhan keeps only the last five years";
  return { segment, instrument, expiryFlag, expiryCode, securityId, width, interval: interval as RollingQuery["interval"], from, to };
};

const isWeekend = (day: number): boolean => { const weekday = new Date(day * DAY_MS).getUTCDay(); return weekday === 0 || weekday === 6; };

/** The date windows to ask for: consecutive two-day spans covering the range, skipping spans that are only a weekend. */
export const dateWindows = (from: string, to: string): { readonly from: string; readonly to: string }[] => {
  const windows: { from: string; to: string }[] = [];
  for (let day = toDay(from); day <= toDay(to); day += WINDOW_DAYS) {
    const end = Math.min(day + WINDOW_DAYS - 1, toDay(to));
    let hasTradingDay = false;
    for (let d = day; d <= end; d += 1) if (!isWeekend(d)) hasTradingDay = true;
    if (hasTradingDay) windows.push({ from: fromDay(day), to: fromDay(end) });
  }
  return windows;
};

export const strikeFor = (side: "CALL" | "PUT", width: number): string =>
  width === 0 ? "ATM" : `ATM${side === "CALL" ? "+" : "-"}${width}`;

/** The strike parameter for `offset` strikes from the money: "ATM", "ATM+2", "ATM-3". */
export const offsetStrike = (offset: number): string => (offset === 0 ? "ATM" : `ATM${offset > 0 ? "+" : "-"}${Math.abs(offset)}`);

/**
 * How many strikes either side to fetch so a contract bought at the money can be followed as spot moves. Dhan
 * lists ±10 for index options on the nearest expiry but ±3 elsewhere; ±5 covers most index days at a third of
 * the calls ±10 would take.
 */
export const trackedOffsets = (query: Pick<RollingQuery, "instrument" | "expiryCode">): number =>
  query.instrument === "OPTIDX" && query.expiryCode === 1 ? 5 : 3;
