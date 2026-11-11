import { describe, expect, it } from "bun:test";
import {
  ARM_PHRASE,
  DEFAULT_ORDER_GUARD_LIMITS,
  EMPTY_GUARD_STATE,
  arm,
  checkOrder,
  disarm,
  recordOrder,
  type GuardState,
} from "./order-guard";

const HOUR = 3_600_000;
const limits = DEFAULT_ORDER_GUARD_LIMITS;
const order = (notional: number, at = 10 * HOUR, symbol = "BTCUSDT") => ({ symbol, notional, at });
const armed = (at = 10 * HOUR): GuardState => arm(EMPTY_GUARD_STATE, { now: at, phrase: ARM_PHRASE, limits });

describe("order guard", () => {
  it("should block every order until armed", () => {
    expect(checkOrder(order(50), limits, EMPTY_GUARD_STATE)).toEqual({ ok: false, reason: "Alert orders are not armed" });
  });

  it("should only arm with the exact typed phrase", () => {
    expect(arm(EMPTY_GUARD_STATE, { now: 0, phrase: "arm live orders", limits })).toBe(EMPTY_GUARD_STATE);
    expect(armed(0).armedUntil).toBe(24 * HOUR);
  });

  it("should allow an order within every limit while armed", () => {
    expect(checkOrder(order(100), limits, armed())).toEqual({ ok: true });
  });

  it("should block once the arm has expired, and after disarm", () => {
    expect(checkOrder(order(50, 10 * HOUR + 24 * HOUR), limits, armed())).toMatchObject({ ok: false, reason: "Alert orders are not armed" });
    expect(checkOrder(order(50), limits, disarm(armed()))).toMatchObject({ ok: false });
  });

  it("should block an order over the per-order notional cap", () => {
    expect(checkOrder(order(100.01), limits, armed())).toEqual({ ok: false, reason: "Order notional 100.01 exceeds the 100 limit" });
  });

  it("should block a symbol outside the allowlist", () => {
    expect(checkOrder(order(50, 10 * HOUR, "DOGEUSDT"), limits, armed())).toEqual({ ok: false, reason: "DOGEUSDT is not in the allowed symbols" });
  });

  it("should block the fourth order inside a rolling hour and allow it once the hour has passed", () => {
    let state = armed();
    for (const at of [10 * HOUR, 10 * HOUR + 1_000, 10 * HOUR + 2_000]) state = recordOrder(state, order(10, at));
    expect(checkOrder(order(10, 10 * HOUR + 3_000), limits, state)).toEqual({ ok: false, reason: "3 orders already placed in the last hour" });
    expect(checkOrder(order(10, 11 * HOUR + 1), limits, state)).toEqual({ ok: true });
  });

  it("should block an order that would push the rolling 24 h notional over the cap", () => {
    let state = armed(0);
    for (const at of [0, 2 * HOUR, 4 * HOUR, 6 * HOUR, 8 * HOUR]) state = recordOrder(state, order(90, at));
    expect(checkOrder(order(60, 9 * HOUR), limits, state)).toEqual({ ok: false, reason: "Daily notional would reach 510, over the 500 limit" });
    expect(checkOrder(order(50, 9 * HOUR), limits, state)).toEqual({ ok: true });
  });

  it("should forget orders older than 24 h when recording", () => {
    const state = recordOrder(recordOrder(armed(0), order(90, 0)), order(10, 25 * HOUR));
    expect(state.history).toEqual([{ at: 25 * HOUR, notional: 10 }]);
  });
});
