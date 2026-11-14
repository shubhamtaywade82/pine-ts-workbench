import { describe, expect, it } from "bun:test";
import { contractSymbol, formatExpiry, summarizeChain, type RawChain } from "./option-chain";
import { SYMBOL_CATALOG } from "./symbol-catalog";

const leg = (ltp: number, oi: number, previousOi = oi, iv = 15) =>
  ({ last_price: ltp, oi, previous_oi: previousOi, implied_volatility: iv, greeks: { delta: 0.5 }, security_id: 1000 + ltp });

describe("summarizeChain", () => {
  const chain: RawChain = {
    lastPrice: 108,
    strikes: [
      { strike: 100, call: leg(9, 100, 80, 14), put: leg(1, 50, 50, 16) },
      { strike: 110, call: leg(3, 20, 30, 12), put: leg(4, 200, 150, 18) },
      { strike: 120, call: leg(1, 10), put: leg(12, 5) },
    ],
  };

  it("finds the strike nearest the spot and the straddle price there", () => {
    const summary = summarizeChain(chain)!;
    expect(summary.atmStrike).toBe(110);
    expect(summary.straddle).toBe(7);
    expect(summary.expectedMovePct).toBeCloseTo((7 / 108) * 100);
    expect(summary.atmIv).toBe(15);
  });

  it("computes the put-call ratio from total open interest", () => {
    expect(summarizeChain(chain)!.pcr).toBeCloseTo(255 / 130);
  });

  it("reports open-interest change against the previous session", () => {
    const [first, second] = summarizeChain(chain)!.rows;
    expect(first!.call!.oiChange).toBe(20);
    expect(second!.call!.oiChange).toBe(-10);
    expect(second!.put!.oiChange).toBe(50);
  });

  it("names the strikes with the most open interest on each side", () => {
    const summary = summarizeChain(chain)!;
    expect(summary.maxCallOiStrike).toBe(100);
    expect(summary.maxPutOiStrike).toBe(110);
  });

  it("finds max pain where writers pay the least", () => {
    // Calls: 100 OI at 100. Puts: 50 OI at 120. Expiring at 100 costs 1000; at 110, 1500; at 120, 2000.
    const painful: RawChain = {
      lastPrice: 110,
      strikes: [{ strike: 100, call: leg(1, 100) }, { strike: 110 }, { strike: 120, put: leg(1, 50) }],
    };
    expect(summarizeChain(painful)!.maxPain).toBe(100);
  });

  it("shows only the strikes around the money", () => {
    const wide: RawChain = { lastPrice: 50, strikes: Array.from({ length: 21 }, (_, i) => ({ strike: i * 5, call: leg(1, 1) })) };
    const rows = summarizeChain(wide, 2)!.rows;
    expect(rows.map((r) => r.strike)).toEqual([40, 45, 50, 55, 60]);
  });

  it("copes with missing legs and prices", () => {
    const sparse: RawChain = { lastPrice: 100, strikes: [{ strike: 100, call: { oi: 5 } }] };
    const summary = summarizeChain(sparse)!;
    expect(summary.straddle).toBeUndefined();
    expect(summary.atmIv).toBeUndefined();
    expect(summary.pcr).toBe(0);
  });

  it("is undefined for an empty chain or one without a spot", () => {
    expect(summarizeChain({ lastPrice: 100, strikes: [] })).toBeUndefined();
    expect(summarizeChain({ strikes: [{ strike: 100 }] })).toBeUndefined();
  });
});

describe("contract naming", () => {
  it("formats expiry dates the way contracts are named", () => {
    expect(formatExpiry("2026-11-17")).toBe("17 NOV");
    expect(formatExpiry("2027-01-05")).toBe("5 JAN");
    expect(formatExpiry("garbage")).toBe("garbage");
  });

  it("builds a Dhan chart symbol for a contract, in the underlying's exchange", () => {
    const nifty = SYMBOL_CATALOG.find((s) => s.ticker === "NSE:NIFTY50")!;
    const sensex = SYMBOL_CATALOG.find((s) => s.ticker === "BSE:SENSEX")!;

    const call = contractSymbol(nifty, { expiry: "2026-11-17", strike: 25150, side: "call", securityId: "45392" });
    const put = contractSymbol(sensex, { expiry: "2026-11-20", strike: 81500, side: "put", securityId: "7" });

    expect(call).toMatchObject({ displayName: "NIFTY 50 17 NOV 25150 CALL", provider: "dhan", dhanSegment: "NSE_FNO", dhanSecurityId: "45392", category: "derivative" });
    expect(put).toMatchObject({ displayName: "SENSEX 20 NOV 81500 PUT", dhanSegment: "BSE_FNO", exchange: "BSE" });
    expect(call.ticker).not.toBe(put.ticker);
  });
});
