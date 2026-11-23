"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Coins, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clearCoindcxSettings, saveCoindcxSettings } from "@/lib/coindcx-settings";
import { useCoindcxPortfolio } from "@/hooks/use-coindcx-portfolio";
import { useLerpNumber } from "@/lib/coindcx-chart-levels";
import {
  calculateLiqDistance,
  marginCurrencySymbol,
  pairPriceSymbol,
  type CoindcxBalance,
  type CoindcxFuturesWallet,
  type CoindcxOrder,
  type CoindcxPosition,
} from "@/lib/coindcx-client";

export default function CoindcxPage() {
  const p = useCoindcxPortfolio();
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <CoindcxHeader
        isRefreshing={p.isLoading}
        streamStatus={p.streamStatus}
        isConnected={p.isConnected}
        onRefresh={p.refresh}
        onOpenConfig={() => setIsConfigOpen(true)}
        lastUpdated={p.lastUpdated}
      />
      <main className="flex-1 p-4 md:p-6 space-y-6 max-w-7xl w-full mx-auto">
        <ReadOnlyBanner />
        {!p.isConnected && <ConnectPrompt onOpenConfig={() => setIsConfigOpen(true)} />}
        {p.error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">Failed to connect: {p.error}</div>}
        <KpiSummary positions={p.positions} balances={p.balances} futuresWallets={p.futuresWallets} />
        <Tabs defaultValue="positions" className="space-y-4">
          <TabsList className="bg-muted/60 border border-border">
            <TabsTrigger value="positions">Active Positions ({p.positions.length})</TabsTrigger>
            <TabsTrigger value="orders">Open Orders ({p.orders.length})</TabsTrigger>
            <TabsTrigger value="history">Order History ({p.orderHistory.length})</TabsTrigger>
            <TabsTrigger value="balances">Wallets & Balances ({p.balances.length + p.futuresWallets.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="positions"><PositionsSection positions={p.positions} futuresWallets={p.futuresWallets} /></TabsContent>
          <TabsContent value="orders"><OrdersSection orders={p.orders} /></TabsContent>
          <TabsContent value="history"><OrderHistorySection history={p.orderHistory} /></TabsContent>
          <TabsContent value="balances"><BalancesSection balances={p.balances} futuresWallets={p.futuresWallets} /></TabsContent>
        </Tabs>
      </main>
      <ConfigSideSheet open={isConfigOpen} onOpenChange={setIsConfigOpen} currentKey={p.settings.apiKey} currentSecret={p.settings.apiSecret} isConnected={p.isConnected} />
    </div>
  );
}

function LerpNum({ value, decimals = 2, prefix = "", suffix = "", sign = false, className = "" }: {
  value: number; decimals?: number; prefix?: string; suffix?: string; sign?: boolean; className?: string;
}) {
  const n = useLerpNumber(value);
  const signPrefix = sign ? (n >= 0 ? "+" : "-") : "";
  const abs = sign ? Math.abs(n) : n;
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span className={className}>{signPrefix}{prefix}{formatted}{suffix}</span>;
}

function CoindcxHeader({ isRefreshing, streamStatus, isConnected, onRefresh, onOpenConfig, lastUpdated }: {
  isRefreshing: boolean; streamStatus: string; isConnected: boolean; onRefresh: () => void; onOpenConfig: () => void; lastUpdated: number | null;
}) {
  return (
    <header className="h-12 border-b border-border bg-card px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs"><Link href="/"><ArrowLeft className="h-4 w-4" />Workbench</Link></Button>
        <span className="text-muted-foreground/40">|</span>
        <div className="flex items-center gap-2 font-semibold text-sm"><Coins className="h-4 w-4 text-primary" /><span>CoinDCX Portfolio & Positions</span></div>
        <StreamBadge status={streamStatus} />
      </div>
      <div className="flex items-center gap-2">
        {lastUpdated && <span className="text-[11px] text-muted-foreground">Updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpenConfig}><KeyRound className="h-3.5 w-3.5" /><span>API Keys</span><Badge variant={isConnected ? "default" : "secondary"} className="text-[9px] h-4 px-1 font-normal">{isConnected ? "Connected" : "Not Set"}</Badge></Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRefresh} disabled={isRefreshing}><RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} /><span>Refresh</span></Button>
      </div>
    </header>
  );
}

