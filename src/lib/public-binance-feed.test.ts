import { describe, expect, test } from "bun:test";
import { quoteAssetOf, SUPPORTED_SYMBOLS } from "./public-binance-feed";

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
