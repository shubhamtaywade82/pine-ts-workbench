"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RealBinanceTradingSurface } from "@/lib/real-binance-trading-surface";
import type { BinanceSettings } from "@/components/trading/settings-dialog";

/**
 * Trading panel — order submission form for the chart's current symbol.
 *
 * Fields: side (buy/sell), type (market/limit/stop/stop-limit), qty,
 * price (for limit), stopPrice (for stop). Submit shows a confirmation
 * dialog with the full order spec + "submit" button.
 *
 * Safety:
 *  - Dry-run mode (liveTradeEnabled = false): form renders, but Submit
 *    throws a friendly error instead of placing a real order.
 *  - Always Binance mainnet: real orders require liveTradeEnabled in Settings.
 *  - Confirmation dialog before every submission, with the full spec.
 *
 * On submit: creates a RealBinanceTradingSurface (if not already cached),
 * calls newOrder(params), and shows the result (orderId, status, filledQty,
 * avgPrice). On error: shows the error message inline.
 */

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export interface TradingPanelProps {
  /** The symbol the chart is showing (e.g. "BTCUSDT"). */
  readonly symbol: string;
  /** The latest close price — used to prefill limit price. */
  readonly lastPrice: number;
  /** Binance settings (apiKey/secret/liveTradeEnabled). */
  readonly settings: BinanceSettings;
}

export interface OrderResult {
  readonly orderId: string;
  readonly status: string;
  readonly executedQty: number;
  readonly avgPrice: number | undefined;
  readonly rejectReason: string | undefined;
}

export function TradingPanel({ symbol, lastPrice, settings }: TradingPanelProps) {
  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<OrderType>("MARKET");
  const [qty, setQty] = useState<string>("0.001");
  const [price, setPrice] = useState<string>(lastPrice.toFixed(2));
  const [stopPrice, setStopPrice] = useState<string>(lastPrice.toFixed(2));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [surface, setSurface] = useState<RealBinanceTradingSurface | null>(null);

  // Prefill limit/stop price when lastPrice changes.
  useEffect(() => {
    setPrice(lastPrice.toFixed(2));
    setStopPrice(lastPrice.toFixed(2));
  }, [lastPrice]);

  // (Re)create the trading surface when settings change.
  useEffect(() => {
    if (settings.apiKey === "" || settings.apiSecret === "") {
      setSurface(null);
      return;
    }
    setSurface(new RealBinanceTradingSurface({
      apiKey: settings.apiKey,
      apiSecret: settings.apiSecret,
      liveTradeEnabled: settings.liveTradeEnabled,
    }));
  }, [settings]);

  const needsPrice = type === "LIMIT" || type === "STOP_LIMIT";
  const needsStop = type === "STOP" || type === "STOP_LIMIT";

  const onSubmit = useCallback(async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    setError(null);
    setResult(null);
    if (surface === null) {
      setError("Configure API credentials in Settings first.");
      setSubmitting(false);
      return;
    }
    try {
      const params = {
        symbol,
        side,
        type,
        quantity: Number(qty),
        price: needsPrice ? Number(price) : undefined,
        stopPrice: needsStop ? Number(stopPrice) : undefined,
        timeInForce: "GTC" as const,
        clientOrderId: `pine-ts-${Date.now()}`,
      };
      const res = await surface.newOrder(params);
      setResult({
        orderId: res.orderId,
        status: res.status,
        executedQty: res.executedQty,
        avgPrice: res.avgPrice,
        rejectReason: res.rejectReason,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [surface, symbol, side, type, qty, price, stopPrice, needsPrice, needsStop]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Trading — {symbol}</span>
          <Badge variant={settings.liveTradeEnabled ? "destructive" : "secondary"} className="text-[10px]">
            {settings.liveTradeEnabled
              ? "MAINNET ⚠"
              : "DRY-RUN"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={side === "BUY" ? "default" : "outline"}
            className={side === "BUY" ? "bg-green-600 hover:bg-green-700" : ""}
            onClick={() => setSide("BUY")}
          >
            Buy
          </Button>
          <Button
            variant={side === "SELL" ? "default" : "outline"}
            className={side === "SELL" ? "bg-red-600 hover:bg-red-700" : ""}
            onClick={() => setSide("SELL")}
          >
            Sell
          </Button>
        </div>

        {/* Order type */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Order Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as OrderType)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MARKET">Market</SelectItem>
              <SelectItem value="LIMIT">Limit</SelectItem>
              <SelectItem value="STOP">Stop</SelectItem>
              <SelectItem value="STOP_LIMIT">Stop-Limit</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Qty */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qty" className="text-xs text-muted-foreground">Quantity</Label>
          <Input
            id="qty"
            type="number"
            step="0.0001"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        {/* Price (for limit/stop-limit) */}
        {needsPrice && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price" className="text-xs text-muted-foreground">Limit Price</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        )}

        {/* Stop price (for stop/stop-limit) */}
        {needsStop && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stopPrice" className="text-xs text-muted-foreground">Stop Price</Label>
            <Input
              id="stopPrice"
              type="number"
              step="0.01"
              min="0"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        )}

        {/* Submit */}
        <Button
          disabled={submitting || surface === null}
          onClick={() => setConfirmOpen(true)}
          className={
            side === "BUY"
              ? "bg-green-600 hover:bg-green-700"
              : "bg-red-600 hover:bg-red-700"
          }
        >
          {submitting ? "Submitting…" : `${side === "BUY" ? "Buy" : "Sell"} ${qty} ${symbol}`}
        </Button>

        {surface === null && (
          <p className="text-xs text-muted-foreground">
            Configure API credentials in Settings to enable order submission.
          </p>
        )}

        {/* Result */}
        {result !== null && (
          <div className="rounded border border-border/50 p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Order</span>
              <span className="font-mono">{result.orderId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={result.status === "FILLED" ? "default" : "secondary"} className="text-[10px]">
                {result.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Filled</span>
              <span>{result.executedQty}</span>
            </div>
            {result.avgPrice !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Price</span>
                <span>{result.avgPrice}</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error !== null && (
          <div className="rounded border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Confirmation dialog */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Confirm Order</DialogTitle>
              <DialogDescription>
                {settings.liveTradeEnabled
                  ? "⚠ This order will be submitted to Binance MAINNET with REAL funds."
                  : "Live trading is disabled. This will throw an error (dry-run)."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1 py-2 text-xs">
              <Row label="Symbol" value={symbol} />
              <Row label="Side" value={side} />
              <Row label="Type" value={type} />
              <Row label="Quantity" value={qty} />
              {needsPrice && <Row label="Limit Price" value={price} />}
              {needsStop && <Row label="Stop Price" value={stopPrice} />}
              <Row label="Time in Force" value="GTC" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                onClick={onSubmit}
                className={side === "BUY" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              >
                Submit Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