function StreamBadge({ status }: { status: string }) {
  if (status === "live") return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-[10px] gap-1 h-5 px-1.5 font-normal"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />Live (WS)</Badge>;
  if (status === "polling") return <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-400 text-[10px] gap-1 h-5 px-1.5 font-normal"><Clock className="h-2.5 w-2.5" />Polling (10s)</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-[10px] gap-1 h-5 px-1.5 font-normal"><WifiOff className="h-2.5 w-2.5" />{status}</Badge>;
}

function ReadOnlyBanner() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-xs text-foreground">
      <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
      <div><p className="font-semibold text-primary">Read-Only Safety Guardrail Active</p><p className="text-muted-foreground">Order placement and trade mutations are strictly disabled. Your account data is viewed securely.</p></div>
    </div>
  );
}

function ConnectPrompt({ onOpenConfig }: { onOpenConfig: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-foreground">
      <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-500 shrink-0" /><span>CoinDCX API credentials not configured. Add read-only keys to load positions.</span></div>
      <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10 shrink-0" onClick={onOpenConfig}>Configure Keys</Button>
    </div>
  );
}

function KpiSummary({
  positions,
  balances,
  futuresWallets = [],
}: {
  positions: readonly CoindcxPosition[];
  balances: readonly CoindcxBalance[];
  futuresWallets?: readonly CoindcxFuturesWallet[];
}) {
  const inrWallet = futuresWallets.find((w) => w.currency === "INR");
  const usdtWallet = futuresWallets.find((w) => w.currency === "USDT");
  const inrSpot = balances.find((b) => b.currency === "INR");
  const inrPos = positions.filter((p) => p.marginCurrency === "INR");
  const inrMargin = inrPos.reduce((acc, p) => acc + p.margin, 0);
  const usdtMargin = positions.filter((p) => p.marginCurrency !== "INR").reduce((acc, p) => acc + p.margin, 0);
  const inrPnl = inrPos.reduce((acc, p) => acc + p.unrealizedPnl, 0);
  const usdtPnl = positions.filter((p) => p.marginCurrency !== "INR").reduce((acc, p) => acc + p.unrealizedPnl, 0);
  const notionalUsd = positions.reduce((acc, p) => acc + p.size * p.markPrice, 0);
  const isPosInr = inrPos.length > 0 || (inrWallet && inrWallet.balance > 0);
  const currSym = isPosInr ? "₹" : "$";
  const pnl = isPosInr ? inrPnl : usdtPnl;
  const margin = isPosInr ? inrMargin : usdtMargin;
  const availMargin = isPosInr ? (inrWallet?.availableBalance || inrSpot?.availableBalance || inrSpot?.balance || 0) : (usdtWallet?.availableBalance ?? 0);
  const lockedMargin = isPosInr ? (inrWallet?.lockedBalance || inrMargin) : (usdtWallet?.lockedBalance || margin);
  const walletBal = isPosInr ? (inrWallet?.balance || (lockedMargin + availMargin)) : (usdtWallet?.balance || (lockedMargin + availMargin));
  const totalVal = walletBal + pnl;
  const roe = margin > 0 ? (pnl / margin) * 100 : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card className="p-3 bg-card border-border"><p className="text-[11px] text-muted-foreground">Est. Total Value</p><p className="text-lg font-bold tabular-nums mt-1"><LerpNum value={totalVal} decimals={2} prefix={currSym} /></p><p className="text-[10px] text-muted-foreground">Wallet: <LerpNum value={walletBal} decimals={2} prefix={currSym} /> + PnL</p></Card>
      <Card className="p-3 bg-card border-border"><p className="text-[11px] text-muted-foreground">Active PnL</p><p className={`text-lg font-bold tabular-nums mt-1 ${pnl >= 0 ? "text-[#089981]" : "text-[#f23645]"}`}><LerpNum value={pnl} decimals={2} prefix={currSym} sign /></p><p className="text-[10px] text-muted-foreground"><LerpNum value={roe} decimals={1} sign suffix="% ROE" /> (on <LerpNum value={lockedMargin} decimals={1} prefix={currSym} />)</p></Card>
      <Card className="p-3 bg-card border-border"><p className="text-[11px] text-muted-foreground">Active Exposure</p><p className="text-lg font-bold tabular-nums mt-1">{positions.length} Open Position{positions.length === 1 ? "" : "s"}</p><p className="text-[10px] text-muted-foreground">Notional: <LerpNum value={notionalUsd} decimals={1} prefix="$" /></p></Card>
      <Card className="p-3 bg-card border-border"><p className="text-[11px] text-muted-foreground">Futures Wallet Balance</p><p className="text-lg font-bold tabular-nums mt-1"><LerpNum value={walletBal} decimals={2} prefix={currSym} /></p><p className="text-[10px] text-muted-foreground">Avail: <LerpNum value={availMargin} decimals={2} prefix={currSym} /> / Locked: <LerpNum value={lockedMargin} decimals={2} prefix={currSym} /></p></Card>
    </div>
  );
}

