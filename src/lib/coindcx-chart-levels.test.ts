import { describe, expect, it } from "bun:test";
import type { SymbolOption } from "@/lib/public-binance-feed";
import type { CoindcxPosition } from "./coindcx-client";
import {
  coindcxPositionDrawings,
  findMatchingCoindcxPositions,
  isPositionMatchingSymbol,
  lerp,
} from "./coindcx-chart-levels";

describe("coindcx-chart-levels", () => {
  const btcCoindcxSymbol: SymbolOption = {
    displayName: "BTC/USDT",
    ticker: "BTC_USDT",
    provider: "coindcx",
    exchange: "COINDCX",
    category: "crypto",
    binanceSymbol: "BTCUSDT",
    coindcxPair: "B-BTC_USDT",
  };

  const btcBinanceSymbol: SymbolOption = {
    displayName: "BTC/USDT",
    ticker: "BTCUSDT",
    provider: "binance",
    exchange: "BINANCE",
    category: "crypto",
    binanceSymbol: "BTCUSDT",
  };

  const samplePosition: CoindcxPosition = {
    id: "pos-1",
    pair: "B-BTC_USDT",
    side: "LONG",
    size: 0.5,
    entryPrice: 65000,
    markPrice: 67000,
    liquidationPrice: 52000,
    leverage: 10,
    margin: 3250,
    marginCurrency: "USDT",
    unrealizedPnl: 1000,
    pnlPercentage: 30.77,
  };

  it("matches position to CoinDCX symbol correctly", () => {
    expect(isPositionMatchingSymbol(samplePosition.pair, btcCoindcxSymbol)).toBe(true);
  });

  it("matches position to Binance equivalent symbol correctly", () => {
    expect(isPositionMatchingSymbol(samplePosition.pair, btcBinanceSymbol)).toBe(true);
  });

  it("does not match unrelated symbols", () => {
    const ethSymbol: SymbolOption = {
      displayName: "ETH/USDT",
      ticker: "ETHUSDT",
      provider: "binance",
      exchange: "BINANCE",
      category: "crypto",
      binanceSymbol: "ETHUSDT",
    };
    expect(isPositionMatchingSymbol(samplePosition.pair, ethSymbol)).toBe(false);
  });

  it("findMatchingCoindcxPositions filters positions matching symbol", () => {
    const positions: CoindcxPosition[] = [
      samplePosition,
      {
        id: "pos-2",
        pair: "B-ETH_USDT",
        side: "SHORT",
        size: 2,
        entryPrice: 3400,
        markPrice: 3300,
        liquidationPrice: 3800,
        leverage: 5,
        margin: 1360,
        marginCurrency: "USDT",
        unrealizedPnl: 200,
        pnlPercentage: 14.7,
      },
    ];

    const matchedBtc = findMatchingCoindcxPositions(positions, btcBinanceSymbol);
    expect(matchedBtc).toHaveLength(1);
    expect(matchedBtc[0]?.id).toBe("pos-1");
  });

  it("coindcxPositionDrawings produces entry line, liquidation line, and labels", () => {
    const span = { startTime: 1700000000000, lastTime: 1700003600000 };
    const intervalMs = 60_000;
    const drawings = coindcxPositionDrawings([samplePosition], span, intervalMs);

    expect(drawings.length).toBeGreaterThanOrEqual(4);
    // Find entry line
    const entryLine = drawings.find((d) => d.kind === "shape-line" && "y1" in d && d.y1 === 65000);
    expect(entryLine).toBeDefined();

    // Find liquidation line
    const liqLine = drawings.find((d) => d.kind === "shape-line" && "y1" in d && d.y1 === 52000);
    expect(liqLine).toBeDefined();

    // Find labels
    const entryLabel = drawings.find((d) => d.kind === "label" && "text" in d && d.text.includes("LONG 0.5"));
    expect(entryLabel).toBeDefined();
  });

  it("formats USD pair price and INR PnL for INR-margined futures", () => {
    const inrPos: CoindcxPosition = {
      ...samplePosition,
      marginCurrency: "INR",
      unrealizedPnl: 89000,
      margin: 290000,
    };
    const span = { startTime: 1700000000000, lastTime: 1700003600000 };
    const drawings = coindcxPositionDrawings([inrPos], span, 60_000);
    const label = drawings.find(
      (d): d is Extract<typeof drawings[number], { kind: "label" }> => d.kind === "label" && d.text.includes("CoinDCX LONG"),
    );
    expect(label).toBeDefined();
    expect(label?.text).toContain("@ $65,000");
    expect(label?.text).toContain("PnL: +₹89000.00");
  });

  it("lerp computes linear interpolation between values accurately", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(100, 200, 0.25)).toBe(125);
  });
});
