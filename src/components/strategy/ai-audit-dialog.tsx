"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Check, TrendingUp, ShieldAlert, Cpu } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { BacktestSummary } from "@/lib/strategy-runner";
import type { ReportTrade } from "@/lib/backtest-report";

export interface AiAuditDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly strategyCode: string | null;
  readonly summary?: BacktestSummary;
  readonly trades?: readonly ReportTrade[];
  readonly onApplyOptimizedCode: (code: string) => void;
}

interface OptimizerResponse {
  readonly ok: boolean;
  readonly analysis?: string;
  readonly optimizedCode?: string;
  readonly iterations?: number;
  readonly error?: string;
}

export function AiAuditDialog({
  isOpen,
  onClose,
  strategyCode,
  summary,
  trades,
  onApplyOptimizedCode,
}: AiAuditDialogProps) {
  const [model, setModel] = useState("minicpm5-toolagent:latest");
  const [models, setModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<OptimizerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    fetchModels(setModels, setModel);
  }, [isOpen]);

  const handleRunAudit = async () => {
    if (!strategyCode || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await callOptimizer({ strategyCode, summary, trades, model });
      if (res.ok) {
        setResult(res);
      } else {
        setError(res.error ?? "Failed to optimize strategy");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (result?.optimizedCode) {
      onApplyOptimizedCode(result.optimizedCode);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-popover text-foreground border-border max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Quant Strategy Auditor & Autonomous Optimizer
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Analyze backtest performance metrics and run AI strategy optimization.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 py-2">
          {summary && (
            <div className="grid grid-cols-4 gap-2 rounded-md bg-background p-2.5 text-center text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px]">Net PnL</span>
                <span className={summary.netProfit >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                  ${summary.netProfit.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Max Drawdown</span>
                <span className="text-rose-400 font-semibold">${summary.maxDrawdown.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Profit Factor</span>
                <span className="font-semibold">{summary.profitFactor.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Win Rate</span>
                <span className="font-semibold">{(summary.winRate * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5" />
              <span>Model:</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
                disabled={isLoading}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {result?.iterations && (
              <span className="text-[11px] text-emerald-400">
                Audited & tested variations in {result.iterations} turns
              </span>
            )}
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}

          {result?.analysis && (
            <div className="flex flex-col gap-2 rounded bg-background p-3 text-xs leading-relaxed">
              <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" /> Agent Diagnostic Analysis
              </span>
              <div className="whitespace-pre-wrap text-muted-foreground font-sans">
                {result.analysis}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRunAudit}
              disabled={isLoading || !strategyCode}
              className="gap-1.5"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Auditing & Sweeping Parameters...
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Run AI Audit
                </>
              )}
            </Button>
            {result?.optimizedCode && (
              <Button size="sm" onClick={handleApply} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                <Check className="h-3.5 w-3.5" />
                Apply Optimized Strategy
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function fetchModels(setModels: (models: string[]) => void, setModel: (model: string) => void) {
  try {
    const res = await fetch("/api/ai/strategy-optimizer");
    if (!res.ok) return;
    const data = (await res.json()) as { models?: string[]; defaultModel?: string };
    if (data.models && data.models.length > 0) {
      setModels(data.models);
      if (data.defaultModel) setModel(data.defaultModel);
    }
  } catch {
    // Model fetch fails silently when server offline.
  }
}

async function callOptimizer(payload: {
  strategyCode: string;
  summary?: BacktestSummary;
  trades?: readonly ReportTrade[];
  model: string;
}): Promise<OptimizerResponse> {
  const res = await fetch("/api/ai/strategy-optimizer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: payload.strategyCode,
      summary: payload.summary,
      trades: payload.trades,
      model: payload.model,
    }),
  });
  return (await res.json()) as OptimizerResponse;
}
