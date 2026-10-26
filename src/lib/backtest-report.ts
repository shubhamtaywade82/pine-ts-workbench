/**
 * Strategy Tester analytics, computed from the closed trades and the per-bar
 * equity curve of a backtest. Pure functions: no engine, no React.
 *
 * Definitions follow TradingView's Strategy Tester where it documents them:
 * - a trade's return is its net P&L over its entry value (entry price × qty);
 * - Sharpe/Sortino use monthly returns of equity against a 2% annual
 *   risk-free rate; Sortino divides by the downside deviation;
 * - buy & hold buys initial capital's worth at the first close and holds.
 */

export interface ReportTrade {
  readonly entryTime: number;
  readonly exitTime: number;
  readonly direction: string;
  readonly qty: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly profit: number;
}

export interface EquityPoint {
  readonly time: number;
  readonly equity: number;
  readonly close: number;
}

export type Period = "day" | "week" | "quarter" | "year";

export interface PeriodPnl {
  readonly start: number;
  readonly strategy: number;
  readonly buyHold: number;
}

const DAY_MS = 86_400_000;
const RISK_FREE_ANNUAL = 0.02;
const MONTHS_PER_YEAR = 12;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : sum(values) / values.length);

/** Net P&L over entry value, in percent. */
export const tradeReturnPercent = (trade: ReportTrade): number => {
  const entryValue = trade.entryPrice * trade.qty;
  return entryValue === 0 ? 0 : (trade.profit / entryValue) * 100;
};

export const isLong = (trade: ReportTrade): boolean => trade.direction.toLowerCase() === "long";

/** Profit factor: gross profit / gross loss; Infinity with no losses, 0 with no trades. */
export const profitFactor = (trades: readonly ReportTrade[]): number => {
  const grossProfit = sum(trades.filter((t) => t.profit > 0).map((t) => t.profit));
  const grossLoss = -sum(trades.filter((t) => t.profit < 0).map((t) => t.profit));
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
};

/** Largest peak-to-trough decline of equity: amount and percent of that peak. */
export const maxDrawdown = (equity: readonly EquityPoint[]): { amount: number; percent: number } => {
  let peak = equity[0]?.equity ?? 0;
  let worst = { amount: 0, percent: 0 };
  for (const { equity: value } of equity) {
    peak = Math.max(peak, value);
    const amount = peak - value;
    if (amount > worst.amount) worst = { amount, percent: peak === 0 ? 0 : (amount / peak) * 100 };
  }
  return worst;
};

/** Buy & hold equity: initial capital invested at the first close. */
export const buyHoldEquity = (equity: readonly EquityPoint[], initialCapital: number): number[] => {
  const firstClose = equity[0]?.close ?? 0;
  return equity.map((point) => (firstClose === 0 ? initialCapital : (initialCapital * point.close) / firstClose));
};

const periodStart = (time: number, period: Period): number => {
  const date = new Date(time);
  if (period === "day") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (period === "week") {
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    // Weeks start on Sunday, as in TradingView's weekly breakdown.
    return day - date.getUTCDay() * DAY_MS;
  }
  if (period === "quarter") return Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
  return Date.UTC(date.getUTCFullYear(), 0, 1);
};

/** Realised strategy P&L (by exit time) and buy & hold P&L per calendar period, in UTC. */
export const periodPnl = (
  trades: readonly ReportTrade[],
  equity: readonly EquityPoint[],
  initialCapital: number,
  period: Period,
): PeriodPnl[] => {
  const buckets = new Map<number, { strategy: number; buyHold: number }>();
  const bucket = (time: number) => {
    const start = periodStart(time, period);
    const existing = buckets.get(start) ?? { strategy: 0, buyHold: 0 };
    buckets.set(start, existing);
    return existing;
  };
  const hold = buyHoldEquity(equity, initialCapital);
  equity.forEach((point, i) => {
    bucket(point.time).buyHold += (hold[i] ?? 0) - (hold[i - 1] ?? initialCapital);
  });
  for (const trade of trades) bucket(trade.exitTime).strategy += trade.profit;
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([start, pnl]) => ({ start, ...pnl }));
};

/** Equity at the last bar of each calendar month, preceded by the initial capital. */
const monthEndEquity = (equity: readonly EquityPoint[], initialCapital: number): number[] => {
  const byMonth = new Map<string, number>();
  for (const point of equity) {
    const date = new Date(point.time);
    byMonth.set(`${date.getUTCFullYear()}-${date.getUTCMonth()}`, point.equity);
  }
  return [initialCapital, ...byMonth.values()];
};

/** Sharpe and Sortino over monthly returns; undefined with fewer than two months. */
export const riskRatios = (
  equity: readonly EquityPoint[],
  initialCapital: number,
): { sharpe: number | undefined; sortino: number | undefined } => {
  const ends = monthEndEquity(equity, initialCapital);
  const returns = ends.slice(1).map((value, i) => (value - (ends[i] ?? 0)) / (ends[i] || 1));
  if (returns.length < 2) return { sharpe: undefined, sortino: undefined };
  const excess = mean(returns) - RISK_FREE_ANNUAL / MONTHS_PER_YEAR;
  const deviation = Math.sqrt(mean(returns.map((r) => (r - mean(returns)) ** 2)));
  const downside = Math.sqrt(mean(returns.map((r) => Math.min(0, r) ** 2)));
  return {
    sharpe: deviation === 0 ? undefined : excess / deviation,
    sortino: downside === 0 ? undefined : excess / downside,
  };
};

