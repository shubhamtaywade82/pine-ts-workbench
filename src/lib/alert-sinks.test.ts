import { describe, expect, it } from "bun:test";
import {
  dispatchScriptAlerts,
  formatScriptAlertMessage,
  type AlertSink,
  type AlertDeliveryResult,
  type AlertEvent,
} from "./alert-sinks";

describe("formatScriptAlertMessage", () => {
  it("formats structured JSON SMC alert payloads into human-readable messages", () => {
    const raw = JSON.stringify({
      event: "SMC_ENTRY",
      side: "LONG",
      setup: "Displacement CHoCH",
      entry: 64250,
      sl: 63900,
      tp1: 65100,
      score: 85,
    });
    const { message, action } = formatScriptAlertMessage(raw);
    expect(message).toContain("[SMC_ENTRY]");
    expect(message).toContain("LONG");
    expect(message).toContain("Setup: Displacement CHoCH");
    expect(message).toContain("Entry: 64250");
    expect(message).toContain("Score: 85");
    expect(action).toBe("LONG MARKET");
  });

  it("handles plain text messages without throwing", () => {
    const { message, action } = formatScriptAlertMessage("Simple threshold crossed");
    expect(message).toBe("Simple threshold crossed");
    expect(action).toBeUndefined();
  });
});

describe("dispatchScriptAlerts", () => {
  it("delivers script alerts to active sinks", async () => {
    const delivered: AlertEvent[] = [];
    const testSink: AlertSink = {
      id: "mock",
      name: "MockSink",
      async deliver(event: AlertEvent): Promise<AlertDeliveryResult> {
        delivered.push(event);
        return {
          sinkId: "mock",
          sinkName: "MockSink",
          status: "delivered",
          message: "OK",
          timestamp: new Date().toISOString(),
        };
      },
    };

    const alerts = [{ message: "Test alert triggered" }];
    const fired = await dispatchScriptAlerts(alerts, [testSink], "BTCUSDT");

    expect(fired.length).toBe(1);
    expect(delivered.length).toBe(1);
    expect(delivered[0]!.symbol).toBe("BTCUSDT");
    expect(delivered[0]!.message).toBe("Test alert triggered");
  });
});
