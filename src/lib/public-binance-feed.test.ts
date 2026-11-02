import { describe, expect, test } from "bun:test";
import {
  quoteAssetOf,
  SUPPORTED_SYMBOLS,
  timeframeToChartInterval,
  fetchHtfBars,
  SUPPORTED_INTERVALS,
  INTERVAL_MS,
  INTERVAL_LABELS,
  fetchDeepHistoryBars,
  type ChartInterval,
} from "./public-binance-feed";

describe("quote asset", () => {
  test("every supported market names a quote asset that is the symbol's suffix", () => {
    for (const { binanceSymbol } of SUPPORTED_SYMBOLS) {
      expect(binanceSymbol.endsWith(quoteAssetOf(binanceSymbol))).toBe(true);
    }
  });

  test("the quote asset comes from the table, not from a fixed assumption", () => {
    expect(quoteAssetOf("BTCUSDT")).toBe("USDT");
    expect(quoteAssetOf("SOLUSDT")).toBe("USDT");
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
