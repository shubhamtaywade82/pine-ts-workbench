import { describe, expect, it } from "bun:test";
import {
  findSymbol,
  searchSymbols,
  SYMBOL_CATALOG,
} from "./symbol-catalog";

describe("symbol-catalog", () => {
  it("contains both Binance crypto and DhanHQ Indian equity symbols", () => {
    const binanceSymbols = SYMBOL_CATALOG.filter((s) => s.provider === "binance");
    const dhanSymbols = SYMBOL_CATALOG.filter((s) => s.provider === "dhan");

    expect(binanceSymbols.length).toBeGreaterThanOrEqual(4);
    expect(dhanSymbols.length).toBeGreaterThanOrEqual(6);
  });

  it("finds symbols by ticker and binanceSymbol", () => {
    const btc = findSymbol("BTCUSDT");
    expect(btc?.displayName).toBe("BTC / USDT");

    const nifty = findSymbol("NSE:NIFTY50");
    expect(nifty?.displayName).toBe("NIFTY 50");
    expect(nifty?.exchange).toBe("NSE");

    const reliance = findSymbol("NSE:RELIANCE");
    expect(reliance?.displayName).toBe("Reliance Industries");
  });

  it("filters search results by category", () => {
    const cryptos = searchSymbols("", "crypto");
    expect(cryptos.every((s) => s.category === "crypto")).toBe(true);

    const indices = searchSymbols("", "index");
    expect(indices.every((s) => s.category === "index")).toBe(true);
    expect(indices.some((s) => s.ticker === "NSE:NIFTY50")).toBe(true);

    const stocks = searchSymbols("", "stock");
    expect(stocks.every((s) => s.category === "stock")).toBe(true);
  });

  it("filters by text query", () => {
    const results = searchSymbols("reliance");
    expect(results.length).toBe(1);
    expect(results[0]?.ticker).toBe("NSE:RELIANCE");
  });
});
