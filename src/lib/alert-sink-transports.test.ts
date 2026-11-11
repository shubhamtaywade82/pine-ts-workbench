import { describe, expect, it } from "bun:test";
import {
  BrokerActionSink,
  BrowserNotificationSink,
  WebhookSink,
  type AlertEvent,
  type BrokerSinkDeps,
} from "./alert-sink-transports";
import { ARM_PHRASE, DEFAULT_ORDER_GUARD_LIMITS, EMPTY_GUARD_STATE, arm, type GuardState } from "./order-guard";

const mockEvent: AlertEvent = {
  id: "test-alert-1",
  timestamp: new Date().toISOString(),
  symbol: "BTCUSDT",
  condition: "RSI crossed above 70",
  value: 72.5,
  threshold: 70,
  message: "BTCUSDT RSI high",
};

describe("WebhookSink", () => {
  it("skips delivery when URL is empty", async () => {
    const sink = new WebhookSink({ url: "" });
    const result = await sink.deliver(mockEvent);
    expect(result.status).toBe("skipped");
  });
});

describe("BrowserNotificationSink", () => {
  it("skips delivery when disabled", async () => {
    const sink = new BrowserNotificationSink(false);
    const result = await sink.deliver(mockEvent);
    expect(result.status).toBe("skipped");
  });
});

describe("BrokerActionSink order guard", () => {
  const NOW = 1_000_000;
  const liveKeys = { apiKey: "test-key", apiSecret: "test-secret", liveTradeEnabled: true };
  const armedState = arm(EMPTY_GUARD_STATE, { now: NOW, phrase: ARM_PHRASE, limits: DEFAULT_ORDER_GUARD_LIMITS });

  const harness = (options: { state?: GuardState; price?: number | Error; quantity?: number } = {}) => {
    let state = options.state ?? armedState;
    const submitted: { symbol: string; side: string; quantity: number }[] = [];
    const deps: BrokerSinkDeps = {
      now: () => NOW,
      fetchPrice: async () => {
        if (options.price instanceof Error) throw options.price;
        return options.price ?? 50_000;
      },
      readGuard: () => state,
      writeGuard: (next) => { state = next; },
      submit: async (order) => {
        submitted.push({ symbol: order.symbol, side: order.side, quantity: order.quantity });
        return { orderId: "42", status: "FILLED" };
      },
    };
    const sink = new BrokerActionSink(
      { binanceSettings: liveKeys, side: "BUY", quantity: options.quantity ?? 0.001, orderType: "MARKET", limits: DEFAULT_ORDER_GUARD_LIMITS },
      deps,
    );
    return { sink, submitted, guard: () => state };
  };

  it("should block and not submit while alert orders are not armed", async () => {
    const { sink, submitted } = harness({ state: EMPTY_GUARD_STATE });
    const result = await sink.deliver(mockEvent);
    expect(submitted).toEqual([]);
    expect(result).toMatchObject({ status: "skipped", message: "Blocked - Alert orders are not armed" });
  });

  it("should block (fail closed) when the price for the notional check is unavailable", async () => {
    const { sink, submitted } = harness({ price: new Error("timeout") });
    const result = await sink.deliver(mockEvent);
    expect(submitted).toEqual([]);
    expect(result).toMatchObject({ status: "skipped", message: "Blocked - price unavailable: timeout" });
  });

  it("should block an order whose quantity times price exceeds the per-order cap", async () => {
    const { sink, submitted } = harness({ quantity: 0.01 });
    const result = await sink.deliver(mockEvent);
    expect(submitted).toEqual([]);
    expect(result).toMatchObject({ status: "skipped", message: "Blocked - Order notional 500 exceeds the 100 limit" });
  });

  it("should submit an allowed order once and record it against the limits", async () => {
    const { sink, submitted, guard } = harness();
    const result = await sink.deliver(mockEvent);
    expect(submitted).toEqual([{ symbol: "BTCUSDT", side: "BUY", quantity: 0.001 }]);
    expect(result).toMatchObject({ status: "delivered", message: "Order 42: FILLED" });
    expect(guard().history).toEqual([{ at: NOW, notional: 50 }]);
  });

  it("should keep skipping without keys or live trading, before any guard check", async () => {
    const { submitted } = harness();
    const sink = new BrokerActionSink(
      { binanceSettings: { ...liveKeys, liveTradeEnabled: false }, side: "BUY", quantity: 0.001, orderType: "MARKET", limits: DEFAULT_ORDER_GUARD_LIMITS },
    );
    expect(await sink.deliver(mockEvent)).toMatchObject({ status: "skipped", message: "Live trading disabled or unconfigured" });
    expect(submitted).toEqual([]);
  });
});
