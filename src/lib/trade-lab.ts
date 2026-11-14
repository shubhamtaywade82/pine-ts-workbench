import { sessionMinute, simulateDay, type BookRow, type Side, type Trade, type TradeRules } from "./held-options";
import { chargesPct, orbSignal, type EntryMode } from "./lab-entries";
import { bestShare, bootstrapMeanInterval, breakevenWinRate, verdictOf, wilsonPct, type Interval, type Verdict } from "./lab-stats";
import { IST_OFFSET_MS } from "./rolling-options";

/**
 * Long call and put trades replayed day by day, then grouped by the conditions around them. "Known at entry"
 * conditions could have been checked before buying, so they can guide an entry; "known after the day" ones
 * describe the kind of day it turned out to be, to show how options behave in it.
 */

const TRADING_DAYS_PER_YEAR = 252;
/** IV this low at the close means the contract expired that day. */
const EXPIRED_IV = 0.5;
/** Moves smaller than this share of the day's implied move count as flat. */
const FLAT_SHARE = 0.15;
/** A day that closed this far from its open, in implied moves, was a trend day. */
const TREND_SHARE = 0.6;
/** Straddle changes smaller than this, in percent, count as steady. */
const STEADY_PCT = 3;
/** Slippage on each side, as a share of premium: the 25 bps the trading bot's paper venue charges. */
export const SLIPPAGE_PCT = 0.25;
/** Groups with fewer trades than this are listed but not called out. */
export const MIN_SAMPLE = 3;

/** A year of sessions: the window a VIX close is ranked against. */
const VIX_LOOKBACK = 252;
const VIX_FACTOR = "VIX percentile at entry";

/**
 * Each session's India VIX percentile as known before its open: the previous close ranked against the year of closes
 * before it. Keyed by IST date; sessions with less than a quarter-year of history behind them are left out.
 */
export const vixPercentileByDay = (bars: readonly { readonly time: number; readonly close: number }[]): Map<string, number> => {
  const byDay = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const history = bars.slice(Math.max(0, i - VIX_LOOKBACK), i).map((b) => b.close);
    if (history.length < VIX_LOOKBACK / 4) continue;
    const known = bars[i - 1]!.close;
    byDay.set(istDate(bars[i]!.time), (history.filter((c) => c <= known).length / history.length) * 100);
  }
  return byDay;
};

/** Thirds of the year's range: cheap, ordinary and rich premiums for a buyer. */
export const vixBand = (percentile: number | undefined): string =>
  percentile === undefined ? "Unknown" : percentile < 33 ? "Low (below 33rd pct)" : percentile < 67 ? "Middle (33rd–67th pct)" : "High (67th pct and up)";

export type ConditionKind = "entry" | "after";
export const FACTORS: readonly (readonly [string, ConditionKind])[] = [
  ["Days to expiry", "entry"], ["Opening gap", "entry"], ["Move before entry", "entry"], ["Straddle before entry", "entry"], ["IV at entry", "entry"], [VIX_FACTOR, "entry"],
  ["Day type", "after"], ["Straddle over the day", "after"],
];

const istDate = (time: number): string => new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
const straddle = (row: BookRow): number | undefined => {
  const call = row.ce[String(row.atm)]?.close;
  const put = row.pe[String(row.atm)]?.close;
  return call === undefined || put === undefined ? undefined : call + put;
};
const impliedMove = (row: BookRow): number => row.spot * (row.iv / 100) / Math.sqrt(TRADING_DAYS_PER_YEAR);

/** Splits a book into IST trading days, oldest first. */
export const bookDays = (rows: readonly BookRow[]): BookRow[][] => {
  const days = new Map<string, BookRow[]>();
  for (const row of rows) days.set(istDate(row.time), [...(days.get(istDate(row.time)) ?? []), row]);
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, d]) => d);
};

interface DayFacts { readonly date: string; readonly dte: number | undefined; readonly gap: string; readonly dayType: string; readonly straddleOverDay: string; readonly vix: string }

const dayFacts = (days: readonly BookRow[][], vixPercentiles: ReadonlyMap<string, number>): DayFacts[] => {
  const isExpiry = days.map((d) => (d.at(-1)?.iv ?? 1) < EXPIRED_IV);
  return days.map((day, i) => {
    const open = day[0]!;
    const close = day.at(-1)!;
    const implied = impliedMove(open);
    const next = isExpiry.findIndex((e, j) => j >= i && e);
    const previousClose = days[i - 1]?.at(-1)?.spot;
    const gap = previousClose === undefined ? "Unknown" : Math.abs(open.spot - previousClose) < FLAT_SHARE * implied ? "Flat open" : open.spot > previousClose ? "Gap up" : "Gap down";
    const move = close.spot - open.spot;
    const dayType = Math.abs(move) >= TREND_SHARE * implied ? (move > 0 ? "Trend up" : "Trend down") : "Sideways";
    const [first, last] = [straddle(open), straddle(close)];
    const straddleOverDay = first === undefined || last === undefined ? "Unknown" : last >= first ? "Straddle rose" : "Straddle decayed";
    const date = istDate(open.time);
    return { date, dte: next < 0 ? undefined : next - i, gap, dayType, straddleOverDay, vix: vixBand(vixPercentiles.get(date)) };
  });
};