/** Compound annual growth rate in percent over the equity curve's time span. */
export const cagr = (equity: readonly EquityPoint[], initialCapital: number): number => {
  const first = equity[0];
  const last = equity.at(-1);
  if (first === undefined || last === undefined || initialCapital <= 0) return 0;
  const years = (last.time - first.time) / (365 * DAY_MS);
  if (years <= 0) return 0;
  return ((last.equity / initialCapital) ** (1 / years) - 1) * 100;
};

/** Longest runs of consecutive winning and losing trades (breakevens end both). */
export const streaks = (trades: readonly ReportTrade[]): { wins: number; losses: number } => {
  let wins = 0;
  let losses = 0;
  let current = 0;
  for (const trade of trades) {
    if (trade.profit > 0) current = current > 0 ? current + 1 : 1;
    else if (trade.profit < 0) current = current < 0 ? current - 1 : -1;
    else current = 0;
    wins = Math.max(wins, current);
    losses = Math.max(losses, -current);
  }
  return { wins, losses };
};

export interface DrawdownPeriods {
  /** Average bars-time of declines from a peak until equity recovers it (or the end). */
  readonly averageDrawdownMs: number | undefined;
  /** Average time of rises from a trough until equity falls below it again (or the end). */
  readonly averageRunupMs: number | undefined;
}

/** Durations of alternating growth and decline phases of the equity curve. */
export const drawdownPeriods = (equity: readonly EquityPoint[]): DrawdownPeriods => {
  const declines: number[] = [];
  let peak = equity[0];
  let declineStart: number | undefined;
  for (const point of equity) {
    if (peak === undefined || point.equity >= peak.equity) {
      if (declineStart !== undefined) declines.push(point.time - declineStart);
      declineStart = undefined;
      peak = point;
    } else declineStart ??= peak.time;
  }
  const last = equity.at(-1);
  if (declineStart !== undefined && last !== undefined) declines.push(last.time - declineStart);
  const runups = declines.length === 0 ? [] : risingSpans(equity);
  return {
    averageDrawdownMs: declines.length === 0 ? undefined : mean(declines),
    averageRunupMs: runups.length === 0 ? undefined : mean(runups),
  };
};

const risingSpans = (equity: readonly EquityPoint[]): number[] => {
  const spans: number[] = [];
  let trough = equity[0];
  let riseStart: number | undefined;
  for (const point of equity) {
    if (trough === undefined || point.equity <= trough.equity) {
      if (riseStart !== undefined) spans.push(point.time - riseStart);
      riseStart = undefined;
      trough = point;
    } else riseStart ??= trough.time;
  }
  const last = equity.at(-1);
  if (riseStart !== undefined && last !== undefined) spans.push(last.time - riseStart);
  return spans;
};

/** Trade returns (percent) bucketed into `binCount` equal-width bins. */
export const returnHistogram = (
  trades: readonly ReportTrade[],
  binCount = 10,
): { from: number; to: number; winners: number; losers: number }[] => {
  const returns = trades.map(tradeReturnPercent);
  if (returns.length === 0) return [];
  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const width = (max - min) / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, winners: 0, losers: 0 }));
  for (const value of returns) {
    const bin = bins[Math.min(binCount - 1, Math.floor((value - min) / width))]!;
    if (value > 0) bin.winners += 1;
    else bin.losers += 1;
  }
  return bins;
};

/** Net P&L per entry weekday (0 = Sunday) and per entry hour, in UTC. */
export const timePatterns = (trades: readonly ReportTrade[]): { byWeekday: number[]; byHour: number[] } => {
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const trade of trades) {
    const date = new Date(trade.entryTime);
    byWeekday[date.getUTCDay()]! += trade.profit;
    byHour[date.getUTCHours()]! += trade.profit;
  }
  return { byWeekday, byHour };
};

/** One trade as CSV rows (exit then entry, newest trade first), like TradingView's export. */
export const tradesCsv = (trades: readonly ReportTrade[]): string => {
  const header = "Trade #,Type,Signal,Date/Time,Price,Size,Net PnL,Return %";
  const rows = trades
    .map((trade, i) => {
      const side = isLong(trade) ? "Long" : "Short";
      const common = `${trade.qty},${trade.profit.toFixed(2)},${tradeReturnPercent(trade).toFixed(2)}`;
      return [
        `${i + 1},Exit ${side},${side},${new Date(trade.exitTime).toISOString()},${trade.exitPrice},${common}`,
        `${i + 1},Entry ${side},${side},${new Date(trade.entryTime).toISOString()},${trade.entryPrice},${common}`,
      ];
    })
    .reverse()
    .flat();
  return [header, ...rows].join("\n");
};
