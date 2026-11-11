/**
 * Guard for orders placed by alerts. Alerts can fire unattended, so every order they place must
 * pass these caps first; a blocked order is never sent. The kill switch does not use this guard:
 * flattening must always work.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const ARM_PHRASE = "ARM LIVE ORDERS";

export interface OrderGuardLimits {
  /** Quote-asset notional cap for a single order. */
  readonly maxOrderNotional: number;
  readonly maxOrdersPerHour: number;
  /** Quote-asset notional cap across the rolling last 24 h. */
  readonly maxDailyNotional: number;
  readonly allowedSymbols: readonly string[];
  /** How long one typed confirmation keeps alert orders armed. */
  readonly armedForMs: number;
}

export const DEFAULT_ORDER_GUARD_LIMITS: OrderGuardLimits = {
  maxOrderNotional: 100,
  maxOrdersPerHour: 3,
  maxDailyNotional: 500,
  allowedSymbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
  armedForMs: DAY_MS,
};

export interface GuardState {
  readonly armedUntil: number | null;
  /** Orders placed in the last 24 h, oldest first. */
  readonly history: readonly { readonly at: number; readonly notional: number }[];
}

export const EMPTY_GUARD_STATE: GuardState = { armedUntil: null, history: [] };

export interface GuardedOrder {
  readonly symbol: string;
  readonly notional: number;
  readonly at: number;
}

export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const amount = (value: number): string => String(Number(value.toFixed(2)));

const since = (state: GuardState, from: number) => state.history.filter((entry) => entry.at > from);

/** Whether `order` may be sent now. Checks run cheapest-first and the first failure is the reason. */
export const checkOrder = (order: GuardedOrder, limits: OrderGuardLimits, state: GuardState): GuardVerdict => {
  if (state.armedUntil === null || order.at >= state.armedUntil) return { ok: false, reason: "Alert orders are not armed" };
  if (!limits.allowedSymbols.includes(order.symbol)) return { ok: false, reason: `${order.symbol} is not in the allowed symbols` };
  if (order.notional > limits.maxOrderNotional) {
    return { ok: false, reason: `Order notional ${amount(order.notional)} exceeds the ${amount(limits.maxOrderNotional)} limit` };
  }
  const lastHour = since(state, order.at - HOUR_MS).length;
  if (lastHour >= limits.maxOrdersPerHour) return { ok: false, reason: `${lastHour} orders already placed in the last hour` };
  const daily = since(state, order.at - DAY_MS).reduce((sum, entry) => sum + entry.notional, 0) + order.notional;
  if (daily > limits.maxDailyNotional) {
    return { ok: false, reason: `Daily notional would reach ${amount(daily)}, over the ${amount(limits.maxDailyNotional)} limit` };
  }
  return { ok: true };
};

/** Adds a sent order and drops entries older than 24 h, so the stored history stays bounded. */
export const recordOrder = (state: GuardState, order: GuardedOrder): GuardState => ({
  ...state,
  history: [...since(state, order.at - DAY_MS), { at: order.at, notional: order.notional }],
});

/** Arms alert orders only for the exact typed phrase; anything else leaves the state unchanged. */
export const arm = (
  state: GuardState,
  input: { readonly now: number; readonly phrase: string; readonly limits: OrderGuardLimits },
): GuardState => (input.phrase === ARM_PHRASE ? { ...state, armedUntil: input.now + input.limits.armedForMs } : state);

export const disarm = (state: GuardState): GuardState => ({ ...state, armedUntil: null });
