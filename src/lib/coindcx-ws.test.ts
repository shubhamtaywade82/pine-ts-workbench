import { describe, expect, it } from "bun:test";
import {
  formatJoinPacket,
  parseEngineIoPacket,
  signCoindcxWsAuth,
  connectCoindcxWs,
  connectLivePriceStream,
  parseSseChunk,
  connectCoindcxServerStream,
} from "./coindcx-ws";

describe("coindcx-ws", () => {
  it("signCoindcxWsAuth produces valid 64-char HMAC-SHA256 signature", async () => {
    const secret = "test-ws-secret";
    const sig = await signCoindcxWsAuth(secret);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBe(64);
  });

  it("formatJoinPacket wraps join payload in Socket.IO v2 emit format", () => {
    const packet = formatJoinPacket("my-key", "my-sig");
    expect(packet.startsWith('42["join",')).toBe(true);
    expect(packet.includes('"channelName":"coindcx"')).toBe(true);
    expect(packet.includes('"authSignature":"my-sig"')).toBe(true);
    expect(packet.includes('"apiKey":"my-key"')).toBe(true);
  });

  it("parseEngineIoPacket parses open, ping, pong, and connect frames", () => {
    expect(parseEngineIoPacket('0{"sid":"abc"}').type).toBe("open");
    expect(parseEngineIoPacket("2").type).toBe("ping");
    expect(parseEngineIoPacket("3").type).toBe("pong");
    expect(parseEngineIoPacket("40").type).toBe("connect");
    expect(parseEngineIoPacket("invalid").type).toBe("unknown");
  });

  it("parseEngineIoPacket parses event packets correctly", () => {
    const raw = '42["df-position-update",{"data":[{"id":"1"}]}]';
    const parsed = parseEngineIoPacket(raw);
    expect(parsed.type).toBe("event");
    expect(parsed.eventName).toBe("df-position-update");
    expect(parsed.payload).toEqual({ data: [{ id: "1" }] });
  });

  it("connectCoindcxWs executes handshake, auth join, and dispatches events", async () => {
    const sentMessages: string[] = [];
    const handlers: { onmessage?: (event: { data: string }) => void } = {};
    let wsClosed = false;

    const mockWsFactory = () => {
      const mock = {
        send: (msg: string) => sentMessages.push(msg),
        close: () => { wsClosed = true; },
        set onmessage(fn: (event: { data: string }) => void) { handlers.onmessage = fn; },
        set onerror(fn: () => void) {},
        set onclose(fn: () => void) {},
      };
      return mock as unknown as WebSocket;
    };

    let receivedPositions: unknown = null;
    let status: string = "";

    const cleanup = connectCoindcxWs(
      "key-1",
      "sec-1",
      {
        onPositionUpdate: (data) => { receivedPositions = data; },
        onStatusChange: (st) => { status = st; },
      },
      mockWsFactory,
    );

    // Allow async signature generation
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(status).toBe("connecting");

    // 1. Server sends handshake open packet '0'
    handlers.onmessage?.({ data: '0{"sid":"session-123"}' });
    expect(sentMessages).toContain("40");

    // 2. Server sends connect packet '40'
    handlers.onmessage?.({ data: "40" });
    expect(status).toBe("live");
    expect(sentMessages.some((m) => m.startsWith('42["join",'))).toBe(true);

    // 3. Server sends ping '2'
    handlers.onmessage?.({ data: "2" });
    expect(sentMessages).toContain("3");

    // 4. Server sends df-position-update
    handlers.onmessage?.({ data: '42["df-position-update",{"data":[{"pair":"I-BTC_INR"}]}]' });
    expect(receivedPositions).toEqual({ data: [{ pair: "I-BTC_INR" }] });

    cleanup();
    expect(wsClosed).toBe(true);
  });

  it("connectCoindcxWs transitions to polling when handshake is rejected by browser origin policy", async () => {
    const handlers: { onerror?: () => void; onclose?: () => void } = {};
    let status = "";

    const mockWsFactory = () => ({
      close: () => {},
      set onmessage(_fn: unknown) {},
      set onerror(fn: () => void) { handlers.onerror = fn; },
      set onclose(fn: () => void) { handlers.onclose = fn; },
    } as unknown as WebSocket);

    const cleanup = connectCoindcxWs(
      "key-1", "sec-1",
      { onStatusChange: (st) => { status = st; } },
      mockWsFactory,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    handlers.onerror?.();
    handlers.onclose?.();

    expect(status).toBe("polling");
    cleanup();
  });

  it("connectLivePriceStream establishes WebSocket ticker stream and routes price ticks", () => {
    let messageHandler: ((event: { data: string }) => void) | undefined;
    let wsClosed = false;

    const mockWsFactory = () => {
      const mock = {
        close: () => { wsClosed = true; },
        set onmessage(fn: (event: { data: string }) => void) { messageHandler = fn; },
      };
      return mock as unknown as WebSocket;
    };

    let tickedPair = "";
    let tickedPrice = 0;

    const cleanup = connectLivePriceStream(
      ["B-BTC_USDT"],
      (pair, price) => {
        tickedPair = pair;
        tickedPrice = price;
      },
      mockWsFactory,
    );

    messageHandler?.({
      data: JSON.stringify({
        stream: "btcusdt@ticker",
        data: { c: "95123.50" },
      }),
    });

    expect(tickedPair).toBe("B-BTC_USDT");
    expect(tickedPrice).toBe(95123.5);

    cleanup();
    expect(wsClosed).toBe(true);
  });

  it("parseSseChunk parses status, position, order, and balance SSE frames", () => {
    let status = "";
    let positions: unknown = null;
    let orders: unknown = null;
    let balances: unknown = null;

    const callbacks = {
      onStatusChange: (s: string) => { status = s; },
      onPositionUpdate: (p: unknown) => { positions = p; },
      onOrderUpdate: (o: unknown) => { orders = o; },
      onBalanceUpdate: (b: unknown) => { balances = b; },
    };

    parseSseChunk('event: status\ndata: "live"', callbacks);
    expect(status).toBe("live");

    parseSseChunk('event: positions\ndata: [{"pair":"B-SOL_USDT"}]', callbacks);
    expect(positions).toEqual([{ pair: "B-SOL_USDT" }]);

    parseSseChunk('event: orders\ndata: [{"id":"ord-1"}]', callbacks);
    expect(orders).toEqual([{ id: "ord-1" }]);

    parseSseChunk('event: balances\ndata: [{"currency":"INR"}]', callbacks);
    expect(balances).toEqual([{ currency: "INR" }]);

    // Malformed data should not throw
    parseSseChunk("event: status\ndata: invalid-json", callbacks);
    expect(status).toBe("live");
  });

  it("connectCoindcxServerStream bridges SSE updates from API route", async () => {
    let capturedHeaders: HeadersInit | undefined;
    let streamCancelled = false;
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: status\ndata: "live"\n\n'));
        controller.enqueue(new TextEncoder().encode('event: positions\ndata: [{"pair":"B-BTC_USDT"}]\n\n'));
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const mockFetch = async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(mockStream, { status: 200 });
    };

    let status = "";
    let receivedPositions: unknown = null;

    const cleanup = connectCoindcxServerStream(
      "api-key-123",
      "api-sec-456",
      {
        onStatusChange: (s) => { status = s; },
        onPositionUpdate: (p) => { receivedPositions = p; },
      },
      mockFetch as unknown as typeof fetch,
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(status).toBe("live");
    expect(receivedPositions).toEqual([{ pair: "B-BTC_USDT" }]);
    expect((capturedHeaders as Record<string, string>)?.["x-coindcx-apikey"]).toBe("api-key-123");
    cleanup();
    expect(status).toBe("disconnected");
  });
});
