import { afterEach, describe, expect, test } from "bun:test";
import {
  quoteAssetOf,
  SUPPORTED_SYMBOLS,
  timeframeToChartInterval,
  fetchHtfBars,
  SUPPORTED_INTERVALS,
  INTERVAL_MS,
  INTERVAL_LABELS,
  fetchDeepHistoryBars,
  toLiveTrade,
  openMarketStream,
  parseMarketStreamMessage,
  type ChartInterval,
} from "./public-binance-feed";

describe("quote asset", () => {
  test("every supported market names a quote asset that is the symbol's suffix", () => {
    for (const { binanceSymbol } of SUPPORTED_SYMBOLS) {
      expect(binanceSymbol.endsWith(quoteAssetOf(binanceSymbol))).toBe(true);
    }
  });

  test("the quote asset is read from any market's symbol, not assumed to be USDT", () => {
    expect(quoteAssetOf("BTCUSDT")).toBe("USDT");
    expect(quoteAssetOf("DOGEUSDC")).toBe("USDC");
    expect(quoteAssetOf("ETHBTC")).toBe("BTC");
    expect(quoteAssetOf("BTCEUR")).toBe("EUR");
  });

  test("a longer quote wins over a shorter one it ends with", () => {
    expect(quoteAssetOf("BTCFDUSD")).toBe("FDUSD");
  });

  test("a symbol that is only a quote name, or ends in none, falls back to USDT", () => {
    expect(quoteAssetOf("USDT")).toBe("USDT");
    expect(quoteAssetOf("XYZABC")).toBe("USDT");
  });
});

describe("timeframeToChartInterval", () => {
  test("maps Pine timeframe strings to Binance intervals", () => {
    expect(timeframeToChartInterval("1")).toBe("1m");
    expect(timeframeToChartInterval("5")).toBe("5m");
    expect(timeframeToChartInterval("15")).toBe("15m");
    expect(timeframeToChartInterval("60")).toBe("1h");
    expect(timeframeToChartInterval("240")).toBe("4h");
    expect(timeframeToChartInterval("D")).toBe("1d");
    expect(timeframeToChartInterval("W")).toBe("1w");
    expect(timeframeToChartInterval("unknown")).toBeUndefined();
  });

  test("fetchHtfBars returns undefined for unknown timeframes without crashing", async () => {
    expect(await fetchHtfBars("unknown")).toBeUndefined();
  });
});

describe("second-based intervals", () => {
  test("1s is a supported interval with a label and 1-second bar duration", () => {
    expect(SUPPORTED_INTERVALS).toContain("1s");
    expect(INTERVAL_LABELS["1s"]).toBe("1s");
    expect(INTERVAL_MS["1s"]).toBe(1_000);
  });

  test("maps the Pine '1s' timeframe to the 1s interval", () => {
    expect(timeframeToChartInterval("1s")).toBe("1s");
    expect(timeframeToChartInterval("1S")).toBe("1s");
  });

  test("every supported interval has a label and a positive bar duration", () => {
    for (const interval of SUPPORTED_INTERVALS) {
      expect(INTERVAL_LABELS[interval]).toBeTruthy();
      expect(INTERVAL_MS[interval]).toBeGreaterThan(0);
    }
  });
});

describe("toLiveTrade", () => {
  const raw = { e: "trade" as const, p: "100.5", q: "0.2", T: 1_700_000_000_000, t: 42, m: false };

  test("m=false is a buy aggressor and t is the trade id", () => {
    expect(toLiveTrade(raw)).toEqual({
      id: 42,
      price: 100.5,
      quantity: 0.2,
      time: 1_700_000_000_000,
      aggressor: "buy",
    });
  });

  test("m=true is a sell aggressor", () => {
    expect(toLiveTrade({ ...raw, m: true }).aggressor).toBe("sell");
  });
});