const dteLabel = (dte: number | undefined): string => (dte === undefined ? "Unknown" : dte === 0 ? "Expiry day" : dte === 1 ? "1 day before" : "2+ days before");

export interface LabTrade extends Trade { readonly date: string; readonly conditions: Readonly<Record<string, string>> }

/** What the lab knows beyond the bars: VIX history for the percentile split, and a lot size to charge costs on. */
export interface LabContext { readonly vixPercentiles?: ReadonlyMap<string, number>; readonly lotSize?: number }

/** Net of slippage both ways (bought a little above the quote, sold a little below), then of charges when a lot size is known. */
export const netReturnPct = (trade: Trade, lotSize: number | undefined): number => {
  const paid = trade.entryPrice * (1 + SLIPPAGE_PCT / 100);
  const received = trade.exitPrice * (1 - SLIPPAGE_PCT / 100);
  return (received / paid - 1) * 100 - (lotSize === undefined ? 0 : chargesPct(paid, received, lotSize));
};

/** One day's trade under a plan, with the conditions around it; none when the plan does not trade that day. */
const tradeOf = (day: readonly BookRow[], fact: DayFacts, rules: TradeRules | undefined, medianIv: number, lotSize: number | undefined): LabTrade[] => {
    const trade = rules === undefined ? undefined : simulateDay(day, rules);
    if (trade === undefined) return [];
    const open = day[0]!;
    const entry = day.find((r) => r.time === trade.entryTime)!;
    const implied = impliedMove(open);
    const move = (entry.spot - open.spot) * (trade.side === "CE" ? 1 : -1);
    const [openStraddle, entryStraddle] = [straddle(open), straddle(entry)];
    const straddleChange = openStraddle === undefined || entryStraddle === undefined ? undefined : ((entryStraddle - openStraddle) / openStraddle) * 100;
    return [{
      ...trade,
      returnPct: netReturnPct(trade, lotSize),
      date: fact.date,
      conditions: {
        "Days to expiry": dteLabel(fact.dte),
        "Opening gap": fact.gap,
        "Move before entry": entry.time === open.time ? "Entered at the open" : Math.abs(move) < FLAT_SHARE * implied ? "Flat" : move > 0 ? "With the trade" : "Against the trade",
        "Straddle before entry": straddleChange === undefined || entry.time === open.time ? "Entered at the open" : Math.abs(straddleChange) < STEADY_PCT ? "Steady" : straddleChange > 0 ? "Expanding" : "Decaying",
        "IV at entry": entry.iv >= medianIv ? "Above the range's median" : "Below the range's median",
        [VIX_FACTOR]: fact.vix,
        "Day type": fact.dayType,
        "Straddle over the day": fact.straddleOverDay,
      },
    }];
};

export interface Stats {
  readonly trades: number;
  readonly winRate: number;
  readonly avgReturn: number;
  readonly avgMfe: number;
  readonly avgMae: number;
  readonly avgMinutesToPeak: number;
  /** 95% Wilson interval of the win rate, in percent. */
  readonly winRateCi: Interval;
  /** 95% bootstrap interval of the average return; undefined below two trades. */
  readonly avgReturnCi: Interval | undefined;
  /** Win rate needed to break even at these average win and loss sizes. */
  readonly breakevenWinRate: number | undefined;
  /** Share of all gains that the single best trade supplied. */
  readonly bestDayShare: number | undefined;
  readonly verdict: Verdict;
  readonly avgWin: number;
  readonly avgLoss: number;
  /** Gross gains over gross losses; undefined with no losses. */
  readonly profitFactor: number | undefined;
  /** Deepest fall of the running total of returns, trade by trade, in percent of premium. */
  readonly maxDrawdown: number;
}

const maxDrawdown = (returns: readonly number[]): number => {
  let total = 0; let peak = 0; let deepest = 0;
  for (const r of returns) {
    total += r;
    peak = Math.max(peak, total);
    deepest = Math.max(deepest, peak - total);
  }
  return deepest;
};

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

/** A group's figures; `comparisons` is how many groups are judged together, which widens the interval to match. */
export const statsOf = (trades: readonly Trade[], comparisons = 1): Stats => {
  const returns = trades.map((t) => t.returnPct);
  const avgReturnCi = bootstrapMeanInterval(returns, 1, 0.05 / Math.max(1, comparisons));
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  const lost = -losses.reduce((s, r) => s + r, 0);
  return {
  trades: trades.length,
  winRate: trades.length === 0 ? 0 : (trades.filter((t) => t.returnPct > 0).length / trades.length) * 100,
  avgReturn: mean(trades.map((t) => t.returnPct)),
  avgMfe: mean(trades.map((t) => t.mfePct)),
  avgMae: mean(trades.map((t) => t.maePct)),
  avgMinutesToPeak: mean(trades.map((t) => t.minutesToPeak)),
  winRateCi: wilsonPct(trades.filter((t) => t.returnPct > 0).length, trades.length),
  avgReturnCi,
  breakevenWinRate: breakevenWinRate(returns),
  bestDayShare: bestShare(returns),
  verdict: verdictOf(trades.length, avgReturnCi),
  avgWin: mean(wins),
  avgLoss: mean(losses),
  profitFactor: lost === 0 ? undefined : wins.reduce((s, r) => s + r, 0) / lost,
  maxDrawdown: maxDrawdown(returns),
  };
};

