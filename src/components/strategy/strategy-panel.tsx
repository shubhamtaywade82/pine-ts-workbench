"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CodeEditor } from "@/components/editor/code-editor";
import { Play, AlertCircle } from "lucide-react";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  runBacktest, loadStrategyCode, saveStrategyCode,
  DEFAULT_STRATEGY, type BacktestResult, type BacktestTrade,
} from "@/lib/strategy-runner";
import { StrategyReport } from "@/components/strategy/strategy-report";

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

/** Bottom Strategy Tester panel: TradingView-style metrics report and list of trades. */
export function StrategyTester({ result }: { result: BacktestResult | null }) {
  const summary = result?.summary;
  if (result === null) return <TesterMessage text="Run a strategy from the Pine Editor to see results." />;
  if (!result.ok || summary === undefined) return <TesterMessage text={result.error ?? "Backtest failed."} isError />;
  return (
    <StrategyReport
      trades={result.trades ?? []}
      equity={result.equityCurve ?? []}
      initialCapital={summary.initialCapital}
      currency="USD"
    />
  );
}

function TesterMessage({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center text-xs ${isError ? "text-[#f23645]" : "text-muted-foreground"}`}>
      {isError && <AlertCircle className="mr-1 h-3.5 w-3.5" />}{text}
    </div>
  );
}
