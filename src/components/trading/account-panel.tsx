"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BinanceClient } from "@nemesis-oss/binance-sdk";
import type { BinanceSettings } from "@/components/trading/settings-dialog";

/**
 * Account panel — shows the Binance account balance + open orders for the
 * current symbol. Auto-refreshes every 10s when the panel is visible.
 *
 * Uses the `@nemesis-oss/binance-sdk` BinanceClient directly (no
 * RealBinanceTradingSurface wrapper) since the account surface is
 * read-only — no order submission involved.
 */

export interface AccountPanelProps {
  readonly symbol: string;
  readonly settings: BinanceSettings;
}

interface BalanceRow {
  readonly asset: string;
  readonly free: number;
  readonly locked: number;
}

interface OpenOrderRow {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: string;
  readonly type: string;
  readonly price: string;
  readonly origQty: string;
  readonly executedQty: string;
  readonly status: string;
}

export function AccountPanel({ symbol, settings }: AccountPanelProps) {
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (settings.apiKey === "" || settings.apiSecret === "") return;
    setLoading(true);
    setError(null);
    try {
      const client = new BinanceClient({
        apiKey: settings.apiKey,
        apiSecret: settings.apiSecret,
        testnet: settings.testnet,
      });
      const account = await client.spot.account.account();
      // Show only non-zero balances.
      const rows: BalanceRow[] = (account.balances ?? [])
        .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
        .filter((b) => b.free > 0 || b.locked > 0);
      setBalances(rows);

      const orders = await client.spot.trading.getOpenOrders({ symbol });
      const orderRows: OpenOrderRow[] = orders.map((o) => ({
        orderId: String(o.orderId),
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: String(o.price),
        origQty: String(o.origQty),
        executedQty: String(o.executedQty),
        status: o.status,
      }));
      setOpenOrders(orderRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [settings, symbol]);

  // Auto-refresh every 10s.
  useEffect(() => {
    if (settings.apiKey === "" || settings.apiSecret === "") return;
    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(interval);
  }, [refresh, settings]);

  const hasCreds = settings.apiKey !== "" && settings.apiSecret !== "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Account</span>
          <div className="flex items-center gap-2">
            <Badge variant={settings.testnet ? "secondary" : "destructive"} className="text-[10px]">
              {settings.testnet ? "TESTNET" : "MAINNET"}
            </Badge>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading || !hasCreds}>
              {loading ? "…" : "↻"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!hasCreds && (
          <p className="text-xs text-muted-foreground">
            Configure API credentials in Settings to view account info.
          </p>
        )}
        {hasCreds && error !== null && (
          <div className="rounded border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-600">
            {error}
          </div>
        )}
        {hasCreds && error === null && (
          <>
            {/* Balances */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Balances</span>
              {balances.length === 0 ? (
                <span className="text-xs text-muted-foreground">No balances.</span>
              ) : (
                balances.slice(0, 5).map((b) => (
                  <div key={b.asset} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{b.asset}</span>
                    <span className="font-mono">
                      {b.free.toFixed(4)}
                      {b.locked > 0 && (
                        <span className="ml-1 text-yellow-600">({b.locked.toFixed(4)} locked)</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Open orders */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Open Orders ({openOrders.length})</span>
              {openOrders.length === 0 ? (
                <span className="text-xs text-muted-foreground">No open orders for {symbol}.</span>
              ) : (
                openOrders.slice(0, 5).map((o) => (
                  <div key={o.orderId} className="flex flex-col gap-0.5 rounded border border-border/50 p-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <Badge variant={o.side === "BUY" ? "default" : "destructive"} className="text-[10px]">
                        {o.side}
                      </Badge>
                      <span className="text-muted-foreground">{o.type}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Price</span>
                      <span className="font-mono">{o.price}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Qty</span>
                      <span className="font-mono">{o.origQty}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
