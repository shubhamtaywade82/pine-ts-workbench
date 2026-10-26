"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runBacktest, type BacktestResult, type BacktestTrade } from "@/lib/strategy-runner";
import { StrategyReport } from "@/components/strategy/strategy-report";
import type { ScriptSettings } from "@/lib/script-library";

/**
 * Strategy backtest UI. The Pine Editor hands strategy code over; the
 * Strategy Tester (bottom panel) shows the report, like TradingView.
 */

export interface Backtest {
  readonly running: boolean;
  readonly result: BacktestResult | null;
}

/** Backtests `code` (null = no strategy yet) with its settings whenever they or the confirmed bars change. */
export function useBacktest(
  bars: readonly Bar[],
  code: string | null,
  settings: Pick<ScriptSettings, "inputs" | "properties">,
  onTradesChange: (trades: BacktestTrade[]) => void,
): Backtest {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const onTradesRef = useRef(onTradesChange);
  useEffect(() => { onTradesRef.current = onTradesChange; }, [onTradesChange]);

  // Backtests use confirmed bars only, so forming-bar ticks needn't re-run them.
  const confirmed = bars.at(-1)?.isClosed === false ? bars.length - 1 : bars.length;
  const confirmedKey = `${confirmed}:${bars[confirmed - 1]?.time ?? 0}:${bars[0]?.time ?? 0}`;
  const barsRef = useRef(bars);
  // Declared before the backtest effect, so it runs first on the same commit.
  useEffect(() => { barsRef.current = bars; }, [bars]);

  useEffect(() => {
    if (code === null) return;
    let isCurrent = true;
    setRunning(true);
    void runBacktest(code, barsRef.current, settings).then((res) => {
      if (!isCurrent) return;
      setResult(res);
      onTradesRef.current(res.ok && res.trades ? res.trades : []);
      setRunning(false);
    });
    return () => { isCurrent = false; };
  }, [confirmedKey, code, settings]);

  return { running, result };
}

/** Bottom Strategy Tester panel: TradingView-style metrics report and list of trades. */
export function StrategyTester({ result, onOpenSettings }: { result: BacktestResult | null; onOpenSettings: () => void }) {
  const summary = result?.summary;
  if (result === null) return <TesterMessage text="Run a strategy from the Pine Editor to see results." />;
  if (!result.ok || summary === undefined) return <TesterMessage text={result.error ?? "Backtest failed."} isError />;
  return (
    <StrategyReport
      trades={result.trades ?? []}
      equity={result.equityCurve ?? []}
      initialCapital={summary.initialCapital}
      currency="USD"
      onOpenSettings={onOpenSettings}
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
