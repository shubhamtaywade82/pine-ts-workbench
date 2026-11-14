"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bar } from "@nemesis-oss/pine-ts";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useVerdictAlerts, type VerdictAlertMode } from "@/hooks/use-verdict-alerts";
import { startPolling } from "@/lib/visible-polling";
import { detectSignals, type Signal } from "@/lib/option-analytics";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";
import { optionLevelDrawings, RANGE_BACK_BARS } from "@/lib/option-chart-levels";
import { longOptionFilter, trendOf, type LongOptionFilter, type VixReading } from "@/lib/option-filter";
import type { ChainSummary } from "@/lib/option-chain";
import type { SymbolOption } from "@/lib/symbol-catalog";

/** Refresh pace while the chain is moving; it backs off toward the cap while answers stop changing (a closed market). */
const CHAIN_POLL_MS = 6_000;
const CHAIN_QUIET_POLL_MS = 60_000;
const OPTION_UNDERLYING_SEGMENTS: ReadonlySet<string> = new Set(["IDX_I", "NSE_EQ", "BSE_EQ"]);

export interface OptionUnderlying { readonly segment: string; readonly securityId: string }

/** The Dhan instrument whose option chain applies to this symbol; undefined for contracts, futures and crypto. */
export const optionUnderlyingOf = (symbol: SymbolOption): OptionUnderlying | undefined =>
  symbol.provider === "dhan" && symbol.dhanSegment !== undefined && symbol.dhanSecurityId !== undefined
    && OPTION_UNDERLYING_SEGMENTS.has(symbol.dhanSegment)
    ? { segment: symbol.dhanSegment, securityId: symbol.dhanSecurityId }
    : undefined;

const query = (underlying: OptionUnderlying, extra: Record<string, string> = {}): string =>
  new URLSearchParams({ segment: underlying.segment, securityId: underlying.securityId, ...extra }).toString();

/** Expiry dates of the symbol's options, soonest first. Empty while loading and for instruments without F&O. */
export function useOptionExpiries(underlying: OptionUnderlying | undefined): readonly string[] {
  const [expiries, setExpiries] = useState<readonly string[]>([]);
  const segment = underlying?.segment;
  const securityId = underlying?.securityId;

  useEffect(() => {
    setExpiries([]);
    if (segment === undefined || securityId === undefined) return;
    let cancelled = false;
    void fetch(`/api/options/expiries?${query({ segment, securityId })}`)
      .then((res) => res.json() as Promise<{ ok: boolean; expiries?: string[] }>)
      .then((body) => { if (!cancelled && body.ok) setExpiries(body.expiries ?? []); })
      .catch(() => undefined); // no panel is the right answer to "could not tell"
    return () => { cancelled = true; };
  }, [segment, securityId]);

  return expiries;
}

export interface Reading {
  readonly at: number;
  readonly spot: number;
  readonly pcr: number;
  readonly straddle: number | undefined;
  readonly bias: number;
}

export interface ChainState {
  /** undefined while the first answer loads; null when Dhan returned an empty chain. */
  readonly summary: ChainSummary | null | undefined;
  readonly error: string | null;
  /** When the server last read this chain from Dhan (epoch ms). */
  readonly asOf: number | undefined;
  /** One reading per refresh this session, oldest first, for trend lines. */
  readonly history: readonly Reading[];
  /** What changed between refreshes, newest first. */
  readonly signals: readonly Signal[];
}

/** Fields the server derives from the current time, so they differ on every read even when the market has not moved. */
const CLOCK_FIELDS: ReadonlySet<string> = new Set(["daysToExpiry", "oneSigmaMove"]);
/** Dhan recomputes implied volatility and the greeks with every call, so they drift in the 3rd decimal and beyond; the screen shows 2 at most. */
const SIGNIFICANT_DECIMALS = 2;

