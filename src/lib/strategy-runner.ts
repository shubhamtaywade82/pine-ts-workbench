"use client";

import { transform } from "sucrase";
import {
  StrategyEngine, PineRuntime, ta, type Bar, type PineContext,
} from "@nemesis-oss/pine-ts";

/**
 * Strategy runner — Wave 20. Takes user-written TypeScript strategy code,
 * transpiles it via sucrase, and runs it bar-by-bar against historical bars
 * using the pine-ts StrategyEngine + PaperBrokerAdapter (built-in emulator).
 *
 * The user writes a `strategy` function that receives `{ ta, ctx, engine, inputs }`
 * and calls `engine.entry(id, direction, qty)` / `engine.close(id)` / etc. on each
 * bar. After the run, the engine's results (netprofit, grossprofit, drawdown,
 * closedtrades, equity curve) are collected and returned.
 */

export interface BacktestResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: BacktestSummary;
  readonly trades?: BacktestTrade[];
  readonly equityCurve?: { time: number; equity: number }[];
}

export interface BacktestSummary {
  readonly initialCapital: number;
  readonly netProfit: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly maxDrawdown: number;
  readonly finalEquity: number;
  readonly totalTrades: number;
  readonly winTrades: number;
  readonly lossTrades: number;
  readonly winRate: number;
  readonly profitFactor: number;
}

export interface BacktestTrade {
  readonly entryTime: number;
  readonly exitTime: number;
  readonly direction: string;
  readonly qty: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly profit: number;
}

const DEFAULT_STRATEGY = `// SMA Crossover Strategy
// Entry: when close crosses above SMA(20) -> go long
// Exit:  when close crosses below SMA(20) -> close position

export function strategy({ ta, ctx, engine, inputs }: {
  ta: typeof import("@nemesis-oss/pine-ts").ta,
  ctx: import("@nemesis-oss/pine-ts").PineContext,
  engine: import("@nemesis-oss/pine-ts").strategy.StrategyEngine,
  inputs: Record<string, unknown>,
}) {
  const length = (inputs.length as number) ?? 20;
  const qty = (inputs.qty as number) ?? 0.001;
  const sma = ta.sma(ctx.close, length);

  if (ta.crossover(ctx.close, sma).at(0)) {
    engine.entry("long", "long", qty);
  }
  if (ta.crossunder(ctx.close, sma).at(0)) {
    engine.close("long");
  }
}
`;

// The pre-fix template: `if (ta.crossover(...))` tests a BooleanSeries object, which is
// always truthy, so it entered and exited every bar. Kept only to upgrade saved copies.
const LEGACY_DEFAULT_STRATEGY = `// SMA Crossover Strategy
// Entry: when close crosses above SMA(20) -> go long
// Exit:  when close crosses below SMA(20) -> close position

export function strategy({ ta, ctx, engine, inputs }: {
  ta: typeof import("@nemesis-oss/pine-ts").ta,
  ctx: import("@nemesis-oss/pine-ts").PineContext,
  engine: import("@nemesis-oss/pine-ts").strategy.StrategyEngine,
  inputs: Record<string, unknown>,
}) {
  const length = (inputs.length as number) ?? 20;
  const qty = (inputs.qty as number) ?? 0.001;
  const sma = ta.sma(ctx.close, length);

  if (ta.crossover(ctx.close, sma)) {
    engine.entry("long", "long", qty);
  }
  if (ta.crossunder(ctx.close, sma)) {
    engine.close("long");
  }
}
`;

const STORAGE_KEY = "pine-ts-workbench-strategy-code";

export const loadStrategyCode = (): string => {
  if (typeof window === "undefined") return DEFAULT_STRATEGY;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === null || saved === LEGACY_DEFAULT_STRATEGY ? DEFAULT_STRATEGY : saved;
  } catch { return DEFAULT_STRATEGY; }
};

export const saveStrategyCode = (code: string): void => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
};

/**
 * Runs a backtest: creates a StrategyEngine, sets it as active, drives a
 * PineRuntime bar-by-bar calling the user's strategy function, then collects
 * the engine's results.
 */
export async function runBacktest(
  userCode: string,
  bars: readonly Bar[],
  inputs: Record<string, unknown> = { length: 20, qty: 0.001 },
): Promise<BacktestResult> {
  try {
    // Strip `export` keyword (same fix as the Pine editor).
    const cleanCode = userCode.replace(/\bexport\s+(function|const|let|var)\b/g, "$1");
    const transpiled = transform(cleanCode, {
      transforms: ["typescript"],
      production: true,
    }).code;

    // Evaluate the user's strategy function.
    const wrapped = `
      ${transpiled}
      return typeof strategy === 'function' ? strategy : null;
    `;
    // eslint-disable-next-line no-new-func
    const factory = new Function(wrapped) as () => ((args: {
      ta: typeof ta;
      ctx: PineContext;
      engine: StrategyEngine;
      inputs: Record<string, unknown>;
    }) => void) | null;
    const strategyFn = factory();
    if (strategyFn === null) {
      return { ok: false, error: "No `strategy` function exported. Export function strategy({ ta, ctx, engine, inputs })." };
    }

    // Create a StrategyEngine (built-in emulator, no broker adapter).
    const engine = new StrategyEngine();
    engine.configure({
      // pine-ts 0.1.x uses `title` as the broker symbol (no setSymbol API).
      title: "BACKTEST",
      pyramiding: 1,
      initial_capital: 10_000,
      default_qty_type: "fixed",
      default_qty_value: 1,
      commission_type: "percent",
      commission_value: 0.1,
      slippage: 0,
      slippage_unit: "points",
      margin_long: 100,
      margin_short: 100,
    });

    // Create a PineRuntime with the bars.
    const testInfo = { ticker: "BACKTEST", tickerId: "BACKTEST", timezone: "UTC", type: "crypto" as const };
    const provider = {
      getHistoricalBars: async () => bars,
      streamBars: () => ({ [Symbol.asyncIterator]: async function* () { yield* []; } }),
      getSymbolInfo: async () => testInfo,
    };
    const runtime = new PineRuntime({ provider, symbol: "BACKTEST", timeframe: "1" });

    // Track equity per bar for the equity curve.
    const equityCurve: { time: number; equity: number }[] = [];

    // Drive the runtime bar-by-bar, calling the strategy on each bar.
    await runtime.run((ctx: PineContext) => {
      // PineRuntime doesn't drive the engine; fill orders queued on the
      // previous bar against this bar before the strategy places new ones.
      engine.processBar(ctx.bar);
      try {
        strategyFn({ ta, ctx, engine, inputs });
      } catch (err) {
        // Per-bar error — continue (the strategy might error on some bars).
      }
      equityCurve.push({ time: ctx.bar.time, equity: engine.equity });
    }, bars as never);

    // Collect results from the engine.
    const closedTrades = engine.getClosedTrades();
    const trades: BacktestTrade[] = closedTrades.map((t) => ({
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      direction: t.direction,
      qty: t.qty,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      profit: t.profit,
    }));

    const wins = trades.filter((t) => t.profit > 0);
    const losses = trades.filter((t) => t.profit <= 0);
    const grossProfit = engine.grossprofit;
    const grossLoss = engine.grossloss;
    const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0;

    const summary: BacktestSummary = {
      initialCapital: 10_000,
      netProfit: engine.netprofit,
      grossProfit,
      grossLoss,
      maxDrawdown: engine.max_drawdown,
      finalEquity: engine.equity,
      totalTrades: trades.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      profitFactor,
    };

    return { ok: true, summary, trades, equityCurve };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export { DEFAULT_STRATEGY };
