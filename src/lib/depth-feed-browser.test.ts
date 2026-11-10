import { afterEach, describe, expect, test } from "bun:test";
import { fetchSnapshot, openDepthSocket } from "./depth-feed-browser";
import type { DepthSnapshot, DepthUpdate } from "./order-book";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() { this.readyState = 3; }
}

describe("depth-feed-browser: openDepthSocket consumer errors", () => {
  const origWs = globalThis.WebSocket;
  afterEach(() => { globalThis.WebSocket = origWs; });

  test("throwing consumer surfaces exception and is not counted as malformed", () => {
    globalThis.WebSocket = MockWebSocket as never;
    let malformedCalls = 0;
    const cleanup = openDepthSocket("wss://example.com", {
      onOpen: () => {},
      onClose: () => {},
      onMessage: () => { throw new Error("consumer error"); },
      onMalformed: () => { malformedCalls += 1; },
    });
    const ws = MockWebSocket.instances.at(-1)!;
    const validUpdate: DepthUpdate = { U: 1, u: 2, b: [["100", "1"]], a: [["101", "1"]] };
    const validFrame = JSON.stringify({ data: validUpdate });

    expect(() => ws.onmessage?.({ data: validFrame })).toThrow("consumer error");
    expect(malformedCalls).toBe(0);

    // Malformed JSON calls onMalformed
    ws.onmessage?.({ data: "bad json" });
    expect(malformedCalls).toBe(1);

    cleanup();
  });
});

describe("depth-feed-browser: fetchSnapshot validation", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  test("returns valid depth snapshot", async () => {
    const valid: DepthSnapshot = { lastUpdateId: 100, bids: [["100", "1"]], asks: [["101", "1"]] };
    globalThis.fetch = (async () => new Response(JSON.stringify(valid))) as never;
    const result = await fetchSnapshot("BTCUSDT", 100);
    expect(result).toEqual(valid);
  });

  test("truncates upstream error text to 200 characters", async () => {
    const longError = "x".repeat(300);
    globalThis.fetch = (async () => new Response(longError, { status: 500 })) as never;
    try {
      await fetchSnapshot("BTCUSDT", 100);
      expect(true).toBe(false);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("HTTP 500: ");
      expect(message).toContain("...");
      expect(message.length).toBeLessThan(250);
    }
  });

  test("throws descriptive error when snapshot body is invalid", async () => {
    const invalidBody = { notASnapshot: true, garbage: "y".repeat(300) };
    globalThis.fetch = (async () => new Response(JSON.stringify(invalidBody))) as never;
    try {
      await fetchSnapshot("BTCUSDT", 100);
      expect(true).toBe(false);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("Invalid depth snapshot for BTCUSDT:");
      expect(message).toContain("...");
      expect(message.length).toBeLessThan(260);
    }
  });
});