/** JSON replacer for comparing two reads of a chain by what a person could see change. */
export const changeKeyReplacer = (key: string, value: unknown): unknown => {
  if (CLOCK_FIELDS.has(key)) return undefined;
  return typeof value === "number" ? Number(value.toFixed(SIGNIFICANT_DECIMALS)) : value;
};

const EMPTY: ChainState = { summary: undefined, error: null, asOf: undefined, history: [], signals: [] };
const HISTORY_CAP = 180;
const SIGNALS_CAP = 30;

/** The expiry's chain, refreshed every few seconds while `enabled`, with this session's history and signals. */
export function useOptionChain(underlying: OptionUnderlying | undefined, expiry: string | undefined, enabled: boolean): ChainState {
  const [state, setState] = useState<ChainState>(EMPTY);
  const segment = underlying?.segment;
  const securityId = underlying?.securityId;

  useEffect(() => {
    setState(EMPTY);
    if (!enabled || expiry === undefined || segment === undefined || securityId === undefined) return;
    let cancelled = false;
    let last: ChainSummary | undefined;
    let lastKey = "";
    const fail = (error: string): void => setState((prev) => ({ ...prev, error }));
    const accept = (next: ChainSummary, asOf: number): void => {
      const at = Date.now();
      const found = last === undefined ? [] : detectSignals(last, next, at);
      last = next;
      const reading: Reading = { at, spot: next.spot, pcr: next.analytics.pcrOi, straddle: next.straddle, bias: next.analytics.bias.score };
      setState((prev) => ({
        summary: next,
        error: null,
        asOf,
        history: [...prev.history, reading].slice(-HISTORY_CAP),
        signals: [...found, ...prev.signals].slice(0, SIGNALS_CAP),
      }));
    };
    const load = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/options/chain?${query({ segment, securityId }, { expiry })}`);
        const body = (await res.json()) as { ok: boolean; summary?: ChainSummary | null; asOf?: number; error?: string };
        if (cancelled) return false;
        if (!body.ok) { fail(body.error ?? `HTTP ${res.status}`); return false; }
        const key = JSON.stringify(body.summary ?? null, changeKeyReplacer);
        // An identical answer changes nothing on screen: skip the history point, the signal check and the re-render.
        if (key === lastKey) return false;
        lastKey = key;
        if (body.summary == null) setState((prev) => ({ ...prev, summary: null, error: null }));
        else accept(body.summary, body.asOf ?? Date.now());
        return true;
      } catch (err) {
        if (!cancelled) fail(err instanceof Error ? err.message : String(err));
        return false;
      }
    };
    const stop = startPolling({ run: load, baseMs: CHAIN_POLL_MS, maxMs: CHAIN_QUIET_POLL_MS });
    return () => { cancelled = true; stop(); };
  }, [segment, securityId, expiry, enabled]);

  return state;
}

const VIX_POLL_MS = 60_000;
const VIX_QUIET_POLL_MS = 600_000;

/** India VIX with its one-year percentile, refreshed while `enabled`. Undefined while the first answer loads; null once it is known to be unavailable. */
export function useIndiaVix(enabled: boolean): VixReading | null | undefined {
  const [vix, setVix] = useState<VixReading | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let lastKey = "";
    const load = async (): Promise<boolean> => {
      try {
        const body = (await (await fetch("/api/options/vix")).json()) as { ok: boolean; vix?: VixReading | null };
        const key = JSON.stringify(body.vix ?? null);
        if (cancelled || !body.ok || key === lastKey) return false;
        lastKey = key;
        setVix(body.vix ?? null);
        return true;
      } catch {
        setVix((known) => known ?? null); // the filter simply runs without VIX
        return false;
      }
    };
    const stop = startPolling({ run: load, baseMs: VIX_POLL_MS, maxMs: VIX_QUIET_POLL_MS });
    return () => { cancelled = true; stop(); };
  }, [enabled]);
  return vix;
}

const NO_DRAWINGS: readonly ChartDrawing[] = [];

/**
 * Whether a chart should read its option chain: whenever the instrument has options and the overlay (lines and
 * HUD) is switched on, which it is by default, or while the panel is open even with the overlay off.
 */
export const shouldPollChain = (state: { readonly hasExpiries: boolean; readonly isOpen: boolean; readonly showLines: boolean }): boolean =>
  state.hasExpiries && (state.isOpen || state.showLines);

export interface OptionsDashboard {
  readonly underlying: OptionUnderlying | undefined;
  readonly expiries: readonly string[];
  readonly isOpen: boolean;
  readonly setIsOpen: (open: boolean) => void;
  readonly expiry: string | undefined;
  readonly setExpiry: (expiry: string) => void;
  readonly state: ChainState;
  readonly vix: VixReading | undefined;
  readonly filter: LongOptionFilter | undefined;
  readonly showLines: boolean;
  readonly setShowLines: (show: boolean) => void;
  /** The chain's levels as lines on the underlying chart; empty while the panel is closed or lines are off. */
  readonly drawings: readonly ChartDrawing[];
  /** The panel is hidden but its levels are still being kept on the chart. */
  readonly isLinesOnly: boolean;
  readonly alertMode: VerdictAlertMode;
  readonly setAlertMode: (mode: VerdictAlertMode) => void;
}

/** Everything the option panel and its chart lines need for one chart: expiries, chain, VIX, the long-option filter. */
export function useOptionsDashboard(symbol: SymbolOption, bars: readonly Bar[], intervalMs: number): OptionsDashboard {
  const underlying = optionUnderlyingOf(symbol);
  const expiries = useOptionExpiries(underlying);
  const [isOpen, setIsOpen] = useState(false);
  const [picked, setExpiry] = useState<string | undefined>(undefined);
  // One switch for the whole overlay (lines and HUD), remembered across reloads and shared by every chart.
  const [showLines, setShowLines] = usePersistedState("option-overlay", true);
  const expiry = picked !== undefined && expiries.includes(picked) ? picked : expiries[0];
  const isActive = shouldPollChain({ hasExpiries: expiries.length > 0, isOpen, showLines });
  const state = useOptionChain(underlying, expiry, isActive);
  // The HUD's verdict weighs VIX, so it is read whenever the chain is, or the HUD and the panel could disagree.
  const vixState = useIndiaVix(isActive);
  const vix = vixState ?? undefined;
  const { summary } = state;
  // Reduced to primitives so the filter and the lines are rebuilt when their inputs change, not on every bar tick.
  const trend = useMemo(() => trendOf(bars), [bars]);
  const trendDirection = trend?.direction;
  const trendPct = trend === undefined ? undefined : Number(trend.closeVsAveragePct.toFixed(2));
  const filter = useMemo(
    () => (summary ? longOptionFilter({ summary, trend: trendDirection === undefined || trendPct === undefined ? undefined : { direction: trendDirection, closeVsAveragePct: trendPct }, vix }) : undefined),
    [summary, trendDirection, trendPct, vix],
  );
  const [alertMode, setAlertMode] = usePersistedState<VerdictAlertMode>("option-verdict-alerts", "toast");
  // The verdict weighs VIX, so it is not final, and must not be compared, until VIX has answered one way or the other.
  useVerdictAlerts(symbol, filter, alertMode, state.history.length, vixState !== undefined);
  const lastTime = bars.at(-1)?.time;
  const startTime = bars[Math.max(0, bars.length - RANGE_BACK_BARS)]?.time;
  const drawings = useMemo(
    () => (isActive && showLines && summary ? optionLevelDrawings(summary, lastTime === undefined || startTime === undefined ? undefined : { startTime, lastTime }, intervalMs) : NO_DRAWINGS),
    [isActive, showLines, summary, startTime, lastTime, intervalMs],
  );
  return { underlying, expiries, isOpen, setIsOpen, expiry, setExpiry, state, vix, filter, showLines, setShowLines, drawings, isLinesOnly: isActive && !isOpen, alertMode, setAlertMode };
}