describe("fetchDeepHistoryBars", () => {
  test("pages backwards until the requested total is reached", async () => {
    // 1000 bars per page cap → 3 pages for 2500 bars.
    const pages: number[][] = [];
    const calls: number[] = [];
    const bars = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ time: start + i * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 1, isClosed: true }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const limit = Number(u.searchParams.get("limit"));
      const endTime = u.searchParams.get("endTime");
      calls.push(limit);
      // Serve from `endTime` backwards: the page ENDS at endTime.
      const end = endTime === null ? 2_500 * 60_000 : Number(endTime);
      const start = end - limit * 60_000;
      const page = bars(start, limit);
      pages.push(page.map((b) => b.time));
      return new Response(JSON.stringify(page.map((b) => [b.time, "1", "1", "1", "1", "1", b.time + 60_000, true])));
    }) as typeof fetch;
    try {
      const out = await fetchDeepHistoryBars("BTCUSDT" as never, "1m" as ChartInterval, 2_500);
      expect(out).toHaveLength(2_500);
      // Oldest-first, strictly increasing times.
      for (let i = 1; i < out.length; i++) expect(out[i]!.time).toBeGreaterThan(out[i - 1]!.time);
      // 3 paged requests of 1000.
      expect(calls).toEqual([1_000, 1_000, 500]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops when Binance runs out of history", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      // A short page means no more history before it.
      new Response(
        JSON.stringify(
          Array.from({ length: 300 }, (_, i) => [i * 60_000, "1", "1", "1", "1", "1", i * 60_000 + 60_000, true]),
        ),
      )) as unknown as typeof fetch;
    try {
      const out = await fetchDeepHistoryBars("BTCUSDT" as never, "1m" as ChartInterval, 5_000);
      expect(out).toHaveLength(300);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("parseMarketStreamMessage", () => {
  test("parses kline event", () => {
    const raw = JSON.stringify({
      data: {
        e: "kline",
        E: 1_000,
        s: "BTCUSDT",
        k: { t: 0, T: 60_000, o: "100", h: "105", l: "99", c: "102", v: "10", x: false },
      },
    });
    const parsed = parseMarketStreamMessage(raw);
    expect(parsed?.kind).toBe("kline");
    if (parsed?.kind === "kline") {
      expect(parsed.bar).toMatchObject({ open: 100, high: 105, low: 99, close: 102, volume: 10, isClosed: false });
    }
  });

  test("parses trade event", () => {
    const raw = JSON.stringify({
      data: { e: "trade", t: 123, p: "100.5", q: "2", T: 500, m: true },
    });
    const parsed = parseMarketStreamMessage(raw);
    expect(parsed?.kind).toBe("trade");
    if (parsed?.kind === "trade") {
      expect(parsed.trade).toMatchObject({ id: 123, price: 100.5, quantity: 2, aggressor: "sell" });
    }
  });

  test("returns null for malformed or unrecognized frames", () => {
    expect(parseMarketStreamMessage("not json")).toBeNull();
    expect(parseMarketStreamMessage(JSON.stringify({ data: { e: "unknown" } }))).toBeNull();
  });
});

describe("openMarketStream error handling", () => {
  class MockSocket {
    static instances: MockSocket[] = [];
    url: string;
    readyState = 1;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      MockSocket.instances.push(this);
    }
    close() { this.readyState = 3; }
  }

  const origWs = globalThis.WebSocket;
  afterEach(() => { globalThis.WebSocket = origWs; });

  test("throwing consumer surfaces exception and is not counted as malformed", () => {
    globalThis.WebSocket = MockSocket as never;
    let malformedCount = 0;
    const close = openMarketStream("BTCUSDT", "1m", {
      onOpen: () => {},
      onClose: () => {},
      onKline: () => { throw new Error("consumer exploded"); },
      onTrade: () => {},
      onMalformed: (count) => { malformedCount = count; },
    });
    const ws = MockSocket.instances.at(-1)!;
    const klineEvent = JSON.stringify({
      data: {
        e: "kline",
        E: 1_000,
        s: "BTCUSDT",
        k: { t: 0, T: 60_000, o: "1", h: "2", l: "1", c: "2", v: "10", x: false },
      },
    });

    expect(() => ws.onmessage?.({ data: klineEvent })).toThrow("consumer exploded");
    expect(malformedCount).toBe(0);

    // Truly malformed data is reported to onMalformed
    ws.onmessage?.({ data: "not json" });
    expect(malformedCount).toBe(1);
    close();
  });
});
