import { describe, expect, test } from "bun:test";
import {
  buyHoldEquity, cagr, drawdownPeriods, maxDrawdown, periodPnl, profitFactor, returnHistogram,
  riskRatios, streaks, timePatterns, tradeReturnPercent, tradesCsv, type EquityPoint, type ReportTrade,
} from "./backtest-report";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 4); // Sunday, Oct 4 2026

const trade = (profit: number, overrides: Partial<ReportTrade> = {}): ReportTrade => ({
  entryTime: T0, exitTime: T0 + DAY, direction: "long", qty: 1, entryPrice: 100, exitPrice: 100 + profit, profit, ...overrides,
});

const curve = (values: readonly number[], closes: readonly number[] = values, stepMs = DAY): EquityPoint[] =>
  values.map((equity, i) => ({ time: T0 + i * stepMs, equity, close: closes[i]! }));

describe("trade statistics", () => {
  test("should express a trade's return as net P&L over entry value", () => {
    expect(tradeReturnPercent(trade(5, { qty: 2, entryPrice: 50 }))).toBe(5);
  });

  test("should compute profit factor as gross profit over gross loss", () => {
    expect(profitFactor([trade(30), trade(-10), trade(-5)])).toBe(2);
    expect(profitFactor([trade(3)])).toBe(Infinity);
    expect(profitFactor([])).toBe(0);
  });

  test("should count the longest winning and losing streaks, with breakevens ending both", () => {
    const profits = [1, 2, -1, -1, -1, 0, 4, 4, 4, 4];
    expect(streaks(profits.map((p) => trade(p)))).toEqual({ wins: 4, losses: 3 });
  });

  test("should bucket returns and split winners from losers", () => {
    const bins = returnHistogram([trade(-2), trade(-1), trade(3)], 2);
    expect(bins.map((b) => [b.losers, b.winners])).toEqual([[2, 0], [0, 1]]);
  });

  test("should sum P&L by UTC entry weekday and hour", () => {
    const { byWeekday, byHour } = timePatterns([trade(2, { entryTime: T0 + 3 * 3_600_000 }), trade(-1)]);
    expect(byWeekday[0]).toBe(1);
    expect(byHour[3]).toBe(2);
    expect(byHour[0]).toBe(-1);
  });

  test("should export newest trade first, exit row before entry row", () => {
    const lines = tradesCsv([trade(1), trade(-1, { direction: "short" })]).split("\n");
    expect(lines[1]).toStartWith("2,Exit Short");
    expect(lines[2]).toStartWith("2,Entry Short");
    expect(lines[3]).toStartWith("1,Exit Long");
  });
});

describe("equity statistics", () => {
  test("should measure max drawdown from the running peak", () => {
    expect(maxDrawdown(curve([100, 120, 90, 110, 80, 130]))).toEqual({ amount: 40, percent: (40 / 120) * 100 });
  });

  test("should grow buy and hold with the close from initial capital", () => {
    expect(buyHoldEquity(curve([0, 0, 0], [50, 60, 45]), 1000)).toEqual([1000, 1200, 900]);
  });

  test("should bucket realised P&L by exit period and buy-and-hold P&L by bar", () => {
    const equity = curve([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], [10, 11, 11, 11, 11, 11, 11, 12]);
    const weekly = periodPnl([trade(5, { exitTime: T0 + DAY }), trade(-2, { exitTime: T0 + 8 * DAY })], equity, 1000, "week");
    expect(weekly).toEqual([
      { start: T0, strategy: 5, buyHold: 100 },
      { start: T0 + 7 * DAY, strategy: -2, buyHold: 100 },
    ]);
  });

  test("should annualise growth over the curve's span", () => {
    expect(cagr(curve([1000, 1210], [1, 1], 365 * DAY), 1000)).toBeCloseTo(21, 6);
  });

  test("should need at least two monthly returns for Sharpe and Sortino", () => {
    expect(riskRatios(curve([1000, 1010]), 1000)).toEqual({ sharpe: undefined, sortino: undefined });
    const months = curve([1000, 1100, 1050, 1200], [1, 1, 1, 1], 31 * DAY);
    const { sharpe, sortino } = riskRatios(months, 1000);
    expect(sharpe).toBeGreaterThan(0);
    expect(sortino).toBeGreaterThan(sharpe!);
  });

  test("should average drawdown and run-up durations, open phases running to the end", () => {
    const periods = drawdownPeriods(curve([100, 90, 100, 110, 105, 104]));
    expect(periods.averageDrawdownMs).toBe((2 * DAY + 2 * DAY) / 2);
    expect(periods.averageRunupMs).toBe(4 * DAY);
  });
});
