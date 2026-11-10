import { EVALUATION_WINDOW_MS, type DataGap, type OutcomeTrade, type PricePoint } from "./liquidity-outcomes";
import type { WallTransitionRow } from "./market-recorder";

const SECOND_MS = 1_000;

export const TRADE_MARGIN_MS = 5 * 60 * 1000;

export interface StoredTrade {
  readonly payload: string;
  readonly receivedAt: number;
  readonly exchangeTime: number | null;
}

export interface StoredGap {
  readonly receivedAt: number;
  readonly payload: string;
}

interface TimedPrice { readonly at: number; readonly price: number }
interface SecondSlot { readonly low: TimedPrice; readonly high: TimedPrice }

const finite = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const slotWith = (slot: SecondSlot | undefined, trade: TimedPrice): SecondSlot => {
  if (slot === undefined) return { low: trade, high: trade };
  return {
    low: trade.price < slot.low.price ? trade : slot.low,
    high: trade.price > slot.high.price ? trade : slot.high,
  };
};

const orderedExtremes = (slot: SecondSlot): TimedPrice[] => {
  const points: TimedPrice[] =
    slot.low.at === slot.high.at
      ? [slot.low]
      : slot.low.at < slot.high.at
        ? [slot.low, slot.high]
        : [slot.high, slot.low];
  return points.map((point) => ({ at: point.at, price: point.price }));
};

/** Per-second high and low, so a touch and a spike in the same second both stay on the path. */
export const pathFromTrades = (trades: readonly TimedPrice[]): PricePoint[] => {
  const slots = new Map<number, SecondSlot>();
  for (const trade of trades) {
    if (!(trade.price > 0) || !Number.isFinite(trade.at)) continue;
    const key = Math.floor(trade.at / SECOND_MS);
    slots.set(key, slotWith(slots.get(key), trade));
  }
  return [...slots.keys()].sort((left, right) => left - right).flatMap((key) => {
    const slot = slots.get(key);
    return slot === undefined ? [] : orderedExtremes(slot);
  });
};

export const tradeFromPayload = (payload: string, fallbackAt: number): OutcomeTrade | undefined => {
  try {
    const raw = JSON.parse(payload) as { price?: unknown; quantity?: unknown; time?: unknown };
    const price = finite(raw.price);
    const quantity = finite(raw.quantity);
    if (price === undefined || quantity === undefined || !(price > 0) || !(quantity > 0)) return undefined;
    const time = finite(raw.time);
    return { price, quantity, at: time ?? fallbackAt };
  } catch {
    return undefined;
  }
};

export const tradeGapAt = (payload: string, receivedAt: number): number | undefined => {
  try {
    const raw = JSON.parse(payload) as { stream?: unknown };
    return raw.stream === "trade" ? receivedAt : undefined;
  } catch {
    return undefined;
  }
};

export const tradeLookbackStart = (now: number, windowMs: number, scanMs: number): number =>
  now - windowMs - scanMs - TRADE_MARGIN_MS;

interface ParsedGap {
  readonly stream?: string;
  readonly phase?: string;
}

const parseGap = (payload: string): ParsedGap | undefined => {
  try {
    const raw = JSON.parse(payload) as ParsedGap;
    return typeof raw.stream === "string" ? raw : undefined;
  } catch {
    return undefined;
  }
};

export interface GapRangeOptions {
  readonly evaluationWindowMs?: number;
  readonly lastEventBefore?: (beforeAt: number) => number | undefined;
}

interface GapCollectorState {
  readonly gaps: DataGap[];
  readonly restartTimes: number[];
  readonly openStarts: Map<string, number>;
  readonly options?: GapRangeOptions;
  lastEventAt: number | undefined;
}

