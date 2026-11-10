"use client";

import { useEffect, useState } from "react";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import type { LiquidityInteraction, LiquidityOutcome, OutcomeStats } from "@/lib/liquidity-outcomes";
import {
  CLASSIFIER_VERSION,
  ENOUGH_OUTCOMES,
  OUTCOME_SCAN_OPTIONS,
  outcomeStats,
  sessionCount,
  turnBreakShare,
} from "@/lib/outcome-donut";

export const formatShare = (ratio: number): string => `${Math.round(ratio * 100)}%`;

export const decisionCentre = (turned: number, broke: number): string => {
  const share = turnBreakShare(turned, broke);
  if (share === null || share.total < ENOUGH_OUTCOMES) return "Not enough data";
  return `${formatShare(share.turnedPct)} turned · n=${share.total}`;
};

export const decisionLine = (label: string, count: number, ratio: number | null): string =>
  ratio === null ? `${label} ${count}` : `${label} ${formatShare(ratio)} (${count})`;

export const formatCi = (ci: { low: number; high: number } | null): string | null =>
  ci === null ? null : `95% CI ${(ci.low * 100).toFixed(1)}–${(ci.high * 100).toFixed(1)}%`;

export const formatSince = (at: number | null): string =>
  at === null ? "—" : new Date(at).toISOString().slice(0, 10);

export const formatDuration = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
};

const RANGE_MS = 14 * 24 * 60 * 60 * 1000;
const REFRESH_MS = 60_000;
const SIDES = ["all", "bid", "ask"] as const;
type SideFilter = (typeof SIDES)[number];

interface ApiRow {
  readonly wallId: string;
  readonly side: string;
  readonly levelPrice: number;
  readonly detectedAt: number;
  readonly startAt: number;
  readonly resolvedAt: number | null;
  readonly outcome: LiquidityOutcome;
  readonly mfePct: number | null;
  readonly maePct: number | null;
  readonly classifierVersion: string;
}

const toInteraction = (row: ApiRow): LiquidityInteraction | undefined => {
  if (row.side !== "bid" && row.side !== "ask") return undefined;
  return {
    wallId: row.wallId,
    side: row.side,
    levelPrice: row.levelPrice,
    detectedAt: row.detectedAt,
    startAt: row.startAt,
    resolvedAt: row.resolvedAt,
    outcome: row.outcome,
    maxFavorableExcursionPct: row.mfePct ?? 0,
    maxAdverseExcursionPct: row.maePct ?? 0,
    classifierVersion: row.classifierVersion,
  };
};

const loadRows = async (symbol: string, side: SideFilter, signal: AbortSignal): Promise<LiquidityInteraction[]> => {
  const to = Date.now();
  const from = to - RANGE_MS;
  const sideQuery = side === "all" ? "" : `&side=${side}`;
  const response = await fetch(`/api/microstructure/interactions?symbol=${symbol}&from=${from}&to=${to}${sideQuery}`, { signal });
  if (!response.ok) throw new Error("load failed");
  const body = await response.json() as { ok?: boolean; interactions?: ApiRow[] };
  if (body.ok !== true || body.interactions == null) throw new Error("load failed");
  return body.interactions.flatMap((row) => {
    const interaction = toInteraction(row);
    return interaction === undefined ? [] : [interaction];
  });
};

const applyLoaded = (
  next: readonly LiquidityInteraction[] | undefined,
  setRows: (rows: readonly LiquidityInteraction[]) => void,
  setFailed: (failed: boolean) => void,
): void => {
  if (next === undefined) setFailed(true);
  else { setRows(next); setFailed(false); }
};

const reportLoadError = (error: unknown, signal: AbortSignal, fail: () => void): void => {
  if (signal.aborted) return;
  console.error(error);
  fail();
};

const useInteractions = (symbol: BinanceSymbol | undefined, side: SideFilter) => {
  const [rows, setRows] = useState<readonly LiquidityInteraction[]>([]);
  const [failed, setFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setRows([]);
    setSettled(false);
    if (symbol === undefined) return undefined;
    const controller = new AbortController();
    const pull = (): void => {
      const fail = (): void => { applyLoaded(undefined, setRows, setFailed); setSettled(true); };
      loadRows(symbol, side, controller.signal).then(
        (next) => { applyLoaded(next, setRows, setFailed); setSettled(true); },
        (error: unknown) => reportLoadError(error, controller.signal, fail),
      );
    };
    pull();
    const timer = window.setInterval(pull, REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [symbol, side]);
  return { rows, failed, settled };
};

const Donut = ({ turnedPct }: { turnedPct: number | null }) => {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const turned = (turnedPct ?? 0) * circumference;
  const broke = turnedPct === null ? "#444" : "#ff9800";
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" role="img">
      <title>Big levels: did price turn or break?</title>
      <circle cx="52" cy="52" r={radius} fill="none" stroke={broke} strokeWidth="12" />
      {turnedPct !== null && (
        <circle
          cx="52" cy="52" r={radius} fill="none" stroke="#26a69a" strokeWidth="12"
          strokeDasharray={`${turned} ${circumference - turned}`}
          transform="rotate(-90 52 52)"
        />
      )}
    </svg>
  );
};

