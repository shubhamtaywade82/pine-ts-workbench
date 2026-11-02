import { describe, expect, test } from "bun:test";
import {
  evaluateAlerts,
  evaluateWatchlistAlerts,
  fillPlaceholders,
  rearmRules,
  ruleTriggers,
  MAX_CONDITIONS_PER_RULE,
  type AlertContext,
  type AlertRule,
  type AlertSink,
  type FiredAlert,
} from "./alert-engine";

/** A recording sink so tests assert deliveries without network. */
const recordingSink = (log: string[]): AlertSink => ({
  id: "test-recorder",
  name: "Test recorder",
  deliver: async (event) => {
    log.push(event.message);
    return {
      sinkId: "test-recorder",
      sinkName: "Test recorder",
      status: "delivered",
      message: "ok",
      timestamp: new Date().toISOString(),
    };
  },
});

const ctx = (overrides: Partial<AlertContext> = {}): AlertContext => ({
  symbol: "BTCUSDT",
  price: 100,
  rsi: 75,
  sma: 90,
  macdHist: 0.5,
  volume: 1000,
  volumeSma: 500,
  percentChange24h: 4.2,
  barTime: 1_700_000_000_000,
  ...overrides,
});

const rule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  name: "Overbought",
  symbol: "BTCUSDT",
  conditions: [{ kind: "rsi_above", threshold: 70 }],
  enabled: true,
  ...overrides,
});

describe("multi-condition rules (TradingView: up to 5 conditions, ANDed)", () => {
  test("one condition triggers alone", () => {
    expect(ruleTriggers(rule(), ctx())).toBe(true);
    expect(ruleTriggers(rule({ conditions: [{ kind: "rsi_below", threshold: 70 }] }), ctx())).toBe(false);
  });

  test("all conditions must hold (AND semantics)", () => {
    const multi = rule({
      conditions: [
        { kind: "rsi_above", threshold: 70 },
        { kind: "price_above_sma", threshold: 0 },
        { kind: "macd_hist_above", threshold: 0 },
      ],
    });
    expect(ruleTriggers(multi, ctx())).toBe(true);
    expect(ruleTriggers(multi, ctx({ rsi: 50 }))).toBe(false);
    expect(ruleTriggers(multi, ctx({ macdHist: -1 }))).toBe(false);
  });

  test("five conditions are allowed", () => {
    const five = rule({
      conditions: [
        { kind: "rsi_above", threshold: 70 },
        { kind: "price_above", threshold: 50 },
        { kind: "price_above_sma", threshold: 0 },
        { kind: "volume_above_sma", threshold: 50 },
        { kind: "percent_change_above", threshold: 1 },
      ],
    });
    expect(MAX_CONDITIONS_PER_RULE).toBe(5);
    expect(ruleTriggers(five, ctx())).toBe(true);
  });

  test("percent-change and volume conditions compare correctly", () => {
    expect(ruleTriggers(rule({ conditions: [{ kind: "percent_change_above", threshold: 5 }] }), ctx())).toBe(false);
    expect(ruleTriggers(rule({ conditions: [{ kind: "percent_change_above", threshold: 4 }] }), ctx())).toBe(true);
    // volume_above_sma threshold is a % over SMA: 1000 > 500 * 1.5 → 50% works.
    expect(ruleTriggers(rule({ conditions: [{ kind: "volume_above_sma", threshold: 50 }] }), ctx())).toBe(true);
    expect(ruleTriggers(rule({ conditions: [{ kind: "volume_above_sma", threshold: 150 }] }), ctx())).toBe(false);
  });

  test("script_alert condition requires scriptFired", () => {
    expect(ruleTriggers(rule({ conditions: [{ kind: "script_alert", threshold: 0 }] }), ctx())).toBe(false);
    expect(ruleTriggers(rule({ conditions: [{ kind: "script_alert", threshold: 0 }] }), ctx({ scriptFired: true }))).toBe(true);
  });
});