function PositionsSection({ positions, futuresWallets = [] }: { positions: readonly CoindcxPosition[]; futuresWallets?: readonly CoindcxFuturesWallet[] }) {
  const inrWallet = futuresWallets.find((w) => w.currency === "INR");
  return (
    <Card className="border-border bg-card">
      <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium">Active Futures Positions ({positions.length})</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="text-xs"><TableHead>Pair</TableHead><TableHead>Side</TableHead><TableHead>Size / Notional</TableHead><TableHead>Entry Price</TableHead><TableHead>Mark Price</TableHead><TableHead>Lev</TableHead><TableHead>Margin</TableHead><TableHead>Liq. Price</TableHead><TableHead>Unrealized PnL</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-6 text-xs text-muted-foreground">No open futures positions found.</TableCell></TableRow>
            ) : positions.map((pos) => {
              const liqDist = calculateLiqDistance(pos.markPrice, pos.liquidationPrice);
              const notional = pos.size * pos.markPrice;
              const pSym = pairPriceSymbol(pos.pair);
              const marginVal = pos.marginCurrency === "INR" && inrWallet && inrWallet.lockedBalance > 0 && positions.filter((x) => x.marginCurrency === "INR").length === 1 ? inrWallet.lockedBalance : pos.margin;
              return (
                <TableRow key={pos.id} className="text-xs font-mono">
                  <TableCell className="font-semibold font-sans"><div>{pos.pair}</div><Badge variant="secondary" className="text-[9px] h-3.5 px-1 font-normal">{pos.marginCurrency} Margin</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={pos.side === "LONG" ? "text-[#089981] border-[#089981]/40 bg-[#089981]/10" : "text-[#f23645] border-[#f23645]/40 bg-[#f23645]/10"}>{pos.side}</Badge></TableCell>
                  <TableCell><div><LerpNum value={pos.size} decimals={pos.size < 1 ? 4 : 2} /></div><div className="text-[10px] text-muted-foreground font-sans"><LerpNum value={notional} decimals={1} prefix="$" /></div></TableCell>
                  <TableCell><LerpNum value={pos.entryPrice} decimals={pos.entryPrice < 10 ? 3 : 2} prefix={pSym} /></TableCell>
                  <TableCell className="font-semibold"><LerpNum value={pos.markPrice} decimals={pos.markPrice < 10 ? 3 : 2} prefix={pSym} /></TableCell>
                  <TableCell><LerpNum value={pos.leverage} decimals={0} suffix="x" /></TableCell>
                  <TableCell><LerpNum value={marginVal} decimals={1} prefix={marginCurrencySymbol(pos.marginCurrency)} /></TableCell>
                  <TableCell className="text-[#f7b731]">{pos.liquidationPrice > 0 ? (<div><div><LerpNum value={pos.liquidationPrice} decimals={pos.liquidationPrice < 10 ? 3 : 2} prefix={pSym} /></div>{liqDist !== undefined && <div className="text-[10px] text-muted-foreground"><LerpNum value={liqDist} decimals={1} sign suffix="%" /></div>}</div>) : "—"}</TableCell>
                  <TableCell className={pos.unrealizedPnl >= 0 ? "text-[#089981] font-semibold" : "text-[#f23645] font-semibold"}><LerpNum value={pos.unrealizedPnl} decimals={2} prefix={marginCurrencySymbol(pos.marginCurrency)} sign /> (<LerpNum value={pos.pnlPercentage} decimals={1} sign suffix="%" />)</TableCell>
                  <TableCell className="text-right font-sans"><Button asChild variant="outline" size="sm" className="h-6 text-[10px] px-2"><Link href={`/?symbol=${encodeURIComponent(pos.pair)}`}>View on Chart</Link></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OrdersSection({ orders }: { orders: readonly CoindcxOrder[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium">Active Open Orders ({orders.length})</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="text-xs"><TableHead>Order ID</TableHead><TableHead>Pair</TableHead><TableHead>Side</TableHead><TableHead>Price</TableHead><TableHead>Quantity</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground">No active orders.</TableCell></TableRow>
            ) : orders.map((o) => (
              <TableRow key={o.id} className="text-xs font-mono">
                <TableCell>{o.id.slice(0, 8)}…</TableCell><TableCell className="font-sans font-medium">{o.pair}</TableCell><TableCell><Badge variant="outline" className={o.side === "buy" ? "text-[#089981]" : "text-[#f23645]"}>{o.side.toUpperCase()}</Badge></TableCell><TableCell><LerpNum value={o.price} decimals={o.price < 10 ? 3 : 2} prefix={pairPriceSymbol(o.pair)} /></TableCell><TableCell><LerpNum value={o.quantity} decimals={o.quantity < 1 ? 4 : 2} /></TableCell><TableCell><Badge variant="secondary" className="text-[10px]">{o.status}</Badge></TableCell><TableCell className="text-right font-sans"><Button asChild variant="ghost" size="sm" className="h-6 text-[10px] px-2"><Link href={`/?symbol=${encodeURIComponent(o.pair)}`}>Chart</Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OrderHistorySection({ history }: { history: readonly CoindcxOrder[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium">Order History ({history.length})</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="text-xs"><TableHead>Order ID</TableHead><TableHead>Pair</TableHead><TableHead>Side</TableHead><TableHead>Executed / Price</TableHead><TableHead>Quantity</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Time</TableHead></TableRow></TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground">No order history found.</TableCell></TableRow>
            ) : history.map((o) => (
              <TableRow key={o.id} className="text-xs font-mono">
                <TableCell>{o.id.slice(0, 8)}…</TableCell><TableCell className="font-sans font-medium">{o.pair}</TableCell><TableCell><Badge variant="outline" className={o.side === "buy" ? "text-[#089981]" : "text-[#f23645]"}>{o.side.toUpperCase()}</Badge></TableCell><TableCell><LerpNum value={o.avgPrice ?? o.price} decimals={(o.avgPrice ?? o.price) < 10 ? 3 : 2} prefix={pairPriceSymbol(o.pair)} /></TableCell><TableCell><LerpNum value={o.quantity} decimals={o.quantity < 1 ? 4 : 2} /></TableCell><TableCell><Badge variant={o.status === "filled" ? "default" : "secondary"} className="text-[10px]">{o.status}</Badge></TableCell><TableCell className="text-right font-sans text-muted-foreground">{new Date(o.createdAt).toLocaleTimeString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BalancesSection({ balances, futuresWallets = [] }: { balances: readonly CoindcxBalance[]; futuresWallets?: readonly CoindcxFuturesWallet[] }) {
  const all = [...futuresWallets.map((w) => ({ ...w, type: "Futures" })), ...balances.map((b) => ({ ...b, type: "Spot" }))];
  return (
    <Card className="border-border bg-card">
      <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium">Wallets & Asset Balances ({all.length})</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="text-xs"><TableHead>Wallet</TableHead><TableHead>Asset</TableHead><TableHead>Total Balance</TableHead><TableHead>Available</TableHead><TableHead>Locked</TableHead></TableRow></TableHeader>
          <TableBody>
            {all.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-4 text-xs text-muted-foreground">No balances loaded.</TableCell></TableRow>
            ) : all.map((b, i) => (
              <TableRow key={`${b.type}-${b.currency}-${i}`} className="text-xs font-mono">
                <TableCell className="font-sans"><Badge variant={b.type === "Futures" ? "default" : "secondary"} className="text-[9px] h-3.5 px-1 font-normal">{b.type}</Badge></TableCell>
                <TableCell className="font-semibold font-sans">{b.currency}</TableCell>
                <TableCell><LerpNum value={b.balance} decimals={b.currency === "INR" && b.balance < 1 ? 4 : 2} prefix={b.currency === "INR" ? "₹" : ""} /></TableCell>
                <TableCell><LerpNum value={b.availableBalance} decimals={b.currency === "INR" && b.availableBalance < 1 ? 4 : 2} prefix={b.currency === "INR" ? "₹" : ""} /></TableCell>
                <TableCell className="text-muted-foreground"><LerpNum value={b.lockedBalance} decimals={b.currency === "INR" && b.lockedBalance < 1 && b.lockedBalance > 0 ? 4 : 2} prefix={b.currency === "INR" ? "₹" : ""} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ConfigSideSheet({ open, onOpenChange, currentKey, currentSecret, isConnected }: {
  open: boolean; onOpenChange: (open: boolean) => void; currentKey: string; currentSecret: string; isConnected: boolean;
}) {
  const [apiKey, setApiKey] = useState(currentKey);
  const [apiSecret, setApiSecret] = useState(currentSecret);
  const [showSecret, setShowSecret] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  useEffect(() => { setApiKey(currentKey); setApiSecret(currentSecret); }, [currentKey, currentSecret]);
  const save = () => {
    saveCoindcxSettings({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), autoRefresh: true, refreshIntervalSec: 10 });
    setIsSaved(true);
    setTimeout(() => { setIsSaved(false); onOpenChange(false); }, 700);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full sm:max-w-md p-6 flex flex-col justify-between">
      <div className="space-y-4">
        <SheetHeader className="p-0 text-left"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><SheetTitle className="text-sm font-semibold">CoinDCX API Credentials</SheetTitle></div><Badge variant={isConnected ? "default" : "secondary"} className="text-[10px]">{isConnected ? "Connected" : "Disconnected"}</Badge></div><SheetDescription className="text-xs">Saved in browser localStorage and used only for read-only CoinDCX queries.</SheetDescription></SheetHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1"><Label className="text-xs">API Key</Label><Input type="text" placeholder="Paste CoinDCX API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="h-8 text-xs font-mono" /></div>
          <div className="space-y-1"><Label className="text-xs">API Secret</Label><div className="relative"><Input type={showSecret ? "text" : "password"} placeholder="Paste CoinDCX API Secret" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} className="h-8 text-xs font-mono pr-8" /><button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">{showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-2.5 text-[11px] text-muted-foreground"><p className="font-semibold text-foreground">Permission: Read Only</p><p>Futures & balances read only. Trade mutations and order placements are strictly blocked.</p></div>
      </div>
      <SheetFooter className="p-0 flex-row justify-between gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={() => { setApiKey(""); setApiSecret(""); clearCoindcxSettings(); }} className="h-8 text-xs">Clear</Button>
        <Button size="sm" onClick={save} className="h-8 text-xs">{isSaved ? "Saved!" : "Save & Connect"}</Button>
      </SheetFooter>
    </SheetContent></Sheet>
  );
}
