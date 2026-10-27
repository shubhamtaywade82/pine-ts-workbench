import { describe, expect, test } from "bun:test";
import { quoteAssetOf, SUPPORTED_SYMBOLS, timeframeToChartInterval, fetchHtfBars } from "./public-binance-feed";

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