describe("open-ended alerts with per-bar dedupe", () => {
  test("fires once per (rule, symbol, bar), not on every tick", async () => {
    const log: string[] = [];
    const sink = recordingSink(log);
    const r = rule();
    const first = await evaluateAlerts([r], [sink], ctx());
    expect(first.fired).toHaveLength(1);
    // Same bar again (tick) — deduped.
    const second = await evaluateAlerts(first.rules, [sink], ctx());
    expect(second.fired).toHaveLength(0);
    // Next bar — fires again (open-ended, no expiry).
    const third = await evaluateAlerts(second.rules, [sink], ctx({ barTime: 1_700_000_060_000 }));
    expect(third.fired).toHaveLength(1);
    expect(log).toHaveLength(2);
  });

  test("disabled rules never fire", async () => {
    const log: string[] = [];
    const { fired } = await evaluateAlerts([rule({ enabled: false })], [recordingSink(log)], ctx());
    expect(fired).toHaveLength(0);
  });

  test("rules scoped to another symbol are skipped", async () => {
    const log: string[] = [];
    const { fired } = await evaluateAlerts([rule({ symbol: "ETHUSDT" })], [recordingSink(log)], ctx());
    expect(fired).toHaveLength(0);
  });

  test("rearmRules clears dedupe so an edited rule can re-fire", async () => {
    const sink = recordingSink([]);
    const r = rule();
    await evaluateAlerts([r], [sink], ctx());
    const again = await evaluateAlerts([r], [sink], ctx());
    expect(again.fired).toHaveLength(0);
    rearmRules();
    const rearmed = await evaluateAlerts([r], [sink], ctx());
    expect(rearmed.fired).toHaveLength(1);
  });

  test("the returned rules are stamped with lastFiredAt", async () => {
    const { rules } = await evaluateAlerts(
      [rule({ id: "stamp-test", conditions: [{ kind: "rsi_above", threshold: 70 }] })],
      [recordingSink([])],
      ctx({ barTime: 1_700_999_000_000 }),
    );
    expect(rules[0]?.lastFiredAt).toBeTruthy();
  });
});

describe("watchlist alerts (symbol '*')", () => {
  test("a watchlist rule evaluates every quote", async () => {
    const log: string[] = [];
    const sink = recordingSink(log);
    const wl = rule({
      symbol: "*",
      conditions: [{ kind: "percent_change_above", threshold: 3 }],
    });
    const quotes = [
      { symbol: "BTCUSDT", price: 100, percentChange24h: 4.2 },
      { symbol: "ETHUSDT", price: 50, percentChange24h: -1 },
      { symbol: "SOLUSDT", price: 20, percentChange24h: 5.5 },
    ];
    const { fired } = await evaluateWatchlistAlerts([wl], [sink], quotes);
    expect(fired).toHaveLength(2);
    expect(log[0]).toContain("BTCUSDT");
    expect(log[1]).toContain("SOLUSDT");
  });

  test("a symbol-scoped percent rule only fires for its symbol", async () => {
    const log: string[] = [];
    const { fired } = await evaluateWatchlistAlerts(
      [rule({ symbol: "ETHUSDT", conditions: [{ kind: "percent_change_above", threshold: 3 }] })],
      [recordingSink(log)],
      [
        { symbol: "BTCUSDT", price: 100, percentChange24h: 4.2 },
        { symbol: "ETHUSDT", price: 50, percentChange24h: -1 },
      ],
    );
    expect(fired).toHaveLength(0);
  });
});

describe("message templates with placeholders", () => {
  test("substitutes all known placeholders", () => {
    const out = fillPlaceholders("{{ticker}} crossed {{close}} on {{interval}} at {{time}}", {
      ticker: "BTCUSDT", close: 43250.5, interval: "15m", time: "2026-11-02T10:00:00Z",
    });
    expect(out).toBe("BTCUSDT crossed 43250.5 on 15m at 2026-11-02T10:00:00Z");
  });

  test("optional placeholders fall back to the literal when unset", () => {
    const out = fillPlaceholders("RSI {{rsi}} vol {{volume}} chg {{change}}", {
      ticker: "X", close: 1, interval: "1m", time: "t",
    });
    expect(out).toBe("RSI {{rsi}} vol {{volume}} chg {{change}}");
  });

  test("unknown placeholders are left untouched", () => {
    expect(fillPlaceholders("{{nope}}", { ticker: "X", close: 1, interval: "1m", time: "t" })).toBe("{{nope}}");
  });

  test("a rule with a template fires the rendered message", async () => {
    const log: string[] = [];
    const rule: AlertRule = {
      id: "tpl-1", name: "tpl", symbol: "BTCUSDT",
      conditions: [{ kind: "price_above", threshold: 100 }],
      messageTemplate: "{{ticker}} > {{close}} ({{interval}})",
      enabled: true,
    };
    const { fired } = await evaluateAlerts([rule], [recordingSink(log)], {
      symbol: "BTCUSDT", price: 101, interval: "5m", barTime: 1,
    });
    expect(fired.length).toBe(1);
    expect(fired[0]!.event.message).toBe("BTCUSDT > 101 (5m)");
  });

  test("a rule without a template keeps the auto description", async () => {
    const log: string[] = [];
    const rule: AlertRule = {
      id: "tpl-2", name: "auto", symbol: "BTCUSDT",
      conditions: [{ kind: "price_above", threshold: 100 }],
      enabled: true,
    };
    const { fired } = await evaluateAlerts([rule], [recordingSink(log)], {
      symbol: "BTCUSDT", price: 101, barTime: 2,
    });
    expect(fired[0]!.event.message).toContain("Price is above 100");
  });
});
