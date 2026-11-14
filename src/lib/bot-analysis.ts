import { bootstrapMeanInterval, verdictOf, wilsonPct, type Interval, type Verdict } from "./lab-stats";

/**
 * What the options-trading-agent's own trades say worked, by strategy and by the context they were taken in. R is
 * the trade's result over the risk it was sized for, so trades of different sizes and underlyings compare.
 */

export interface BotTrade {
  readonly date: string;
  readonly underlying: string;
  readonly strategy: string;
  readonly side: "CE" | "PE";
  /** Days to expiry at entry; undefined where the source does not record it. */
  readonly dte: number | undefined;
  /** Minutes after midnight IST at entry. */
  readonly minuteOfDay: number | undefined;
  readonly posture: string | undefined;
  readonly exitReason: string;
  readonly r: number;
  readonly netPnlInr: number;
}

export interface Cell {
  readonly key: string;
  readonly trades: number;
  readonly days: number;
  readonly winRate: number;
  readonly winRateCi: Interval;
  readonly meanR: number;
  /** Interval of the mean R, widened for the number of cells compared in the same table. */
  readonly meanRCi: Interval | undefined;
  readonly totalR: number;
  readonly totalPnlInr: number;
  /** Share of the positive R that the best single day supplied. */
  readonly bestDayShare: number | undefined;
  readonly verdict: Verdict;
}

const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);

/** The largest share of positive daily R that one day supplied: an edge that is one good session is no edge. */
export const bestDayShare = (trades: readonly BotTrade[]): number | undefined => {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.r);
  const positive = [...byDay.values()].filter((r) => r > 0);
  const total = sum(positive);
  return total <= 0 ? undefined : Math.max(...positive) / total;
};

/** One group's figures. `comparisons` is how many groups share the table, which widens the interval to match. */
export const cellOf = (key: string, trades: readonly BotTrade[], comparisons = 1): Cell => {
  const rs = trades.map((t) => t.r);
  const meanRCi = bootstrapMeanInterval(rs, 1, 0.05 / Math.max(1, comparisons));
  return {
    key,
    trades: trades.length,
    days: new Set(trades.map((t) => t.date)).size,
    winRate: trades.length === 0 ? 0 : (trades.filter((t) => t.r > 0).length / trades.length) * 100,
    winRateCi: wilsonPct(trades.filter((t) => t.r > 0).length, trades.length),
    meanR: trades.length === 0 ? 0 : sum(rs) / trades.length,
    meanRCi,
    totalR: sum(rs),
    totalPnlInr: sum(trades.map((t) => t.netPnlInr)),
    bestDayShare: bestDayShare(trades),
    verdict: verdictOf(trades.length, meanRCi),
  };
};

const dteBucket = (dte: number | undefined): string =>
  dte === undefined ? "Unknown" : dte === 0 ? "0 (expiry day)" : dte <= 2 ? "1–2 days" : dte <= 5 ? "3–5 days" : "6+ days";

const timeBucket = (minute: number | undefined): string => {
  if (minute === undefined) return "Unknown";
  if (minute < 10 * 60) return "09:15–10:00";
  if (minute < 11 * 60 + 30) return "10:00–11:30";
  if (minute < 13 * 60 + 30) return "11:30–13:30";
  return "13:30–close";
};

export const DIMENSIONS: readonly (readonly [string, (t: BotTrade) => string])[] = [
  ["Strategy", (t) => t.strategy],
  ["Side", (t) => t.side],
  ["Strategy × side", (t) => `${t.strategy} · ${t.side}`],
  ["Days to expiry", (t) => dteBucket(t.dte)],
  ["Time of entry", (t) => timeBucket(t.minuteOfDay)],
  ["Underlying", (t) => t.underlying],
  ["Exit reason", (t) => t.exitReason],
  ["Posture", (t) => t.posture ?? "Unknown"],
];

/** Every group for one dimension, largest first, each judged against the others in its table. */
export const breakdown = (trades: readonly BotTrade[], keyOf: (t: BotTrade) => string): Cell[] => {
  const groups = new Map<string, BotTrade[]>();
  for (const t of trades) {
    const key = keyOf(t);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()].map(([key, these]) => cellOf(key, these, groups.size)).sort((a, b) => b.trades - a.trades);
};

