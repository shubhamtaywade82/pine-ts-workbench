"use client";

import {
  StrategyEngine, PineRuntime, ta, type Bar, type PineContext, type StrategyScript,
} from "@nemesis-oss/pine-ts";
import { loadScript } from "@/lib/script-loader";
import type { EquityPoint } from "@/lib/backtest-report";

/**
 * Strategy runner — Wave 20. Takes user-written TypeScript strategy code,
 * transpiles it via sucrase, and runs it bar-by-bar against historical bars
 * using the pine-ts StrategyEngine (built-in emulator).
 *
 * The user writes `defineStrategy("Name", { ...declaration }, ({ close, strategy }) => ...)`
 * and places orders with `strategy.entry(id, direction, { when })` /
 * `strategy.close(id, { when })`. Legacy `strategy({ ta, ctx, engine, inputs })`
 * functions still run. After the run, the engine's results (netprofit,
 * grossprofit, drawdown, closedtrades, equity curve) are collected and returned.
 */

export interface BacktestResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: BacktestSummary;
  readonly trades?: BacktestTrade[];
  /** Equity and close per backtested bar, for the report and buy & hold. */
  readonly equityCurve?: EquityPoint[];
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

const DEFAULT_STRATEGY = `// SMA Crossover Strategy — runs once per bar, like Pine Script.
// Entry: close crosses above SMA(length) -> go long
// Exit:  close crosses below SMA(length) -> close position

defineStrategy("SMA Crossover", {
  initial_capital: 10_000,
  default_qty_value: 0.001,
  commission_type: "percent",
  commission_value: 0.1,
}, ({ close, input, strategy }) => {
  const sma = ta.sma(close, input.int(20, "Length", { min: 1 }));
  strategy.entry("long", "long", { when: ta.crossover(close, sma) });
  strategy.close("long", { when: ta.crossunder(close, sma) });
});
`;

// Earlier default templates; saved copies identical to one are upgraded.
const PREVIOUS_DEFAULT_STRATEGY = `// SMA Crossover Strategy
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
    const isStaleDefault = saved === LEGACY_DEFAULT_STRATEGY || saved === PREVIOUS_DEFAULT_STRATEGY;
    return saved === null || isStaleDefault ? DEFAULT_STRATEGY : saved;
  } catch { return DEFAULT_STRATEGY; }
};

export const saveStrategyCode = (code: string): void => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
};

type LegacyStrategyFn = (args: {
  ta: typeof ta;
  ctx: PineContext;
  engine: StrategyEngine;
  inputs: Record<string, unknown>;
}) => void;

interface EngineRun {
  readonly engine: StrategyEngine;
  readonly equityCurve: EquityPoint[];
}

/**
 * Runs a backtest of user code: a concise `defineStrategy(...)` script, or a
 * legacy `strategy({ ta, ctx, engine, inputs })` function.
 */
export async function runBacktest(
  userCode: string,
  bars: readonly Bar[],
  inputs: Record<string, unknown> = { length: 20, qty: 0.001 },
): Promise<BacktestResult> {
  try {
    const loaded = loadScript<LegacyStrategyFn>(userCode, "strategy");
    if (loaded.kind === "indicator") {
      return { ok: false, error: "This is an indicator; open it in the Indicator tab." };
    }
    const run = loaded.kind === "strategy"
      ? await runConcise(loaded.script, bars)
      : await runLegacy(loaded.fn, bars, inputs);
    return summarize(run);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Concise scripts backtest confirmed bars only: a forming bar would fill orders on unconfirmed prices. */
const runConcise = async (script: StrategyScript, bars: readonly Bar[]): Promise<EngineRun> => {
  const confirmed = bars.at(-1)?.isClosed === false ? bars.slice(0, -1) : bars;
  const output = await script.backtest(confirmed);
  return {
    engine: output.engine,
    equityCurve: output.equity.map((equity, i) => ({ time: confirmed[i]!.time, equity, close: confirmed[i]!.close })),
  };
};

/**
 * Legacy path: creates a StrategyEngine, drives a PineRuntime bar-by-bar
 * calling the user's strategy function.
 */
const runLegacy = async (
  strategyFn: LegacyStrategyFn,
  bars: readonly Bar[],
  inputs: Record<string, unknown>,
): Promise<EngineRun> => {
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

  const testInfo = { ticker: "BACKTEST", tickerId: "BACKTEST", timezone: "UTC", type: "crypto" as const };
  const provider = {
    getHistoricalBars: async () => bars,
    streamBars: () => ({ [Symbol.asyncIterator]: async function* () { yield* []; } }),
    getSymbolInfo: async () => testInfo,
  };
  const runtime = new PineRuntime({ provider, symbol: "BACKTEST", timeframe: "1" });
  const equityCurve: EquityPoint[] = [];

  await runtime.run((ctx: PineContext) => {
    // PineRuntime doesn't drive the engine; fill orders queued on the
    // previous bar against this bar before the strategy places new ones.
    engine.processBar(ctx.bar);
    try {
      strategyFn({ ta, ctx, engine, inputs });
    } catch {
      // Per-bar error — continue (the strategy might error on some bars).
    }
    equityCurve.push({ time: ctx.bar.time, equity: engine.equity, close: ctx.bar.close });
  }, bars as never);
  return { engine, equityCurve };
};

const summarize = ({ engine, equityCurve }: EngineRun): BacktestResult => {
  const trades: BacktestTrade[] = engine.getClosedTrades().map((t) => ({
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
    initialCapital: engine.config.initial_capital ?? 0,
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
};

export { DEFAULT_STRATEGY };
