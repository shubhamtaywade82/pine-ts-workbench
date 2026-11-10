"use client";

import { useEffect, useRef, useState } from "react";
import type { BinanceSymbol } from "@/lib/public-binance-feed";
import type { DepthFeedState, DepthStatus } from "@/lib/depth-feed";
import { subscribeBook } from "@/lib/depth-feed-browser";
import type { BookView } from "@/lib/depth-walls";
import type { BookCoverage } from "@/lib/order-book";
import { formatPct } from "@/components/chart/depth-walls-primitive";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface BookCoveragePct {
  readonly bidPct: number;
  readonly askPct: number;
  readonly isFull: boolean;
}

export const formatAge = (ageMs: number | undefined): string => {
  if (ageMs === undefined || Number.isNaN(ageMs)) return "—";
  const safeMs = Math.max(0, ageMs);
  if (safeMs < 1_000) return "<1s";
  const seconds = Math.floor(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return remSec > 0 ? `${minutes}m ${remSec}s` : `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const computeCoverage = (
  bookOrCoverage: BookView | BookCoverage | undefined,
  midPrice?: number,
): BookCoveragePct | undefined => {
  if (!bookOrCoverage) return undefined;
  const isBook = "coverage" in bookOrCoverage;
  const coverage = isBook ? bookOrCoverage.coverage : bookOrCoverage;
  const mid = isBook
    ? (bookOrCoverage.bestBid !== undefined && bookOrCoverage.bestAsk !== undefined
        ? (bookOrCoverage.bestBid + bookOrCoverage.bestAsk) / 2
        : undefined)
    : midPrice;
  if (mid === undefined || mid <= 0) return undefined;
  const isInfinite = !Number.isFinite(coverage.askCeiling) || !Number.isFinite(coverage.bidFloor);
  if (isInfinite) return { bidPct: Number.POSITIVE_INFINITY, askPct: Number.POSITIVE_INFINITY, isFull: true };
  const bidPct = ((mid - coverage.bidFloor) / mid) * 100;
  const askPct = ((coverage.askCeiling - mid) / mid) * 100;
  const isFull = !Number.isFinite(bidPct) || !Number.isFinite(askPct);
  return { bidPct, askPct, isFull };
};

export const formatCoverage = (
  bookOrCoverage: BookView | BookCoverage | undefined,
  midPrice?: number,
): string => {
  const coverage = computeCoverage(bookOrCoverage, midPrice);
  if (!coverage) return "—";
  if (coverage.isFull) return "full";
  const bidStr = formatPct(coverage.bidPct);
  const askStr = formatPct(coverage.askPct);
  return `-${bidStr}% / +${askStr}%`;
};

export const dotColorClass = (status: DepthStatus | undefined): string => {
  switch (status) {
    case "live":
      return "bg-[#089981]";
    case "syncing":
    case "stale":
      return "bg-[#ff9800]";
    case "disconnected":
    default:
      return "bg-[#f23645]";
  }
};

interface DiagnosticsContentProps {
  readonly status: DepthStatus;
  readonly depthAge: string;
  readonly tradeAge: string;
  readonly coverage: string;
  readonly state?: DepthFeedState;
}

function DiagnosticsContent({ status, depthAge, tradeAge, coverage, state }: DiagnosticsContentProps) {
  return (
    <div className="space-y-1.5 font-mono text-[11px]">
      <div className="flex items-center justify-between border-b pb-1 font-sans text-xs font-semibold">
        <span>Depth Diagnostics</span>
        <span className="font-mono text-[10px] capitalize text-muted-foreground">{status}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        <span className="text-muted-foreground">Depth status</span>
        <span className="text-right capitalize">{status}</span>
        <span className="text-muted-foreground">Depth age</span>
        <span className="text-right">{depthAge}</span>
        <span className="text-muted-foreground">Trade age</span>
        <span className="text-right">{tradeAge}</span>
        <span className="text-muted-foreground">Coverage</span>
        <span className="text-right">{coverage}</span>
        <span className="text-muted-foreground">Gaps</span>
        <span className="text-right">{state?.gapCount ?? 0}</span>
        <span className="text-muted-foreground">Resyncs</span>
        <span className="text-right">{state?.resyncCount ?? 0}</span>
        <span className="text-muted-foreground">Snapshot fails</span>
        <span className="text-right">{state?.snapshotFailureCount ?? 0}</span>
        <span className="text-muted-foreground">Malformed</span>
        <span className="text-right">{state?.malformedCount ?? 0}</span>
      </div>
    </div>
  );
}

function useDepthDiagnosticsState(symbol: BinanceSymbol | undefined) {
  const latestRef = useRef<DepthFeedState | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<{ state?: DepthFeedState; now: number }>(() => ({ now: Date.now() }));

  useEffect(() => {
    if (!symbol) return;
    const sub = subscribeBook(symbol, undefined, (state) => {
      latestRef.current = state;
    });
    // Interval decouples UI re-renders from raw depth push rate (at most 1/s).
    const timer = setInterval(() => {
      setSnapshot({ state: latestRef.current, now: Date.now() });
    }, 1_000);
    setSnapshot({ state: latestRef.current, now: Date.now() });
    return () => {
      clearInterval(timer);
      sub.unsubscribe();
    };
  }, [symbol]);

  return snapshot;
}

export interface DepthDiagnosticsProps {
  readonly symbol: BinanceSymbol | undefined;
  readonly tradeAgeMs?: number;
}

export function DepthDiagnostics({ symbol, tradeAgeMs }: DepthDiagnosticsProps) {
  const { state, now } = useDepthDiagnosticsState(symbol);
  if (!symbol) return null;
  const status = state?.status ?? "disconnected";
  const depthAge = formatAge(state?.lastMessageAt ? now - state.lastMessageAt : undefined);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent/50 focus:outline-hidden"
          title={`Order book depth: ${status}`}
          aria-label="Order book depth diagnostics"
        >
          <span className={`inline-block h-2 w-2 rounded-full ${dotColorClass(status)}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2.5 text-xs" align="end" side="bottom">
        <DiagnosticsContent
          status={status}
          depthAge={depthAge}
          tradeAge={formatAge(tradeAgeMs)}
          coverage={formatCoverage(state?.book)}
          state={state}
        />
      </PopoverContent>
    </Popover>
  );
}
