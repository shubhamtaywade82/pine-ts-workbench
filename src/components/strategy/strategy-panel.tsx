"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CodeEditor } from "@/components/editor/code-editor";
import { Play, AlertCircle, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  runBacktest, loadStrategyCode, saveStrategyCode,
  DEFAULT_STRATEGY, type BacktestResult, type BacktestSummary, type BacktestTrade,
} from "@/lib/strategy-runner";

/**
 * Strategy backtest panel — Wave 20. A code editor where users write trading
 * strategies in TypeScript using the pine-ts API, run them against historical
 * bars via the StrategyEngine + built-in broker emulator, and see the results
 * (P&L summary, equity curve, trade list).
 */

export interface StrategyPanelProps {
  readonly bars: readonly Bar[];
  readonly onTradesChange?: (trades: BacktestTrade[]) => void;
}

export function StrategyPanel({ bars, onTradesChange }: StrategyPanelProps) {
  const [code, setCode] = useState<string>(DEFAULT_STRATEGY);
  const [autoRun, setAutoRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCode(loadStrategyCode()); }, []);
  useEffect(() => { saveStrategyCode(code); }, [code]);

  const run = useCallback(async (userCode: string) => {
    setRunning(true);
    const res = await runBacktest(userCode, bars);
    setResult(res);
    if (res.ok && res.trades && onTradesChange) {
      onTradesChange(res.trades);
    } else if (onTradesChange) {
      onTradesChange([]);
    }
    setRunning(false);
  }, [bars, onTradesChange]);

  useEffect(() => {
    if (!autoRun) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void run(code); }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, autoRun, run]);

  useEffect(() => {
    void run(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  const summary = result?.summary;
  const trades = result?.trades ?? [];
  const equityCurve = result?.equityCurve ?? [];

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Strategy Backtest</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Switch checked={autoRun} onCheckedChange={setAutoRun} />
            <Label className="text-[10px] text-muted-foreground">Auto</Label>
          </div>
          <Button size="sm" onClick={() => void run(code)} disabled={running}>
            <Play className="h-3 w-3 mr-1" /> {running ? "Running…" : "Run"}
          </Button>
        </div>
      </div>

      {/* Code editor */}
      <div className="h-40 shrink-0 overflow-hidden rounded border border-border">
        <CodeEditor value={code} onChange={setCode} error={null} />
      </div>

      {/* Status */}
      {result && (
        <Badge variant={result.ok ? "default" : "destructive"} className="text-[10px] w-fit">
          {result.ok ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
          {result.ok ? `${summary!.totalTrades} trades • ${summary!.winRate.toFixed(1)}% win` : result.error?.slice(0, 60)}
        </Badge>
      )}

      {/* Results */}
      {summary && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {/* P&L Summary */}
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <MetricCard label="Net P&L" value={`$${summary.netProfit.toFixed(2)}`} positive={summary.netProfit >= 0} />
            <MetricCard label="Final Equity" value={`$${summary.finalEquity.toFixed(2)}`} />
            <MetricCard label="Max DD" value={`$${summary.maxDrawdown.toFixed(2)}`} negative />
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            <MetricCard label="Trades" value={String(summary.totalTrades)} />
            <MetricCard label="Wins" value={String(summary.winTrades)} positive />
            <MetricCard label="Losses" value={String(summary.lossTrades)} negative />
            <MetricCard label="PF" value={summary.profitFactor === Infinity ? "∞" : summary.profitFactor.toFixed(2)} />
          </div>

          {/* Equity curve (mini sparkline) */}
          {equityCurve.length > 1 && <EquityCurve equityCurve={equityCurve} />}

          {/* Trade list */}
          {trades.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Trades ({trades.length})</span>
              <div className="max-h-40 overflow-y-auto">
                {trades.slice(-20).reverse().map((t, i) => (
                  <TradeRow key={i} trade={t} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