const moveText = (value: number | null, n: number): string =>
  value === null || n < ENOUGH_OUTCOMES ? "—" : `${value.toFixed(2)}% (n=${n})`;

const EXTRA: readonly { key: LiquidityOutcome; label: string }[] = [
  { key: "PULLED_BEFORE_TOUCH", label: "Pulled before touch" },
  { key: "CONSUMED", label: "Consumed" },
  { key: "NO_REACTION", label: "No reaction" },
];

const OutcomeFacts = (props: {
  stats: OutcomeStats;
  sessions: number;
  ci: string | null;
  windowLabel: string;
}) => (
  <>
    <p>since {formatSince(props.stats.from)} · {props.sessions} sessions</p>
    {props.ci !== null && <p>{props.ci}</p>}
    <p>n={props.stats.n}</p>
    {EXTRA.map((item) => <p key={item.key}>{item.label} {props.stats.counts[item.key]}</p>)}
    <p>unresolved (data gaps) {props.stats.counts.UNRESOLVED}</p>
    <p>Avg MFE {moveText(props.stats.avgFavorableExcursionPct, props.stats.n)} · Avg MAE {moveText(props.stats.avgAdverseExcursionPct, props.stats.n)}</p>
    <p>Median to resolution {formatDuration(props.stats.medianResolutionMs)}</p>
    <p>Window {props.windowLabel} · classifier {CLASSIFIER_VERSION}</p>
  </>
);

const OutcomeBody = ({ rows }: { rows: readonly LiquidityInteraction[] }) => {
  const stats = outcomeStats(rows);
  const ready = stats.counts.TURNED + stats.counts.BROKE >= ENOUGH_OUTCOMES;
  const share = ready ? turnBreakShare(stats.counts.TURNED, stats.counts.BROKE) : null;
  const sessions = sessionCount(rows.filter((row) => row.classifierVersion === stats.classifierVersion).map((row) => row.startAt));
  const windowLabel = `${Math.round(OUTCOME_SCAN_OPTIONS.evaluationWindowMs / 60_000)} min`;
  return (
    <>
      <p className="text-foreground">Big levels: did price turn or break?</p>
      <div className="relative mx-auto my-1 h-[104px] w-[104px]">
        <Donut turnedPct={share?.turnedPct ?? null} />
        <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-foreground">
          {decisionCentre(stats.counts.TURNED, stats.counts.BROKE)}
        </p>
      </div>
      <p>{decisionLine("Turned", stats.counts.TURNED, share?.turnedPct ?? null)}</p>
      <p>{decisionLine("Broke", stats.counts.BROKE, share?.brokePct ?? null)}</p>
      <OutcomeFacts
        stats={stats}
        sessions={sessions}
        ci={share === null ? null : formatCi(share.ci)}
        windowLabel={windowLabel}
      />
    </>
  );
};

const EMPTY_OUTCOMES = "No outcome data yet — start the microstructure collector (see mini-services/microstructure-collector/README.md)";
const UNAVAILABLE_OUTCOMES = "Outcomes unavailable — has the database schema been applied? (npx prisma db push)";

const panelBody = (failed: boolean, settled: boolean, rows: readonly LiquidityInteraction[]) => {
  if (failed) return <p>{UNAVAILABLE_OUTCOMES}</p>;
  if (!settled) return null;
  if (rows.length === 0) return <p>{EMPTY_OUTCOMES}</p>;
  return <OutcomeBody rows={rows} />;
};

export function OutcomePanel({ symbol }: { symbol: BinanceSymbol | undefined }) {
  const [side, setSide] = useState<SideFilter>("all");
  const { rows, failed, settled } = useInteractions(symbol, side);
  if (symbol === undefined) return null;
  return (
    <aside className="pointer-events-auto absolute bottom-8 left-[19rem] z-20 max-h-72 w-56 overflow-auto rounded border border-border bg-popover/90 p-1.5 font-mono text-[10px] text-muted-foreground shadow">
      <div className="mb-1 flex gap-1">
        {SIDES.map((item) => (
          <button key={item} type="button" className={item === side ? "text-foreground" : ""} onClick={() => setSide(item)}>
            {item}
          </button>
        ))}
      </div>
      {panelBody(failed, settled, rows)}
    </aside>
  );
}
