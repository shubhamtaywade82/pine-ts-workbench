"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OptionsDashboard } from "@/hooks/use-option-chain";
import { contractSymbol, formatExpiry, type ChainLeg, type ChainRow, type ChainSummary } from "@/lib/option-chain";
import type { LongOptionFilter } from "@/lib/option-filter";
import type { SymbolOption } from "@/lib/symbol-catalog";
import { compactQuantity } from "@/components/chart/dom-ladder-layout";
import { OptionDashboard } from "@/components/chart/option-dashboard";
import { OptionPayoff } from "@/components/chart/option-payoff";

interface PanelProps {
  readonly symbol: SymbolOption;
  readonly dashboard: OptionsDashboard;
  readonly onOpenContract: (contract: SymbolOption) => void;
}

type Side = "call" | "put";

const UP = "var(--up)";
const DOWN = "var(--down)";
const num = (value: number | undefined, digits = 2): string => (value === undefined ? "–" : value.toFixed(digits));
const signed = (value: number): string => `${value > 0 ? "+" : ""}${compactQuantity(value)}`;

const HEIGHT_KEY = "pine-ts-workbench-option-panel-height";
const DEFAULT_HEIGHT = 340;
const MIN_HEIGHT = 160;
/** The panel never takes more than this share of the chart cell, so the chart stays usable. */
const MAX_SHARE = 0.85;
const KEY_STEP = 24;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The panel's height, remembered across sessions. Storage can be blocked, so it only ever improves the default. */
function usePanelHeight() {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(HEIGHT_KEY));
      if (saved >= MIN_HEIGHT) setHeight(saved);
    } catch { /* default height */ }
  }, []);
  const remember = (value: number): void => {
    try { window.localStorage.setItem(HEIGHT_KEY, String(Math.round(value))); } catch { /* not remembered */ }
  };
  return { height, setHeight, remember };
}

