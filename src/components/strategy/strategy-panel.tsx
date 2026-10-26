"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runBacktest, type BacktestResult, type BacktestTrade } from "@/lib/strategy-runner";
import { StrategyReport } from "@/components/strategy/strategy-report";

/**
 * Strategy backtest UI. The Pine Editor hands strategy code over; the
 * Strategy Tester (bottom panel) shows the report, like TradingView.
 */

export interface Backtest {
  readonly running: boolean;
  readonly result: BacktestResult | null;
}

/** Backtests `code` (null = no strategy yet) whenever it or the bars change. */
export function useBacktest(
  bars: readonly Bar[],
  code: string | null,
  onTradesChange: (trades: BacktestTrade[]) => void,
): Backtest {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const onTradesRef = useRef(onTradesChange);
  useEffect(() => { onTradesRef.current = onTradesChange; }, [onTradesChange]);

  useEffect(() => {
    if (code === null) return;
    let isCurrent = true;
    setRunning(true);
    void runBacktest(code, bars).then((res) => {
      if (!isCurrent) return;
      setResult(res);
      onTradesRef.current(res.ok && res.trades ? res.trades : []);
      setRunning(false);
    });
    return () => { isCurrent = false; };
  }, [bars, code]);

  return { running, result };
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
