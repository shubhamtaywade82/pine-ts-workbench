import { describe, expect, test } from "bun:test";
import type { WallTransitionRow } from "../../src/lib/market-recorder";
import { LocalOrderBook } from "../../src/lib/order-book";
import {
  BINANCE_DATA_WS_URL,
  BINANCE_REST_URL,
} from "../../src/lib/binance-endpoints";
import {
  resolveDataWsUrl,
  resolveRestUrl,
} from "./endpoints";
import { watchWalls } from "./index";
import {
  createMalformedLogger,
  parseDepthMessage,
  parseTradeMessage,
} from "./parse";

const validDepthPayload = () => ({
  U: 10,
  u: 12,
  b: [["99.5", "1.5"]],
  a: [["100.5", "2"]],
});

const validTradePayload = () => ({
  e: "trade",
  t: 7,
  p: "101.25",
  q: "0.5",
  T: 1_700_000_000_000,
  m: true,
});

describe("parseDepthMessage", () => {
  test("accepts valid combined-stream frame", () => {
    const raw = JSON.stringify({ stream: "btcusdt@depth@100ms", data: validDepthPayload() });
    const update = parseDepthMessage(raw);
    expect(update).toBeDefined();
    expect(update?.U).toBe(10);
    expect(update?.u).toBe(12);
  });

  test("accepts valid direct-stream frame", () => {
    const raw = JSON.stringify(validDepthPayload());
    const update = parseDepthMessage(raw);
    expect(update).toBeDefined();
    expect(update?.u).toBe(12);
  });

  test("drops unparseable JSON without throwing", () => {
    expect(parseDepthMessage("{corrupt json")).toBeUndefined();
    expect(parseDepthMessage(undefined)).toBeUndefined();
    expect(parseDepthMessage(null)).toBeUndefined();
  });

  test("drops invalid depth payload shapes", () => {
    const invalid = JSON.stringify({ data: { U: 15, u: 10, b: [], a: [] } });
    expect(parseDepthMessage(invalid)).toBeUndefined();
  });

  test("accepts binary Uint8Array and ArrayBuffer frames", () => {
    const raw = JSON.stringify({ stream: "btcusdt@depth@100ms", data: validDepthPayload() });
    const encoded = new TextEncoder().encode(raw);
    expect(parseDepthMessage(encoded)?.u).toBe(12);
    expect(parseDepthMessage(encoded.buffer)?.u).toBe(12);
  });
});

describe("parseTradeMessage", () => {
  test("accepts valid combined-stream trade", () => {
    const raw = JSON.stringify({ stream: "btcusdt@trade", data: validTradePayload() });
    const trade = parseTradeMessage(raw);
    expect(trade).toBeDefined();
    expect(trade?.t).toBe(7);
    expect(trade?.p).toBe("101.25");
  });

  test("accepts valid direct-stream trade", () => {
    const raw = JSON.stringify(validTradePayload());
    const trade = parseTradeMessage(raw);
    expect(trade).toBeDefined();
    expect(trade?.e).toBe("trade");
  });

  test("drops unparseable trade JSON without throwing", () => {
    expect(parseTradeMessage("not a trade")).toBeUndefined();
  });

  test("drops non-trade frames and invalid fields", () => {
    const kline = JSON.stringify({ data: { e: "kline", s: "BTCUSDT" } });
    expect(parseTradeMessage(kline)).toBeUndefined();

    const badTrade = JSON.stringify({ data: { ...validTradePayload(), p: "-1" } });
    expect(parseTradeMessage(badTrade)).toBeUndefined();
  });

  test("accepts binary Uint8Array and ArrayBuffer trade frames", () => {
    const raw = JSON.stringify(validTradePayload());
    const encoded = new TextEncoder().encode(raw);
    expect(parseTradeMessage(encoded)?.t).toBe(7);
    expect(parseTradeMessage(encoded.buffer)?.t).toBe(7);
  });
});

describe("createMalformedLogger", () => {
  test("warns immediately on first message and throttles within 60s", () => {
    const warnings: string[] = [];
    let currentTime = 10_000;
    const logger = createMalformedLogger(
      (msg) => warnings.push(msg),
      () => currentTime,
    );

    logger.record();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toBe("collector malformed messages; total 1");

    // Within 60 seconds: increments count but avoids spamming console
    currentTime += 30_000;
    logger.record();
    logger.record();
    expect(logger.count()).toBe(3);
    expect(warnings.length).toBe(1);

    // After 60 seconds: emits next throttled warning
    currentTime += 31_000;
    logger.record();
    expect(warnings.length).toBe(2);
    expect(warnings[1]).toBe("collector malformed messages; total 4");

    logger.logSummary();
    expect(warnings.length).toBe(3);
    expect(warnings[2]).toBe("collector malformed messages; total 4");
  });
});

describe("collector endpoint resolution", () => {
  test("falls back to shared constants when env is unset", () => {
    expect(resolveRestUrl({})).toBe(BINANCE_REST_URL);
    expect(resolveDataWsUrl({})).toBe(BINANCE_DATA_WS_URL);
  });

  test("honours server-side non-NEXT_PUBLIC overrides", () => {
    const env = {
      BINANCE_REST_URL: "https://my-rest.example.com",
      BINANCE_DATA_WS_URL: "wss://my-data-ws.example.com",
    };
    expect(resolveRestUrl(env)).toBe("https://my-rest.example.com");
    expect(resolveDataWsUrl(env)).toBe("wss://my-data-ws.example.com");
  });
});

describe("watchWalls lifecycle", () => {
  test("a removal after an in-width price drift closes the original life", () => {
    const transitions: WallTransitionRow[] = [];
    const recorder = {
      recordTransition: (row: WallTransitionRow) => transitions.push(row),
    } as unknown as Parameters<typeof watchWalls>[1];

    const walls = watchWalls("BTCUSDT", recorder, 0.1);
    const book = new LocalOrderBook();
    book.applySnapshot({
      lastUpdateId: 1,
      bids: [["100.00", "500"]],
      asks: [["101.00", "500"]],
    }, 10);
    walls.note({ status: "live", book, updateId: 1 });

    const bidTransitions = () => transitions.filter((t) => t.side === "bid");
    expect(bidTransitions()).toHaveLength(1);
    expect(bidTransitions()[0]?.kind).toBe("detected");
    const originalWallId = bidTransitions()[0]!.wallId;
    expect(originalWallId).toContain("BTCUSDT:bid:100:");
    expect(bidTransitions()[0]?.price).toBe(100);

    book.applySnapshot({
      lastUpdateId: 2,
      bids: [["100.05", "500"]],
      asks: [["101.00", "500"]],
    }, 10);
    walls.note({ status: "live", book, updateId: 2 });

    book.applySnapshot({
      lastUpdateId: 3,
      bids: [["99.00", "1"]],
      asks: [["101.00", "500"]],
    }, 10);
    walls.note({ status: "live", book, updateId: 3 });

    expect(bidTransitions()).toHaveLength(2);
    expect(bidTransitions()[1]?.kind).toBe("removed");
    expect(bidTransitions()[1]?.wallId).toBe(originalWallId);
    expect(bidTransitions()[1]?.price).toBe(100);
  });
});