const handleRestart = (state: GapCollectorState, restart: number): void => {
  state.restartTimes.push(restart);
  for (const startAt of state.openStarts.values()) {
    state.gaps.push({ from: startAt, to: restart });
  }
  state.openStarts.clear();
  const windowMs = state.options?.evaluationWindowMs ?? EVALUATION_WINDOW_MS;
  const downtimeFrom = state.options?.lastEventBefore?.(restart)
    ?? state.lastEventAt
    ?? Math.max(0, restart - windowMs);
  if (downtimeFrom < restart && !state.gaps.some((g) => g.from === downtimeFrom && g.to === restart)) {
    state.gaps.push({ from: downtimeFrom, to: restart });
  }
  state.openStarts.set("trade", restart);
  state.openStarts.set("depth", restart);
};

const handleStreamPhase = (state: GapCollectorState, stream: string, phase: string | undefined, at: number): void => {
  if (phase === "start") {
    if (!state.openStarts.has(stream)) state.openStarts.set(stream, at);
  } else if (phase === "end") {
    const startAt = state.openStarts.get(stream);
    if (startAt !== undefined) {
      state.gaps.push({ from: startAt, to: at });
      state.openStarts.delete(stream);
    }
  } else if (phase === undefined && stream === "trade") {
    state.gaps.push({ from: at, to: at });
  }
};

const processGapRow = (state: GapCollectorState, row: StoredGap): void => {
  const parsed = parseGap(row.payload);
  if (parsed === undefined) return;
  if (parsed.stream === "collector" && parsed.phase === "restart") {
    handleRestart(state, row.receivedAt);
  } else if (parsed.stream === "depth" || parsed.stream === "trade") {
    handleStreamPhase(state, parsed.stream, parsed.phase, row.receivedAt);
  }
  state.lastEventAt = row.receivedAt;
};

export const gapRangesFromEvents = (
  gapRows: readonly StoredGap[],
  now: number,
  options?: GapRangeOptions,
): { readonly gaps: readonly DataGap[]; readonly restartTimes: readonly number[] } => {
  const sorted = [...gapRows].sort((left, right) => left.receivedAt - right.receivedAt);
  const state: GapCollectorState = {
    gaps: [],
    restartTimes: [],
    openStarts: new Map(),
    options,
    lastEventAt: undefined,
  };
  for (const row of sorted) processGapRow(state, row);
  for (const startAt of state.openStarts.values()) state.gaps.push({ from: startAt, to: now });
  return {
    gaps: state.gaps.sort((left, right) => left.from - right.from),
    restartTimes: state.restartTimes,
  };
};

const lastRecordedEventBefore = (
  transitions: readonly WallTransitionRow[],
  tradeRows: readonly StoredTrade[],
  gapRows: readonly StoredGap[],
  at: number,
): number | undefined => {
  let latest: number | undefined;
  for (const t of transitions) if (t.at < at && (latest === undefined || t.at > latest)) latest = t.at;
  for (const t of tradeRows) {
    const time = t.exchangeTime ?? t.receivedAt;
    if (time < at && (latest === undefined || time > latest)) latest = time;
  }
  for (const g of gapRows) if (g.receivedAt < at && (latest === undefined || g.receivedAt > latest)) latest = g.receivedAt;
  return latest;
};

export const windowFrom = (
  transitions: readonly WallTransitionRow[],
  tradeRows: readonly StoredTrade[],
  gapRows: readonly StoredGap[],
  now = Date.now(),
) => {
  const trades = tradeRows.flatMap((row) => {
    const trade = tradeFromPayload(row.payload, row.exchangeTime ?? row.receivedAt);
    return trade === undefined ? [] : [trade];
  });
  const { gaps, restartTimes } = gapRangesFromEvents(gapRows, now, {
    lastEventBefore: (at) => lastRecordedEventBefore(transitions, tradeRows, gapRows, at),
  });
  const legacyGapTimes = gapRows.flatMap((row) => {
    const at = tradeGapAt(row.payload, row.receivedAt);
    return at === undefined ? [] : [at];
  });
  return {
    transitions,
    trades,
    path: pathFromTrades(trades),
    gaps,
    gapTimes: legacyGapTimes.length > 0 ? legacyGapTimes : gaps.map((g) => g.from),
    restartTimes,
  };
};
