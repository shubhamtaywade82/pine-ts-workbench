"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Power } from "lucide-react";
import { RealBinanceTradingSurface, type BinanceOpenOrder } from "@/lib/real-binance-trading-surface";
import type { BinanceSettings } from "@/components/trading/settings-dialog";

/**
 * Kill switch (P0 live-safety). One button that, after a typed
 * confirmation, cancels every open order on the symbol and market-sells
 * the held base asset — "cancel all + close all".
 *
 * The typed phrase gates fat-fingering; the result report shows exactly
 * what was canceled and what was flattened, with per-step errors.
 */

interface KillStepResult {
  readonly step: "cancel-all" | "flatten";
  readonly ok: boolean;
  readonly detail: string;
}

export function KillSwitch({ symbol, settings }: { symbol: string; settings: BinanceSettings }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<KillStepResult[] | null>(null);

  const armed = settings.apiKey !== "" && settings.apiSecret !== "" && settings.liveTradeEnabled;

  const run = useCallback(async () => {
    setRunning(true);
    setResults(null);
    const out: KillStepResult[] = [];
    const surface = new RealBinanceTradingSurface({
      apiKey: settings.apiKey,
      apiSecret: settings.apiSecret,
      liveTradeEnabled: settings.liveTradeEnabled,
    });

    // Step 1: snapshot + cancel every open order.
    try {
      const before: BinanceOpenOrder[] = await surface.getOpenOrders(symbol);
      const canceled = await surface.cancelAllOrders(symbol);
      out.push({
        step: "cancel-all",
        ok: true,
        detail: before.length === 0
          ? `No open orders on ${symbol}.`
          : `Canceled ${canceled}/${before.length} open orders on ${symbol}.`,
      });
    } catch (err) {
      out.push({
        step: "cancel-all",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // Step 2: flatten whatever base asset is still held.
    try {
      const order = await surface.flattenSpot(symbol);
      out.push({
        step: "flatten",
        ok: true,
        detail: order === undefined
          ? `No ${symbol} base balance to flatten.`
          : `Flattened: market SELL ${order.executedQty} (order ${order.orderId}, ${order.status}).`,
      });
    } catch (err) {
      out.push({
        step: "flatten",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    setResults(out);
    setRunning(false);
    setPhrase("");
  }, [symbol, settings]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
        title={armed ? "Cancel all orders + close all positions" : "Requires API keys + live trading enabled"}
        disabled={!armed}
        onClick={() => { setOpen(true); setResults(null); setPhrase(""); }}
      >
        <Power className="mr-1 h-3.5 w-3.5" />
        Kill Switch
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-500">Kill Switch — {symbol}</DialogTitle>
            <DialogDescription>
              Cancels every open order on {symbol} and market-sells the held base
              asset. This is the emergency stop — it cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {results === null ? (
            <>
              <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
                Mainnet action: real orders will be canceled and real balances sold at market.
                Slippage may apply to the flatten leg.
              </div>
              <div className="flex flex-col gap-1.5 py-1">
                <label htmlFor="kill-phrase" className="text-xs text-muted-foreground">
                  Type <span className="font-mono text-red-500">FLATTEN {symbol}</span> to arm:
                </label>
                <input
                  id="kill-phrase"
                  className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-red-500/60"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={`FLATTEN ${symbol}`}
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  disabled={running || phrase.trim().toUpperCase() !== `FLATTEN ${symbol}`}
                  onClick={run}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {running ? "Executing…" : "Execute Kill Switch"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="flex flex-col gap-2 py-1">
              {results.map((r) => (
                <div
                  key={r.step}
                  className={`flex items-start gap-2 rounded border p-2 text-xs ${
                    r.ok ? "border-border/60" : "border-red-500/50 bg-red-500/10"
                  }`}
                >
                  <Badge variant={r.ok ? "secondary" : "destructive"} className="mt-0.5 text-[9px]">
                    {r.step}
                  </Badge>
                  <span className="font-mono leading-relaxed">{r.detail}</span>
                </div>
              ))}
              <DialogFooter className="mt-2">
                <Button onClick={() => setOpen(false)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
