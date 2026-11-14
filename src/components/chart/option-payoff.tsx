"use client";

import { useEffect, useState } from "react";
import type { ChainRow, ChainSummary } from "@/lib/option-chain";
import { payoffCurve, payoffRange, summarizePayoff, type LongOption } from "@/lib/option-payoff";
import type { LongSide } from "@/lib/option-filter";
import type { SymbolOption } from "@/lib/symbol-catalog";

const UP = "var(--up)";
const DOWN = "var(--down)";
const CURVE_STEPS = 80;
const CHART = { width: 420, height: 170, pad: 14 } as const;

type Side = "call" | "put";

const inr = (value: number): string => `${value < 0 ? "−" : ""}₹${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;
const points = (value: number): string => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;

// Lot sizes never change for a contract, so a lookup is kept for the session.
const lotCache = new Map<string, number | null>();

/** Units in one lot of the contract; undefined until known, null if Dhan does not list it. */
function useLotSize(segment: string, securityId: string | undefined): number | null | undefined {
  const key = securityId === undefined ? undefined : `${segment}:${securityId}`;
  const [lot, setLot] = useState<number | null | undefined>(key === undefined ? undefined : lotCache.get(key));
  useEffect(() => {
    if (key === undefined || securityId === undefined) { setLot(undefined); return; }
    const cached = lotCache.get(key);
    if (cached !== undefined) { setLot(cached); return; }
    setLot(undefined);
    let cancelled = false;
    void fetch(`/api/options/lot?${new URLSearchParams({ segment, securityId })}`)
      .then((res) => res.json() as Promise<{ ok: boolean; lotSize?: number | null }>)
      .then((body) => { if (!body.ok) return; lotCache.set(key, body.lotSize ?? null); if (!cancelled) setLot(body.lotSize ?? null); })
      .catch(() => undefined); // rupee figures just stay hidden
    return () => { cancelled = true; };
  }, [key, segment, securityId]);
  return lot;
}

const sideOf = (verdict: LongSide | undefined): Side => (verdict === "PE" ? "put" : "call");

/** What a long option pays at expiry, with the chain's levels marked: pick a contract, enter your price, read the risk. */
export function OptionPayoff({ symbol, summary, verdict }: { readonly symbol: SymbolOption; readonly summary: ChainSummary; readonly verdict: LongSide | undefined }) {
  const [side, setSide] = useState<Side>(sideOf(verdict));
  const [strike, setStrike] = useState(summary.atmStrike);
  const [entry, setEntry] = useState<string>("");
  const [lots, setLots] = useState(1);
  const rows = summary.rows.filter((row) => row[side] !== undefined);
  const row: ChainRow | undefined = rows.find((r) => r.strike === strike) ?? rows.find((r) => r.strike === summary.atmStrike) ?? rows[0];
  const leg = row?.[side];
  const entryPrice = entry === "" ? leg?.ltp : Number(entry);
  const lot = useLotSize(symbol.exchange === "BSE" ? "BSE_FNO" : "NSE_FNO", leg?.securityId);

  const option: LongOption | undefined = row !== undefined && entryPrice !== undefined && Number.isFinite(entryPrice) && entryPrice > 0
    ? { side, strike: row.strike, premium: entryPrice }
    : undefined;
  const figures = option === undefined ? undefined : summarizePayoff(option, summary.spot, summary.analytics, summary.straddle);
  const perLot = typeof lot === "number" ? lot * lots : undefined;
  const money = (perUnit: number): string => (perLot === undefined ? "" : ` · ${inr(perUnit * perLot)}`);

  return (
    <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded border border-border">
            {(["call", "put"] as const).map((s) => (
              <button key={s} type="button" onClick={() => { setSide(s); setEntry(""); }} className={`px-2 py-0.5 ${side === s ? "text-white" : "text-muted-foreground hover:text-foreground"}`} style={side === s ? { background: s === "call" ? UP : DOWN } : undefined}>
                Buy {s === "call" ? "CALL" : "PUT"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-muted-foreground">Strike
            <select value={row?.strike} onChange={(e) => { setStrike(Number(e.target.value)); setEntry(""); }} className="rounded border border-border bg-popover px-1 py-0.5 text-foreground" aria-label="Strike">
              {rows.map((r) => <option key={r.strike} value={r.strike}>{r.strike}{r.strike === summary.atmStrike ? " (ATM)" : ""}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">Entry
            <input type="number" min="0" step="0.05" value={entry} placeholder={leg?.ltp === undefined ? "" : leg.ltp.toFixed(2)} onChange={(e) => setEntry(e.target.value)} className="w-20 rounded border border-border bg-popover px-1 py-0.5 text-foreground" aria-label="Entry price" title="Your price. Left empty it uses the current price." />
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">Lots
            <input type="number" min="1" step="1" value={lots} onChange={(e) => setLots(Math.max(1, Math.floor(Number(e.target.value)) || 1))} className="w-14 rounded border border-border bg-popover px-1 py-0.5 text-foreground" aria-label="Lots" />
          </label>
        </div>
        {option === undefined || figures === undefined ? <p className="py-6 text-center text-muted-foreground">This contract has no price to work from. Enter one.</p> : <PayoffChart option={option} summary={summary} />}
      </div>
      {option !== undefined && figures !== undefined && (
        <div className="min-w-0 space-y-2">
          <div className="space-y-0.5">
            <Row label="Breakeven at expiry" value={figures.breakeven.toFixed(2)} />
            <Row label="Move needed from spot" value={`${points(figures.moveToBreakeven)} (${points(figures.moveToBreakevenPct)}%)`} />
            <Row label="Most you can lose" value={`${option.premium.toFixed(2)}${money(option.premium)}`} colour={DOWN} hint="A bought option cannot lose more than its premium" />
            {figures.isWithinExpectedMove !== undefined && (
              <Row label="Inside the expected move?" value={figures.isWithinExpectedMove ? "Yes" : "No"} colour={figures.isWithinExpectedMove ? UP : DOWN} hint="Whether the ATM straddle's priced move reaches your breakeven" />
            )}
            {leg?.theta !== undefined && <Row label="Time decay today" value={`${points(leg.theta)}${money(leg.theta)}`} hint="Premium lost per day at current theta" />}
            {typeof lot === "number" && <Row label="Lot size" value={`${lot} × ${lots}`} />}
          </div>
          <table className="data-table text-right">
            <thead className="text-muted-foreground"><tr><th className="py-0.5 text-left font-medium">If it expires at</th><th className="font-medium">Price</th><th className="font-medium">P&amp;L / unit</th>{perLot !== undefined && <th className="font-medium">P&amp;L</th>}</tr></thead>
            <tbody>
              {figures.targets.map((t) => (
                <tr key={t.label}>
                  <td className="py-0.5 text-left text-muted-foreground">{t.label}</td>
                  <td>{t.price.toFixed(0)}</td>
                  <td style={{ color: t.pnl >= 0 ? UP : DOWN }}>{points(t.pnl)}</td>
                  {perLot !== undefined && <td style={{ color: t.pnl >= 0 ? UP : DOWN }}>{inr(t.pnl * perLot)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground">Value at expiry only, ignoring fees and any exit before then. An option sold earlier keeps some time value, so it is usually worth more than shown at the edges. Not advice.</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, colour, hint }: { readonly label: string; readonly value: string; readonly colour?: string; readonly hint?: string }) {
  return <div className="flex items-baseline justify-between gap-3" title={hint}><span className="text-muted-foreground">{label}</span><span className="font-medium" style={{ color: colour }}>{value}</span></div>;
}

function PayoffChart({ option, summary }: { readonly option: LongOption; readonly summary: ChainSummary }) {
  const { width, height, pad } = CHART;
  const { from, to } = payoffRange(option, summary.spot, summary.analytics.oneSigmaMove ?? summary.straddle);
  const curve = payoffCurve(option, from, to, CURVE_STEPS);
  const pnls = curve.map((p) => p.pnl);
  const top = Math.max(...pnls, option.premium * 0.5);
  const bottom = Math.min(...pnls, -option.premium);
  const x = (price: number): number => pad + ((price - from) / (to - from)) * (width - 2 * pad);
  const y = (pnl: number): number => pad + ((top - pnl) / (top - bottom)) * (height - 2 * pad);
  const path = curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.price).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
  const zero = y(0);
  const marks: readonly (readonly [number, string, string])[] = [
    [summary.spot, "Spot", "var(--foreground)"],
    [option.side === "call" ? option.strike + option.premium : option.strike - option.premium, "Breakeven", "var(--warn)"],
  ];
  const lower = summary.analytics.lowerBreakeven;
  const upper = summary.analytics.upperBreakeven;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Profit and loss at expiry against the underlying's price">
      <defs>
        <clipPath id="payoff-above"><rect x="0" y="0" width={width} height={zero} /></clipPath>
        <clipPath id="payoff-below"><rect x="0" y={zero} width={width} height={height - zero} /></clipPath>
      </defs>
      {lower !== undefined && upper !== undefined && <rect x={x(lower)} y={pad} width={Math.max(0, x(upper) - x(lower))} height={height - 2 * pad} fill="rgba(41,98,255,0.10)"><title>Expected range from the ATM straddle</title></rect>}
      <line x1={pad} x2={width - pad} y1={zero} y2={zero} stroke="var(--muted-foreground)" strokeWidth="1" />
      <path d={path} fill="none" stroke={UP} strokeWidth="2" clipPath="url(#payoff-above)" />
      <path d={path} fill="none" stroke={DOWN} strokeWidth="2" clipPath="url(#payoff-below)" />
      <line x1={x(option.strike)} x2={x(option.strike)} y1={pad} y2={height - pad} stroke="var(--muted-foreground)" strokeDasharray="3 3"><title>Strike {option.strike}</title></line>
      {marks.map(([price, label, colour]) => (
        <g key={label}>
          <line x1={x(price)} x2={x(price)} y1={pad} y2={height - pad} stroke={colour} strokeDasharray="2 2" />
          <text x={x(price) + 3} y={pad + 8} fontSize="9" fill={colour}>{label} {price.toFixed(0)}</text>
        </g>
      ))}
    </svg>
  );
}
