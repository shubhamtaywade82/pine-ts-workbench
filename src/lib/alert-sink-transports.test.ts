import { describe, expect, it } from "bun:test";
import {
  BrowserNotificationSink,
  WebhookSink,
  type AlertEvent,
} from "./alert-sink-transports";

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