export interface FactorGroups { readonly factor: string; readonly kind: ConditionKind; readonly groups: readonly { readonly value: string; readonly stats: Stats }[] }
export interface Highlight { readonly factor: string; readonly value: string; readonly stats: Stats }
export interface LevelResult { readonly level: number | undefined; readonly stats: Stats }

export interface SideReport {
  readonly side: Side;
  readonly trades: readonly LabTrade[];
  readonly summary: Stats;
  readonly byFactor: readonly FactorGroups[];
  /** Entry conditions with at least MIN_SAMPLE trades, best and worst average return. */
  readonly favoured: readonly Highlight[];
  readonly avoided: readonly Highlight[];
  /** The same days replayed with each profit target, keeping the chosen stop. */
  readonly targets: readonly LevelResult[];
  /** And with each stop, keeping the chosen target. */
  readonly stops: readonly LevelResult[];
}

export const TARGET_LEVELS: readonly (number | undefined)[] = [undefined, 20, 30, 50, 100];
export const STOP_LEVELS: readonly (number | undefined)[] = [undefined, 20, 30, 50];

/** The day's plan for one side: a fixed-time entry every day, or a breakout entry only on days it signals that side. */
const planFor = (day: readonly BookRow[], rules: LabRules, side: Side): TradeRules | undefined => {
  const plan = { ...rules, side };
  if ((rules.entry ?? "time") === "time") return plan;
  const signal = orbSignal(day, rules.entry === "orb-twap");
  return signal?.side === side ? { ...plan, entryMinute: signal.entryMinute } : undefined;
};

interface LabDays { readonly days: readonly BookRow[][]; readonly facts: readonly DayFacts[]; readonly medianIv: number; readonly lotSize: number | undefined }

const tradesFor = (lab: LabDays, rules: LabRules, side: Side): LabTrade[] =>
  lab.days.flatMap((day, i) => tradeOf(day, lab.facts[i]!, planFor(day, rules, side), lab.medianIv, lab.lotSize));

const sideReport = (lab: LabDays, rules: LabRules, side: Side): SideReport => {
  const trades = tradesFor(lab, rules, side);
  const byFactor = FACTORS.map(([factor, kind]) => {
    const values = [...new Set(trades.map((t) => t.conditions[factor]!))];
    // Both sides' groups are read together, so each interval is widened for all of them.
    const groups = values.map((value) => ({ value, stats: statsOf(trades.filter((t) => t.conditions[factor] === value), 2 * values.length) }));
    return { factor, kind, groups: groups.sort((a, b) => b.stats.trades - a.stats.trades) };
  });
  const ranked = byFactor.filter((f) => f.kind === "entry").flatMap((f) => f.groups.filter((g) => g.stats.trades >= MIN_SAMPLE && g.value !== "Unknown" && g.value !== "Entered at the open").map((g) => ({ factor: f.factor, value: g.value, stats: g.stats })))
    .sort((a, b) => b.stats.avgReturn - a.stats.avgReturn);
  const replay = (over: Partial<LabRules>): Stats => statsOf(tradesFor(lab, { ...rules, ...over }, side));
  return {
    side,
    trades,
    summary: statsOf(trades),
    byFactor,
    favoured: ranked.filter((h) => h.stats.avgReturn > 0).slice(0, 3),
    avoided: ranked.filter((h) => h.stats.avgReturn < 0).slice(-3).reverse(),
    targets: TARGET_LEVELS.map((level) => ({ level, stats: replay({ targetPct: level }) })),
    stops: STOP_LEVELS.map((level) => ({ level, stats: replay({ stopPct: level }) })),
  };
};

export type LabRules = Omit<TradeRules, "side"> & { readonly entry?: EntryMode };

/** Long call and long put reports over the same days and rules. */
export const runLab = (rows: readonly BookRow[], rules: LabRules, context: LabContext = {}): { readonly days: number; readonly ce: SideReport; readonly pe: SideReport } => {
  const days = bookDays(rows).filter((d) => d.length > 1);
  const facts = dayFacts(days, context.vixPercentiles ?? new Map());
  // Compared like for like: each day's IV at the entry time, not at the open.
  const ivs = days.map((d) => (d.find((r) => sessionMinute(r.time) >= rules.entryMinute) ?? d[0]!).iv).sort((a, b) => a - b);
  const medianIv = ivs[Math.floor(ivs.length / 2)] ?? 0;
  const lab = { days, facts, medianIv, lotSize: context.lotSize };
  return { days: days.length, ce: sideReport(lab, rules, "CE"), pe: sideReport(lab, rules, "PE") };
};
