import { afterEach, describe, expect, it } from "bun:test";
import type { Bar } from "@nemesis-oss/pine-ts";
import { createHtfLoader, htfSourceOf } from "./htf-bars";
import { SYMBOL_CATALOG } from "./symbol-catalog";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const HOUR = 3_600_000;
const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, isClosed: true });

const stubFetch = (bars: Bar[]): string[] => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return Response.json({ ok: true, bars });
  }) as unknown as typeof fetch;
  return urls;
};

describe("htfSourceOf", () => {
  it("names the provider of each kind of symbol", () => {
    const find = (ticker: string) => SYMBOL_CATALOG.find((s) => s.ticker === ticker)!;
    expect(htfSourceOf(find("SOLUSDT"))).toEqual({ kind: "binance", symbol: "SOLUSDT" });
    expect(htfSourceOf(find("NSE:RELIANCE"))).toEqual({ kind: "dhan", segment: "NSE_EQ", securityId: "2885" });
    expect(htfSourceOf({ ...find("BTCUSDT"), provider: "coindcx", coindcxPair: "B-BTC_USDT" })).toEqual({ kind: "coindcx", pair: "B-BTC_USDT" });
  });
});

describe("createHtfLoader", () => {
  const dhan = { kind: "dhan", segment: "NSE_EQ", securityId: "2885" } as const;

  it("asks Dhan for the same instrument, not for a Binance symbol", async () => {
    const urls = stubFetch([bar(0)]);

    await createHtfLoader({ ...dhan, securityId: "11" })("60");

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/api/dhan/bars?");
    expect(urls[0]).toContain("securityId=11");
    expect(urls[0]).toContain("interval=1h");
  });

  it("builds 4h candles from hourly Dhan bars", async () => {
    const open = Date.UTC(2026, 10, 9, 3, 45);
    const urls = stubFetch(Array.from({ length: 7 }, (_, i) => bar(open + i * HOUR)));

    const fourHour = await createHtfLoader(dhan)("240");

    expect(urls[0]).toContain("interval=1h");
    expect(fourHour).toHaveLength(2);
  });

  it("returns nothing, without a request, for a timeframe Dhan cannot serve", async () => {
    const urls = stubFetch([bar(0)]);

    expect(await createHtfLoader(dhan)("W")).toBeUndefined();
    expect(urls).toEqual([]);
  });

  it("asks CoinDCX for its pair", async () => {
    const urls = stubFetch([bar(0)]);

    await createHtfLoader({ kind: "coindcx", pair: "B-ETH_USDT" })("15");

    expect(urls[0]).toContain("/api/coindcx/candles?pair=B-ETH_USDT");
    expect(urls[0]).toContain("interval=15m");
  });

  it("falls back to nothing when the request fails", async () => {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

    expect(await createHtfLoader({ kind: "coindcx", pair: "B-OFF_USDT" })("15")).toBeUndefined();
  });
});