/** Option dashboard and chain for the open instrument: resizable by its top edge, collapsible and hideable from its header. */
export function OptionChainPanel({ symbol, dashboard, onOpenContract }: PanelProps) {
  const [tab, setTab] = useState<"dashboard" | "chain" | "payoff">("dashboard");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { height, setHeight, remember } = usePanelHeight();
  const panelRef = useRef<HTMLDivElement>(null);
  const { expiries, expiry, setExpiry, state, vix, filter, showLines, setShowLines, setIsOpen, alertMode, setAlertMode } = dashboard;
  const { summary, error } = state;
  const open = (row: ChainRow, side: Side) => {
    const securityId = row[side]?.securityId;
    if (expiry !== undefined && securityId !== undefined) onOpenContract(contractSymbol(symbol, { expiry, strike: row.strike, side, securityId }));
  };
  const maxHeight = (): number => (panelRef.current?.parentElement?.clientHeight ?? 600) * MAX_SHARE;

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelRef.current?.offsetHeight ?? height;
    const limit = maxHeight();
    let latest = startHeight;
    const move = (e: PointerEvent): void => { latest = clamp(startHeight + startY - e.clientY, MIN_HEIGHT, limit); setHeight(latest); };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      remember(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const resizeByKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = clamp(height + (event.key === "ArrowUp" ? KEY_STEP : -KEY_STEP), MIN_HEIGHT, maxHeight());
    setHeight(next);
    remember(next);
  };
  const resetHeight = (): void => { setHeight(DEFAULT_HEIGHT); remember(DEFAULT_HEIGHT); };

  return (
    <div
      ref={panelRef}
      className="flex shrink-0 flex-col border-t border-border bg-background text-[11px] tabular-nums"
      style={{ height: isCollapsed ? undefined : height }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the option panel (drag, or use the up and down arrow keys; double-click to reset)"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        onDoubleClick={resetHeight}
        className="h-1.5 shrink-0 cursor-row-resize bg-border/40 hover:bg-[#2962ff]/60 focus-visible:bg-[#2962ff]/60 focus-visible:outline-none"
        style={{ display: isCollapsed ? "none" : undefined }}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-background px-3 py-1.5">
        <select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="rounded border border-border bg-popover px-1.5 py-0.5 text-[11px] text-foreground"
          aria-label="Option expiry"
        >
          {expiries.map((date) => <option key={date} value={date}>{formatExpiry(date)} {date.slice(0, 4)}</option>)}
        </select>
        <div className="flex overflow-hidden rounded border border-border">
          {(["dashboard", "chain", "payoff"] as const).map((id) => (
            <button key={id} type="button" onClick={() => { setTab(id); setIsCollapsed(false); }} className={`px-2 py-0.5 capitalize ${tab === id ? "bg-[#2962ff] text-white" : "text-muted-foreground hover:text-foreground"}`}>{id}</button>
          ))}
        </div>
        {summary && <span className="text-muted-foreground">Spot <span className="font-medium text-foreground">{summary.spot}</span></span>}
        {vix && (
          <span className="text-muted-foreground" title="India VIX and its percentile among the last year's closes">
            VIX <span className="font-medium text-foreground">{vix.level.toFixed(1)}</span>{" "}
            <span style={{ color: vix.changePct > 0 ? DOWN : UP }}>{vix.changePct > 0 ? "+" : ""}{vix.changePct.toFixed(1)}%</span>{" "}
            · {vix.percentile.toFixed(0)}th pct
          </span>
        )}
        {filter && <FilterChip filter={filter} />}
        <a href={historyHref(symbol)} target="_blank" rel="noreferrer" className="text-[#2962ff] hover:underline" title="How this instrument's options behaved on past days (opens a new tab)">History ↗</a>
        {state.asOf !== undefined && <span className="text-muted-foreground" title="When the server last read this chain from Dhan">as of {new Date(state.asOf).toLocaleTimeString("en-GB", { hour12: false })}</span>}
        <label className="ml-auto flex items-center gap-1 text-muted-foreground" title="Tell me when the verdict changes (CALLS only / PUTS only / No long options). It must hold for two readings, at most one alert per 3 minutes. It never places orders.">
          Alert on change
          <select
            value={alertMode}
            onChange={(e) => setAlertMode(e.target.value as typeof alertMode)}
            className="rounded border border-border bg-popover px-1 py-0.5 text-[11px] text-foreground"
            aria-label="Verdict change alerts"
          >
            <option value="off">Off</option>
            <option value="toast">In the app</option>
            <option value="all">App + my alert channels</option>
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
          Lines and HUD on every F&O chart
        </label>
        {error && <span className="text-warn" title={error}>⚠ {summary ? "stale" : error}</span>}
        <button
          type="button"
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          className="rounded px-2 py-0.5 text-[14px] leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
          title={isCollapsed ? "Expand the panel" : "Collapse to this bar; the lines stay on the chart"}
          aria-label={isCollapsed ? "Expand the option panel" : "Collapse the option panel"}
        >
          {isCollapsed ? "▴" : "▾"}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded px-2 py-0.5 text-[14px] leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Hide the panel. The lines and HUD stay on the chart."
          aria-label="Hide the option panel"
        >
          ✕
        </button>
      </div>
      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {summary === undefined && !error && <p className="px-3 py-6 text-center text-muted-foreground">Loading option chain…</p>}
          {summary === null && <p className="px-3 py-6 text-center text-muted-foreground">No option chain for this expiry.</p>}
          {summary && tab === "dashboard" && <OptionDashboard summary={summary} state={state} vix={vix} filter={filter} />}
          {summary && tab === "chain" && <ChainView summary={summary} filter={filter} onOpen={open} />}
          {summary && tab === "payoff" && <OptionPayoff symbol={symbol} summary={summary} verdict={filter?.side} />}
        </div>
      )}
    </div>
  );
}