/** Running total of R in trade order, for the equity curve. */
export const cumulativeR = (trades: readonly BotTrade[]): number[] => {
  let total = 0;
  return trades.map((t) => (total += t.r));
};

const field = (row: Readonly<Record<string, string>>, name: string): string => row[name] ?? "";

/**
 * Trades from the Time Machine's `--trades` CSV. Its columns: date,strategy,direction,optionType,strike,entryTime,
 * exitTime,…,netPnlInr,r,exitReason,… The CSV has no days to expiry, so that stays unknown.
 */
export const parseReplayCsv = (text: string, underlying: string): BotTrade[] => {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header === undefined) return [];
  const names = header.split(",");
  return lines.flatMap((line) => {
    const cells = line.split(",");
    const row = Object.fromEntries(names.map((n, i) => [n, cells[i] ?? ""]));
    const r = Number(field(row, "r"));
    const side = field(row, "optionType");
    if (!Number.isFinite(r) || (side !== "CE" && side !== "PE")) return [];
    const entry = Date.parse(field(row, "entryTime"));
    const ist = Number.isFinite(entry) ? new Date(entry + 19_800_000) : undefined;
    return [{
      date: field(row, "date"), underlying, strategy: field(row, "strategy") || "unknown", side, dte: undefined,
      minuteOfDay: ist === undefined ? undefined : ist.getUTCHours() * 60 + ist.getUTCMinutes(),
      posture: undefined, exitReason: field(row, "exitReason") || "unknown", r, netPnlInr: Number(field(row, "netPnlInr")) || 0,
    }];
  });
};

interface JournalEvent { readonly type?: string; readonly [key: string]: unknown }

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Paper trades from the bot's journal: each closed trade joined to its entry, which says which strategy fired and in
 * what context. R is the P&L over the risk at entry: planned risk where recorded, else (fill − stop) × quantity.
 * Operator test trades are left out; they were not the strategy's decision.
 */
export const paperTrades = (events: readonly JournalEvent[]): BotTrade[] => {
  const entries = new Map<string, JournalEvent>();
  const fills = new Map<string, JournalEvent>();
  for (const e of events) {
    const id = str(e.correlationId);
    if (id === undefined) continue;
    if (e.type === "entry_submitted") entries.set(id, e);
    if (e.type === "entry_filled") fills.set(id, e);
  }
  // A restarted run can journal the same close twice; the last one is the settled figure.
  const closes = new Map<string, JournalEvent>();
  for (const e of events) if (e.type === "trade_closed" && str(e.positionId) !== undefined) closes.set(str(e.positionId)!, e);
  return [...closes.values()].flatMap((e) => {
    const id = str(e.positionId);
    const entry = id === undefined ? undefined : entries.get(id);
    const strategy = str(entry?.strategy);
    if (entry === undefined || strategy === undefined || strategy === "test") return [];
    const fill = fills.get(id!);
    const price = num(fill?.averagePrice) ?? num(entry.entryReference);
    const stop = num(fill?.stopLossPrice) ?? num(entry.stopLossPrice);
    const quantity = num(fill?.quantity) ?? num(entry.quantity);
    const risk = num(entry.plannedRiskInr) ?? (price !== undefined && stop !== undefined && quantity !== undefined ? (price - stop) * quantity : undefined);
    const pnl = num(e.pnlInr);
    const side = str(entry.optionType);
    if (risk === undefined || risk <= 0 || pnl === undefined || (side !== "CE" && side !== "PE")) return [];
    const ts = str(e.ts) ?? "";
    return [{
      date: new Date(Date.parse(ts) + 19_800_000).toISOString().slice(0, 10), underlying: str(e.underlying) ?? "?", strategy, side,
      dte: num(entry.daysToExpiry), minuteOfDay: num(entry.minuteOfDayIst), posture: str(entry.posture),
      exitReason: str(e.reason) ?? "unknown", r: pnl / risk, netPnlInr: pnl,
    }];
  });
};
