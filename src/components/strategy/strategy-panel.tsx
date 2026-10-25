"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CodeEditor } from "@/components/editor/code-editor";
import { Play, AlertCircle, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  runBacktest, loadStrategyCode, saveStrategyCode,
  DEFAULT_STRATEGY, type BacktestResult, type BacktestTrade,
} from "@/lib/strategy-runner";

/**
 * Strategy backtest UI — Wave 20. Users write a TypeScript strategy against
 * the pine-ts API (StrategyCodeTab, in the Pine Editor side panel) and see the
 * results (StrategyTester, in the bottom panel), like TradingView's split
 * between the Pine Editor and the Strategy Tester.
 */

const AUTO_RUN_DEBOUNCE_MS = 500;

export interface Backtest {
  readonly code: string;
  readonly setCode: (code: string) => void;
  readonly autoRun: boolean;
  readonly setAutoRun: (autoRun: boolean) => void;
  readonly running: boolean;
  readonly result: BacktestResult | null;
  readonly run: () => void;
}

/** Owns the strategy code and re-runs the backtest on edits (debounced) and on new bars (at once). */
export function useBacktest(bars: readonly Bar[], onTradesChange: (trades: BacktestTrade[]) => void): Backtest {
  const [code, setCode] = useState<string>(DEFAULT_STRATEGY);
  const [autoRun, setAutoRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => { setCode(loadStrategyCode()); }, []);
  useEffect(() => { saveStrategyCode(code); }, [code]);

  const runCode = useCallback(async (userCode: string) => {
    setRunning(true);
    const res = await runBacktest(userCode, bars);
    setResult(res);
    onTradesChange(res.ok && res.trades ? res.trades : []);
    setRunning(false);
  }, [bars, onTradesChange]);

  // Refs let the debounced and bar-driven runs use the latest code and bars.
  const codeRef = useRef(code);
  const runCodeRef = useRef(runCode);
  useEffect(() => { codeRef.current = code; runCodeRef.current = runCode; }, [code, runCode]);

  useEffect(() => {
    if (!autoRun) return;
    const timer = setTimeout(() => { void runCodeRef.current(codeRef.current); }, AUTO_RUN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, autoRun]);

  useEffect(() => {
    void runCodeRef.current(codeRef.current);
  }, [bars]);

  const run = useCallback(() => { void runCodeRef.current(codeRef.current); }, []);
  return { code, setCode, autoRun, setAutoRun, running, result, run };
}

/** Strategy code tab of the Pine Editor panel. */
export function StrategyCodeTab({ backtest }: { backtest: Backtest }) {
  const { code, setCode, autoRun, setAutoRun, running, result, run } = backtest;
  return (
    <div className="flex h-full flex-col bg-[#131722]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold text-[#d1d4dc]">Strategy</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Switch id="strategy-auto-run" checked={autoRun} onCheckedChange={setAutoRun} />
            <Label htmlFor="strategy-auto-run" className="text-xs text-muted-foreground">Auto-update</Label>
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={run} disabled={running}>
            <Play className="mr-1 h-3.5 w-3.5" /> {running ? "Running…" : "Run"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeEditor value={code} onChange={setCode} error={null} />
      </div>
      {result !== null && !result.ok && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 font-mono text-[11px] text-[#f23645]">{result.error}</div>
      )}
    </div>
  );
}

/** Bottom Strategy Tester panel: summary, equity curve, trade list. */
export function StrategyTester({ result }: { result: BacktestResult | null }) {
  const summary = result?.summary;
  if (result === null) return <TesterMessage text="Run a strategy from the Pine Editor to see results." />;
  if (!result.ok || summary === undefined) return <TesterMessage text={result.error ?? "Backtest failed."} isError />;
  const trades = result.trades ?? [];
  const equityCurve = result.equityCurve ?? [];
  return (
    <div className="flex h-full gap-3 overflow-hidden p-2">
      <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto">
        <Badge variant="default" className="w-fit text-[10px]">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          {summary.totalTrades} trades • {summary.winRate.toFixed(1)}% win
        </Badge>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <MetricCard label="Net P&L" value={`$${summary.netProfit.toFixed(2)}`} positive={summary.netProfit >= 0} />
          <MetricCard label="Final Equity" value={`$${summary.finalEquity.toFixed(2)}`} />
          <MetricCard label="Max DD" value={`$${summary.maxDrawdown.toFixed(2)}`} negative />
          <MetricCard label="Wins" value={String(summary.winTrades)} positive />
          <MetricCard label="Losses" value={String(summary.lossTrades)} negative />
          <MetricCard label="PF" value={summary.profitFactor === Infinity ? "∞" : summary.profitFactor.toFixed(2)} />
        </div>
        {equityCurve.length > 1 && <EquityCurve equityCurve={equityCurve} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] text-muted-foreground">List of trades ({trades.length})</span>
        <div className="flex-1 overflow-y-auto">
          {trades.slice().reverse().map((t, i) => <TradeRow key={i} trade={t} />)}
        </div>
      </div>
    </div>
  );
}

function TesterMessage({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center text-xs ${isError ? "text-[#f23645]" : "text-muted-foreground"}`}>
      {isError && <AlertCircle className="mr-1 h-3.5 w-3.5" />}{text}
    </div>
  );
}

function MetricCard({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="rounded border border-border/50 p-1">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className={`font-mono text-xs ${positive ? "text-green-500" : negative ? "text-red-500" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function EquityCurve({ equityCurve }: { equityCurve: { time: number; equity: number }[] }) {
  const values = equityCurve.map((e) => e.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 100;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="rounded border border-border/50 p-1">
      <div className="text-[9px] text-muted-foreground mb-1">Equity Curve</div>
      <svg viewBox="0 0 100 100" className="h-16 w-full" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={values[values.length - 1]! >= values[0]! ? "#26a69a" : "#ef5350"} strokeWidth="1" />
      </svg>
      <div className="flex justify-between text-[8px] text-muted-foreground">
        <span>${min.toFixed(0)}</span>
        <span>${max.toFixed(0)}</span>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: BacktestTrade }) {
  const isWin = trade.profit > 0;
  return (
    <div className="flex items-center justify-between border-b border-border/20 py-0.5 text-[9px]">
      <div className="flex items-center gap-1">
        {isWin ? <TrendingUp className="h-2.5 w-2.5 text-green-500" /> : <TrendingDown className="h-2.5 w-2.5 text-red-500" />}
        <span className="font-mono">{trade.direction.toUpperCase()}</span>
        <span className="text-muted-foreground">{trade.qty}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">@{trade.entryPrice.toFixed(2)}</span>
        <span>→</span>
        <span>@{trade.exitPrice.toFixed(2)}</span>
        <span className={`font-mono ${isWin ? "text-green-500" : "text-red-500"}`}>
          {isWin ? "+" : ""}{trade.profit.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