/** The expired-options history page for this instrument: an index by name, a stock by its Dhan id. */
const historyHref = (symbol: SymbolOption): string => {
  const name = (symbol.ticker.split(":")[1] ?? symbol.displayName).toUpperCase().replace(/^NIFTY\s*50$/, "NIFTY");
  return symbol.dhanSegment === "NSE_EQ"
    ? `/options-history?${new URLSearchParams({ securityId: symbol.dhanSecurityId ?? "", name, instrument: "OPTSTK" })}`
    : `/options-history?${new URLSearchParams({ name })}`;
};

const SIDE_COLOUR: Record<LongOptionFilter["side"], string> = { CE: UP, PE: DOWN, NONE: "var(--foreground)" };

function FilterChip({ filter }: { readonly filter: LongOptionFilter }) {
  return <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: SIDE_COLOUR[filter.side], border: `1px solid ${SIDE_COLOUR[filter.side]}` }} title="Rule-based read of positioning, trend and premium cost: see the Dashboard tab for every factor">{filter.label}</span>;
}

function ChainView({ summary, filter, onOpen }: { readonly summary: ChainSummary; readonly filter: LongOptionFilter | undefined; readonly onOpen: (row: ChainRow, side: Side) => void }) {
  const [showBoth, setShowBoth] = useState(false);
  const only: Side | undefined = !showBoth && filter?.side === "CE" ? "call" : !showBoth && filter?.side === "PE" ? "put" : undefined;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1 text-muted-foreground">
        <Figures summary={summary} />
        {filter && filter.side !== "NONE" && (
          <button type="button" className="ml-auto underline hover:text-foreground" onClick={() => setShowBoth((both) => !both)}>
            {showBoth ? `Show ${filter.side === "CE" ? "calls" : "puts"} only` : "Show both sides"}
          </button>
        )}
        {filter?.side === "NONE" && <span className="ml-auto text-warn">No long options right now: chain shown for reference</span>}
      </div>
      <ChainTable summary={summary} only={only} onOpen={onOpen} />
    </>
  );
}

function Figures({ summary }: { readonly summary: ChainSummary }) {
  const items: readonly (readonly [string, string, string])[] = [
    ["ATM", String(summary.atmStrike), ""],
    ["PCR", summary.analytics.pcrOi.toFixed(2), "Put OI ÷ call OI"],
    ["Max pain", String(summary.maxPain), "Expiry price where option writers pay least"],
    ["ATM IV", summary.atmIv === undefined ? "–" : `${summary.atmIv.toFixed(1)}%`, ""],
    ["Straddle", summary.straddle === undefined ? "–" : summary.straddle.toFixed(1), "ATM call + put: the move the market expects"],
  ];
  return <>{items.map(([label, value, hint]) => <span key={label} title={hint}>{label} <span className="font-medium text-foreground">{value}</span></span>)}</>;
}

const CALL_HEADERS = ["OI", "ΔOI", "IV", "Δ", "Θ", "LTP"] as const;

