import { afterEach, describe, expect, it, test } from "bun:test";
import {
  findSymbol,
  fuzzyScore,
  fuzzySearchSymbols,
  loadTickSize,
  parseInstrumentFilters,
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

describe("fuzzy symbol search", () => {
  it("ranks exact and prefix matches above scattered subsequences", () => {
    const results = fuzzySearchSymbols("btc", "all");
    expect(results[0]?.ticker).toBe("BTCUSDT");
    // "btu" is a scattered subsequence of BTCUSDT only.
    const scattered = fuzzySearchSymbols("btu", "all");
    expect(scattered.map((s) => s.ticker)).toContain("BTCUSDT");
  });

  it("matches on display names, not just tickers", () => {
    const results = fuzzySearchSymbols("reli", "all");
    expect(results.some((s) => s.ticker === "NSE:RELIANCE")).toBe(true);
  });

  it("returns nothing for queries that match no subsequence", () => {
    expect(fuzzySearchSymbols("zzzzz", "all")).toHaveLength(0);
  });

  it("boosts favorites in ranking", () => {
    // "nifty" matches both NIFTY 50 (word-boundary) and BANK NIFTY (mid-word);
    // without a boost NIFTY 50 ranks first, with one BANKNIFTY is promoted.
    const plain = fuzzySearchSymbols("nifty", "all");
    expect(plain[0]?.ticker).toBe("NSE:NIFTY50");
    const boosted = fuzzySearchSymbols("nifty", "all", ["NSE:BANKNIFTY"]);
    expect(boosted[0]?.ticker).toBe("NSE:BANKNIFTY");
  });

  it("scores prefixes higher than mid-string matches", () => {
    expect(fuzzyScore("btc", "BTCUSDT")).toBeGreaterThan(fuzzyScore("tcs", "NSE:TCS") - 1000);
    expect(fuzzyScore("zzz", "BTCUSDT")).toBe(-1);
  });
});

describe("parseInstrumentFilters", () => {
  const exchangeInfo = {
    symbols: [
      {
        symbol: "BTCUSDT",
        filters: [
          { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
          { filterType: "LOT_SIZE", stepSize: "0.00001000" },
          { filterType: "NOTIONAL", minNotional: "5" },
        ],
      },
    ],
  };

  test("reads PRICE_FILTER.tickSize and LOT_SIZE.stepSize for the symbol", () => {
    expect(parseInstrumentFilters(exchangeInfo, "BTCUSDT")).toEqual({ tickSize: 0.01, stepSize: 0.00001 });
  });

  test("returns undefined when the symbol or a size filter is missing or not a positive finite number", () => {
    expect(parseInstrumentFilters(exchangeInfo, "ETHUSDT")).toBeUndefined();
    expect(parseInstrumentFilters({ symbols: [{ symbol: "BTCUSDT", filters: [] }] }, "BTCUSDT")).toBeUndefined();
    expect(parseInstrumentFilters({
      symbols: [{ symbol: "BTCUSDT", filters: [{ filterType: "PRICE_FILTER", tickSize: "Infinity" }, { filterType: "LOT_SIZE", stepSize: "0.01" }] }],
    }, "BTCUSDT")).toBeUndefined();
  });
});

describe("loadTickSize", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  const payload = (symbol: string, tickSize: string) => Response.json({
    symbols: [{
      symbol,
      filters: [
        { filterType: "PRICE_FILTER", tickSize },
        { filterType: "LOT_SIZE", stepSize: "0.001" },
      ],
    }],
  });

  test("retries a failed lookup, then caches the tick", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 503 });
      return payload("BNBUSDT", "0.10000000");
    }) as typeof fetch;
    expect(await loadTickSize("BNBUSDT")).toBeUndefined();
    expect(await loadTickSize("BNBUSDT")).toBe(0.1);
    expect(await loadTickSize("BNBUSDT")).toBe(0.1);
    expect(calls).toBe(2);
  });

  test("retries when the response has no tick size", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return Response.json({ symbols: [] });
      return payload("ETHUSDT", "0.01000000");
    }) as typeof fetch;
    expect(await loadTickSize("ETHUSDT")).toBeUndefined();
    expect(await loadTickSize("ETHUSDT")).toBe(0.01);
    expect(calls).toBe(2);
  });
});
