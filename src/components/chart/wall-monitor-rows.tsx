"use client";

import type { ReactNode } from "react";
import { formatAge, formatNotional } from "@/components/chart/depth-walls-primitive";
import { compactQuantity, formatLadderPrice } from "@/components/chart/dom-ladder-layout";
import type { LifecycleContext, LifecycleWall, WallEvent } from "@/lib/wall-lifecycle";
import { diffWalls } from "@/lib/wall-lifecycle";

export const NEAREST_VISIBLE = 4;

/** Price has reached a wall once it is inside a fifth of the search window. */
export const reachedProximityPct = (windowPct: number): number =>
  Math.min(windowPct, Math.max(windowPct / 5, 0.02));

export interface BigLevelInput {
  readonly side: "bid" | "ask";
  readonly price: number;
  readonly quantity: number;
  readonly strength: number | null;
  readonly observedSince: number;
  readonly held: boolean;
}

export interface BigLevelRow {
  readonly key: string;
  readonly line: string;
  readonly held: boolean;
  readonly side: "bid" | "ask";
}

export interface PulledRow {
  readonly key: string;
  readonly line: string;
}

export interface BigLevelsModel {
  readonly buyerDistance: string;
  readonly sellerDistance: string;
  readonly shown: readonly BigLevelRow[];
  readonly hidden: readonly BigLevelRow[];
  readonly pulled: readonly PulledRow[];
}

interface PulledInput {
  readonly side: "bid" | "ask";
  readonly price: number;
  readonly notional: number;
  readonly at: number;
}

const distanceOf = (price: number, mid: number): number =>
  mid > 0 ? Math.abs(price - mid) : Number.POSITIVE_INFINITY;

const levelLine = (level: BigLevelInput, now: number): string => {
  const name = level.side === "bid" ? "Big Buyers" : "Big Sellers";
  const zone = `${formatLadderPrice(level.price)}–${formatLadderPrice(level.price)}`;
  const strength = level.strength === null ? "—× normal" : `${level.strength.toFixed(1)}× normal`;
  return `${name} ${zone} · ${compactQuantity(level.quantity)} · ${strength} · waiting ${formatAge(Math.max(0, now - level.observedSince))}`;
};

const pulledLine = (event: PulledInput, now: number, quote: string): string => {
  const name = event.side === "bid" ? "Big Buyers" : "Big Sellers";
  const size = `${formatNotional(event.notional)} ${quote}`;
  return `${name} ${formatLadderPrice(event.price)} · ${size} · ${formatAge(Math.max(0, now - event.at))}`;
};

export const spotDistance = (side: "bid" | "ask", levels: readonly BigLevelInput[], mid: number): string => {
  const onSide = side === "bid"
    ? (level: BigLevelInput) => level.price <= mid
    : (level: BigLevelInput) => level.price >= mid;
  const match = levels.filter((level) => level.side === side && onSide(level))
    .sort((left, right) => distanceOf(left.price, mid) - distanceOf(right.price, mid))[0];
  if (match === undefined) return side === "bid" ? "none below spot" : "none above spot";
  const gap = compactQuantity(distanceOf(match.price, mid));
  return side === "bid" ? `${gap} below spot` : `${gap} above spot`;
};

export interface BigLevelsContext {
  readonly mid: number;
  readonly now: number;
  readonly quote: string;
}

const toRow = (level: BigLevelInput, now: number): BigLevelRow => ({
  key: `${level.side}:${level.price}`,
  line: levelLine(level, now),
  held: level.held,
  side: level.side,
});

export const bigLevelsModel = (
  levels: readonly BigLevelInput[],
  ctx: BigLevelsContext,
  pulled: readonly PulledInput[],
): BigLevelsModel => {
  const rows = [...levels]
    .sort((left, right) => distanceOf(left.price, ctx.mid) - distanceOf(right.price, ctx.mid))
    .map((level) => toRow(level, ctx.now));
  return {
    buyerDistance: spotDistance("bid", levels, ctx.mid),
    sellerDistance: spotDistance("ask", levels, ctx.mid),
    shown: rows.slice(0, NEAREST_VISIBLE),
    hidden: rows.slice(NEAREST_VISIBLE),
    pulled: pulled.map((event) => ({
      key: `${event.side}:${event.price}:${event.at}`,
      line: pulledLine(event, ctx.now, ctx.quote),
    })),
  };
};

export const pulledEvents = (
  previous: readonly LifecycleWall[],
  current: readonly LifecycleWall[],
  context: LifecycleContext,
): WallEvent[] => diffWalls(previous, current, context).filter((event) => event.kind === "pulled");

export interface MonitorSnapshot {
  readonly status: string;
  readonly model: BigLevelsModel;
}

const Card = ({ title, body, tone }: { title: string; body: string; tone: string }) => (
  <div className="rounded border border-border px-1.5 py-1">
    <p className={tone}>{title}</p>
    <p className="text-foreground">{body}</p>
  </div>
);

const LevelRow = ({ row }: { row: BigLevelRow }) => (
  <li className={row.side === "bid" ? "text-[#089981]" : "text-[#f23645]"}>
    <p>{row.line}</p>
    {row.held && <p className="text-[#e6c200]">Strong Level (held)</p>}
  </li>
);

const Collapsed = ({ summary, children }: { summary: string; children: ReactNode }) => (
  <details className="mt-1">
    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">▸ {summary}</summary>
    {children}
  </details>
);

export interface BigLevelsBodyProps {
  readonly snapshot: MonitorSnapshot;
  readonly isExpanded?: boolean;
  readonly onToggle?: () => void;
}

const ExpandedLevelList = ({ snapshot }: { readonly snapshot: MonitorSnapshot }) => (
  <>
    <ul className="mt-1 flex flex-col gap-1">
      {snapshot.model.shown.map((row) => <LevelRow key={row.key} row={row} />)}
    </ul>
    {snapshot.model.hidden.length > 0 && (
      <Collapsed summary={`${snapshot.model.hidden.length} more big levels further away`}>
        <ul className="mt-1 flex flex-col gap-1">
          {snapshot.model.hidden.map((row) => <LevelRow key={row.key} row={row} />)}
        </ul>
      </Collapsed>
    )}
    {snapshot.model.pulled.length > 0 && (
      <Collapsed summary={`Recently pulled (${snapshot.model.pulled.length}) — left before price reached them`}>
        <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
          {snapshot.model.pulled.map((row) => <li key={row.key}>{row.line}</li>)}
        </ul>
      </Collapsed>
    )}
  </>
);

export const BigLevelsBody = ({ snapshot, isExpanded = false, onToggle }: BigLevelsBodyProps) => (
  <>
    <div className="flex items-center gap-1">
      <div className="grid flex-1 grid-cols-2 gap-1">
        <Card title="Big Buyers" body={snapshot.model.buyerDistance} tone="text-[#089981]" />
        <Card title="Big Sellers" body={snapshot.model.sellerDistance} tone="text-[#f23645]" />
      </div>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Hide big levels" : "Show big levels"}
        onClick={onToggle}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {isExpanded ? "▾" : "▸"}
      </button>
    </div>
    {snapshot.status !== "live" && <p className="mt-1">{snapshot.status}</p>}
    {isExpanded && <ExpandedLevelList snapshot={snapshot} />}
  </>
);
