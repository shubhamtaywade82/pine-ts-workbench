import type { BookSide } from "./order-book";

export interface LifecycleWall {
  readonly side: BookSide;
  readonly price: number;
  readonly notional: number;
}

export interface LifecycleContext {
  readonly at: number;
  readonly mid: number;
  readonly proximityPct: number;
  /** Prices no farther apart than this are one wall. Exact float equality is not identity. */
  readonly bucketWidth: number;
}

export type WallEventKind = "detected" | "increased" | "reduced" | "removed" | "pulled";

export interface WallEvent {
  readonly kind: WallEventKind;
  readonly side: BookSide;
  readonly price: number;
  readonly notional: number;
  readonly at: number;
}

const UP = 1.15;
const DOWN = 0.85;

interface MatchState {
  readonly events: WallEvent[];
  readonly previous: readonly LifecycleWall[];
  readonly context: LifecycleContext;
  readonly used: Set<number>;
}

const wallEvent = (kind: WallEventKind, wall: LifecycleWall, at: number): WallEvent => ({
  kind,
  side: wall.side,
  price: wall.price,
  notional: wall.notional,
  at,
});

const changeKind = (prior: number, next: number): "increased" | "reduced" | undefined => {
  if (!(prior > 0)) return undefined;
  if (next >= prior * UP) return "increased";
  if (next <= prior * DOWN) return "reduced";
  return undefined;
};

const findMatch = (previous: readonly LifecycleWall[], wall: LifecycleWall, width: number, used: Set<number>): number => {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < previous.length; index += 1) {
    const prior = previous[index];
    if (prior === undefined || used.has(index) || prior.side !== wall.side) continue;
    const distance = Math.abs(prior.price - wall.price);
    if (distance > width || distance >= bestDistance) continue;
    best = index;
    bestDistance = distance;
  }
  return best;
};

const noteCurrent = (state: MatchState, wall: LifecycleWall): void => {
  const width = Math.max(0, state.context.bucketWidth);
  const index = findMatch(state.previous, wall, width, state.used);
  if (index < 0) {
    state.events.push(wallEvent("detected", wall, state.context.at));
    return;
  }
  state.used.add(index);
  const prior = state.previous[index];
  if (prior === undefined) return;
  const change = changeKind(prior.notional, wall.notional);
  if (change !== undefined) state.events.push(wallEvent(change, wall, state.context.at));
};

/** Departure uses the mid in hand. The caller does not pass the closest approach. */
const leftEvent = (wall: LifecycleWall, context: LifecycleContext): WallEvent => {
  const span = context.mid > 0 ? (Math.abs(context.mid - wall.price) / context.mid) * 100 : 0;
  const kind = span > context.proximityPct ? "pulled" : "removed";
  return wallEvent(kind, wall, context.at);
};

export const wallIdentityWidth = (mid: number, tickSize?: number): number => {
  if (tickSize !== undefined && tickSize > 0) return tickSize;
  return mid * 0.0001;
};

export const diffWalls = (
  previous: readonly LifecycleWall[],
  current: readonly LifecycleWall[],
  context: LifecycleContext,
): WallEvent[] => {
  const state: MatchState = { events: [], previous, context, used: new Set() };
  for (const wall of current) noteCurrent(state, wall);
  for (const [index, wall] of previous.entries()) {
    if (state.used.has(index)) continue;
    state.events.push(leftEvent(wall, context));
  }
  return state.events;
};
