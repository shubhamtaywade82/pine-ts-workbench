import { describe, expect, it } from "bun:test";
import { bestDayShare, breakdown, cellOf, cumulativeR, paperTrades, parseReplayCsv, type BotTrade } from "./bot-analysis";

const trade = (over: Partial<BotTrade>): BotTrade => ({
  date: "2026-11-02", underlying: "NIFTY", strategy: "trend", side: "CE", dte: 3, minuteOfDay: 600, posture: "scout", exitReason: "TARGET", r: 1, netPnlInr: 100, ...over,
});

describe("paperTrades", () => {
  const entry = { type: "entry_submitted", correlationId: "a", strategy: "momentum", optionType: "CE", daysToExpiry: 4, minuteOfDayIst: 615, posture: "scout", entryReference: 100, stopLossPrice: 50, quantity: 65 };
  const fill = { type: "entry_filled", correlationId: "a", averagePrice: 102, stopLossPrice: 51, quantity: 65 };
  const close = { type: "trade_closed", positionId: "a", underlying: "NIFTY", pnlInr: 1657.5, reason: "TARGET", ts: "2026-11-12T05:00:00.000Z" };

  it("joins each closed trade to its entry and sizes R from the fill and stop", () => {
    const [t] = paperTrades([entry, fill, close]);
    // Risk is (102 − 51) × 65 = 3315; 1657.5 / 3315 = 0.5R.
    expect(t).toMatchObject({ strategy: "momentum", side: "CE", dte: 4, minuteOfDay: 615, date: "2026-11-12", exitReason: "TARGET" });
    expect(t!.r).toBeCloseTo(0.5);
  });

  it("prefers the planned risk when the entry records it", () => {
    const [t] = paperTrades([{ ...entry, plannedRiskInr: 20_000 }, fill, { ...close, pnlInr: -10_000 }]);
    expect(t!.r).toBeCloseTo(-0.5);
  });

  it("counts a close journalled twice once", () => {
    expect(paperTrades([entry, fill, close, close])).toHaveLength(1);
  });

  it("leaves out operator test trades and trades without an entry", () => {
    expect(paperTrades([{ ...entry, strategy: "test" }, fill, close])).toEqual([]);
    expect(paperTrades([close])).toEqual([]);
  });
});

describe("parseReplayCsv", () => {
  it("reads the Time Machine's trade CSV", () => {
    const csv = "date,strategy,direction,optionType,strike,entryTime,exitTime,entryPrice,exitPrice,lots,quantity,riskInr,grossPnlInr,chargesInr,netPnlInr,r,exitReason,ambiguousBar,gapThroughStop\n2026-04-02,trend,BULLISH,CE,23000,2026-04-02T04:15:00.000Z,2026-04-02T04:45:00.000Z,100,130,1,75,3750,2250,60,2190,0.584,TARGET,false,false\n";
    const [t] = parseReplayCsv(csv, "NIFTY");
    expect(t).toMatchObject({ date: "2026-04-02", strategy: "trend", side: "CE", minuteOfDay: 9 * 60 + 45, r: 0.584, netPnlInr: 2190, dte: undefined });
  });

  it("skips rows it cannot read", () => {
    expect(parseReplayCsv("date,optionType,r\n2026-04-02,XX,1\n2026-04-02,CE,abc\n", "NIFTY")).toEqual([]);
  });
});

describe("cells", () => {
  const trades = [
    ...Array.from({ length: 10 }, (_, i) => trade({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, r: 1 })),
    ...Array.from({ length: 10 }, (_, i) => trade({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, strategy: "momentum", r: -1, exitReason: "STOP_LOSS" })),
  ];

  it("calls a steady winner Positive and a steady loser Negative", () => {
    const [a, b] = breakdown(trades, (t) => t.strategy).sort((x, y) => x.key.localeCompare(y.key));
    expect(b).toMatchObject({ key: "trend", trades: 10, meanR: 1, verdict: "Positive" });
    expect(a).toMatchObject({ key: "momentum", meanR: -1, verdict: "Negative" });
  });

  it("widens the interval when more cells are compared", () => {
    const mixed = [0.5, -0.2, 0.8, -0.4, 0.6, 0.1, -0.3, 0.9, 0.2, -0.1].map((r, i) => trade({ r, date: `2026-11-${i + 1}` }));
    const alone = cellOf("x", mixed, 1).meanRCi!;
    const amongMany = cellOf("x", mixed, 20).meanRCi!;
    expect(amongMany.high - amongMany.low).toBeGreaterThan(alone.high - alone.low);
  });

  it("measures how much one day carried", () => {
    expect(bestDayShare([trade({ date: "a", r: 3 }), trade({ date: "b", r: 1 }), trade({ date: "b", r: -2 })])).toBe(1);
    expect(bestDayShare([trade({ r: -1 })])).toBeUndefined();
  });

  it("totals R in trade order for the equity curve", () => {
    expect(cumulativeR([trade({ r: 1 }), trade({ r: -0.5 }), trade({ r: 2 })])).toEqual([1, 0.5, 2.5]);
  });
});