function ChainTable({ summary, only, onOpen }: { readonly summary: ChainSummary; readonly only: Side | undefined; readonly onOpen: (row: ChainRow, side: Side) => void }) {
  const maxOi = Math.max(1, ...summary.rows.flatMap((r) => [r.call?.oi ?? 0, r.put?.oi ?? 0]));
  const sides: readonly Side[] = only === undefined ? ["call", "put"] : [only];
  const headers = (side: Side): ReactNode[] => (side === "call" ? [...CALL_HEADERS] : [...CALL_HEADERS].reverse()).map((h, i) => <th key={`${side}${i}`} className="px-2 py-1 font-medium">{h}</th>);
  return (
    <table className="mx-auto w-full max-w-[980px] border-collapse text-right tabular-nums">
      <thead className="text-muted-foreground">
        <tr className="text-[10px]">
          {sides.includes("call") && <th colSpan={CALL_HEADERS.length} className="px-2 pt-1 text-center font-semibold text-up">CALLS <span className="font-normal text-muted-foreground">· shaded = in the money</span></th>}
          <th />
          {sides.includes("put") && <th colSpan={CALL_HEADERS.length} className="px-2 pt-1 text-center font-semibold text-down">PUTS</th>}
        </tr>
        <tr className="border-b border-panel-border">
          {sides.includes("call") && headers("call")}
          <th className="bg-panel px-2 py-1 text-center font-medium">Strike</th>
          {sides.includes("put") && headers("put")}
        </tr>
      </thead>
      <tbody>
        {summary.rows.map((row) => (
          <tr key={row.strike} className={`hover:bg-foreground/[0.06] ${row.strike === summary.atmStrike ? "bg-[#2962ff]/15 [&>td]:border-y [&>td]:border-[#2962ff]/50" : ""}`}>
            {sides.includes("call") && legCells(row, "call", maxOi, row.strike < summary.spot, () => onOpen(row, "call"))}
            <td className="border-x border-panel-border bg-panel px-2 text-center font-semibold text-foreground">{row.strike}</td>
            {sides.includes("put") && legCells(row, "put", maxOi, row.strike > summary.spot, () => onOpen(row, "put"))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One side's cells in column order: calls read OI … LTP toward the strike, puts mirror it. */
function legCells(row: ChainRow, side: Side, maxOi: number, isItm: boolean, onOpen: () => void): ReactNode[] {
  const leg = row[side];
  // In-the-money cells are shaded, as on exchange chains, so the spot's position reads at a glance.
  const itm = isItm ? "bg-foreground/[0.05]" : "";
  const cells: ReactNode[] = [
    <OiCell key="oi" leg={leg} maxOi={maxOi} side={side} />,
    <ChangeCell key="chg" leg={leg} itm={itm} />,
    <td key="iv" className={`px-2 text-muted-foreground ${itm}`}>{num(leg?.iv, 1)}</td>,
    <td key="delta" className={`px-2 text-muted-foreground ${itm}`} title="Delta">{num(leg?.delta)}</td>,
    <td key="theta" className={`px-2 text-muted-foreground ${itm}`} title="Theta: premium lost per day">{num(leg?.theta)}</td>,
    <PriceCell key="ltp" leg={leg} onOpen={onOpen} itm={itm} />,
  ];
  return side === "call" ? cells : cells.reverse();
}

function OiCell({ leg, maxOi, side }: { readonly leg: ChainLeg | undefined; readonly maxOi: number; readonly side: Side }) {
  const colour = `color-mix(in oklab, ${side === "call" ? UP : DOWN} 30%, transparent)`;
  const share = `${Math.round(((leg?.oi ?? 0) / maxOi) * 100)}%`;
  // Bars grow toward the strike column, so the two sides face each other.
  const direction = side === "call" ? "to left" : "to right";
  return (
    <td className="px-2" style={{ background: `linear-gradient(${direction}, ${colour} ${share}, transparent ${share})` }}>
      {leg === undefined ? "–" : compactQuantity(leg.oi)}
    </td>
  );
}

function ChangeCell({ leg, itm }: { readonly leg: ChainLeg | undefined; readonly itm: string }) {
  if (leg === undefined) return <td className={`px-2 ${itm}`}>–</td>;
  return <td className={`px-2 ${itm}`} style={{ color: leg.oiChange > 0 ? UP : leg.oiChange < 0 ? DOWN : undefined }}>{signed(leg.oiChange)}</td>;
}

function PriceCell({ leg, onOpen, itm }: { readonly leg: ChainLeg | undefined; readonly onOpen: () => void; readonly itm: string }) {
  const canOpen = leg?.securityId !== undefined;
  return (
    <td className={`px-2 ${itm}`}>
      <button type="button" disabled={!canOpen} onClick={onOpen} title={canOpen ? "Open this contract's chart" : undefined}
        className="font-medium text-foreground hover:text-[#2962ff] hover:underline disabled:no-underline disabled:opacity-50">{num(leg?.ltp)}</button>
    </td>
  );
}
