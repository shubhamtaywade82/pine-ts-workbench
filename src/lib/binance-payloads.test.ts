import { describe, expect, test } from "bun:test";
import { isBinanceTrade, isDepthSnapshot, isDepthUpdate } from "./binance-payloads";

const depthSnapshot = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  lastUpdateId: 100,
  bids: [["99.5", "1.5"]],
  asks: [["100.5", "2"]],
  ...overrides,
});

const depthUpdate = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  U: 10,
  u: 12,
  b: [["99.5", "1.5"]],
  a: [["100.5", "2"]],
  ...overrides,
});

const trade = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  e: "trade",
  t: 7,
  p: "101.25",
  q: "0.5",
  T: 1_700_000_000_000,
  m: true,
  ...overrides,
});

describe("isDepthUpdate", () => {
  test("accepts a valid depth payload", () => {
    expect(isDepthUpdate(depthUpdate())).toBe(true);
  });

  test("rejects a payload missing U", () => {
    const { U, ...rest } = depthUpdate() as Record<string, unknown>;
    expect(U).toBeDefined();
    expect(isDepthUpdate(rest)).toBe(false);
  });

  test("rejects a payload missing u", () => {
    const { u, ...rest } = depthUpdate() as Record<string, unknown>;
    expect(u).toBeDefined();
    expect(isDepthUpdate(rest)).toBe(false);
  });

  test("rejects U greater than u", () => {
    expect(isDepthUpdate(depthUpdate({ U: 13 }))).toBe(false);
  });

  test("rejects a non-numeric price string", () => {
    expect(isDepthUpdate(depthUpdate({ b: [["nope", "1"]] }))).toBe(false);
  });

  test("rejects a negative quantity string", () => {
    expect(isDepthUpdate(depthUpdate({ a: [["100.5", "-0.2"]] }))).toBe(false);
  });
});

describe("isBinanceTrade", () => {
  test("accepts a valid trade payload", () => {
    expect(isBinanceTrade(trade())).toBe(true);
  });

  test("rejects a non-boolean maker flag", () => {
    expect(isBinanceTrade(trade({ m: 1 }))).toBe(false);
  });

  test("rejects a payload missing the trade id t", () => {
    const { t, ...rest } = trade() as Record<string, unknown>;
    expect(t).toBeDefined();
    expect(isBinanceTrade(rest)).toBe(false);
  });

  test("rejects an unknown event type", () => {
    expect(isBinanceTrade(trade({ e: "kline" }))).toBe(false);
  });
});

describe("isDepthSnapshot", () => {
  test("accepts a valid depth snapshot", () => {
    expect(isDepthSnapshot(depthSnapshot())).toBe(true);
  });

  test("rejects a payload missing lastUpdateId", () => {
    const { lastUpdateId, ...rest } = depthSnapshot();
    expect(lastUpdateId).toBeDefined();
    expect(isDepthSnapshot(rest)).toBe(false);
  });

  test("rejects a bad level pair", () => {
    expect(isDepthSnapshot(depthSnapshot({ bids: [["nope", "1"]] }))).toBe(false);
    expect(isDepthSnapshot(depthSnapshot({ asks: [["100.5", "-1"]] }))).toBe(false);
  });
});
