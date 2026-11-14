import { INDEX_UNDERLYINGS, type Underlying } from "./option-underlyings";

/**
 * The expired-options page's settings, and the rules that keep them valid on their own: the interval follows the
 * range unless chosen, the strike width and expiry cycle follow what Dhan lists for the instrument, and everything
 * round-trips through the URL so a reload or a shared link reopens the same view.
 */

export type RangePreset = "1W" | "2W" | "1M" | "custom";
export type IntervalChoice = "auto" | "1" | "5" | "15" | "25" | "60";

export interface HistorySettings {
  readonly underlying: Underlying;
  readonly expiryFlag: "WEEK" | "MONTH";
  readonly expiryCode: 1 | 2 | 3;
  readonly width: number;
  readonly interval: IntervalChoice;
  readonly range: RangePreset;
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;
const PRESET_DAYS: Record<Exclude<RangePreset, "custom">, number> = { "1W": 7, "2W": 14, "1M": 30 };
/** Dhan's limits, mirrored from the server so the page never asks for something it will refuse. */
export const MAX_RANGE_DAYS = 31;
export const MAX_ONE_MINUTE_DAYS = 7;
/** Indices that also list weekly options; every other underlying is monthly only. */
const WEEKLY_INDICES: ReadonlySet<number> = new Set([13, 51]);

const shift = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const spanDays = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

export const hasWeeklyOptions = (underlying: Underlying): boolean => underlying.instrument === "OPTIDX" && WEEKLY_INDICES.has(underlying.securityId);

/** Dhan serves ±10 strikes only for index options on the nearest expiry, ±3 for everything else. */
export const maxWidth = (settings: Pick<HistorySettings, "underlying" | "expiryCode">): number =>
  settings.underlying.instrument === "OPTIDX" && settings.expiryCode === 1 ? 10 : 3;

/** Bars detailed enough to see a session's shape, few enough to stay quick: 1m for a few days, 5m to two weeks, 15m beyond. */
export const autoInterval = (from: string, to: string): Exclude<IntervalChoice, "auto"> => {
  const days = spanDays(from, to);
  return days <= 3 ? "1" : days <= 14 ? "5" : "15";
};

export const effectiveInterval = (settings: HistorySettings): Exclude<IntervalChoice, "auto"> =>
  settings.interval === "auto" ? autoInterval(settings.from, settings.to) : settings.interval;

/** Pulls any combination of choices back inside what Dhan accepts, preferring to keep what was just changed. */
export const normalize = (settings: HistorySettings, today: string): HistorySettings => {
  const expiryFlag = hasWeeklyOptions(settings.underlying) ? settings.expiryFlag : "MONTH";
  const to = settings.range === "custom" ? (settings.to > today ? today : settings.to) : today;
  const presetFrom = settings.range === "custom" ? settings.from : shift(today, 1 - PRESET_DAYS[settings.range]);
  const limit = effectiveInterval({ ...settings, from: presetFrom, to }) === "1" ? MAX_ONE_MINUTE_DAYS : MAX_RANGE_DAYS;
  const from = presetFrom > to ? to : spanDays(presetFrom, to) > limit ? shift(to, 1 - limit) : presetFrom;
  const width = Math.max(0, Math.min(Math.floor(settings.width) || 0, maxWidth(settings)));
  return { ...settings, expiryFlag, width, from, to };
};

export const defaultSettings = (underlying: Underlying, today: string): HistorySettings =>
  normalize({ underlying, expiryFlag: underlying.expiryFlag, expiryCode: 1, width: 0, interval: "auto", range: "2W", from: today, to: today }, today);

/** The URL query that reopens this view. */
export const toQuery = (settings: HistorySettings): URLSearchParams => {
  const { underlying: u } = settings;
  const params = new URLSearchParams(u.instrument === "OPTIDX" ? { name: u.name } : { name: u.name, securityId: String(u.securityId), instrument: "OPTSTK" });
  params.set("cycle", settings.expiryFlag === "WEEK" ? "weekly" : "monthly");
  params.set("expiry", String(settings.expiryCode));
  if (settings.width > 0) params.set("width", String(settings.width));
  if (settings.interval !== "auto") params.set("interval", settings.interval);
  params.set("range", settings.range);
  if (settings.range === "custom") { params.set("from", settings.from); params.set("to", settings.to); }
  return params;
};

const isDate = (value: string | undefined): value is string => value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Settings from a URL query; anything missing or unusable falls back to the defaults. */
export const fromQuery = (query: Readonly<Record<string, string | undefined>>, today: string): HistorySettings => {
  const preset = INDEX_UNDERLYINGS.find((u) => u.name === query.name?.toUpperCase());
  const id = Number(query.securityId);
  const underlying: Underlying = preset ?? (query.instrument === "OPTSTK" && Number.isInteger(id) && id > 0
    ? { name: query.name ?? String(id), securityId: id, segment: "NSE_FNO", instrument: "OPTSTK", expiryFlag: "MONTH" }
    : INDEX_UNDERLYINGS[0]!);
  const base = defaultSettings(underlying, today);
  const range: RangePreset = query.range === "1W" || query.range === "2W" || query.range === "1M" || query.range === "custom" ? query.range : base.range;
  const interval = (["1", "5", "15", "25", "60"] as const).find((i) => i === query.interval) ?? "auto";
  const code = Number(query.expiry);
  return normalize({
    ...base,
    expiryFlag: query.cycle === "monthly" ? "MONTH" : query.cycle === "weekly" ? "WEEK" : base.expiryFlag,
    expiryCode: code === 2 || code === 3 ? code : 1,
    width: Number(query.width ?? 0),
    interval,
    range: range === "custom" && (!isDate(query.from) || !isDate(query.to)) ? base.range : range,
    from: isDate(query.from) ? query.from : base.from,
    to: isDate(query.to) ? query.to : base.to,
  }, today);
};
