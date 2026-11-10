import { describe, expect, test } from "bun:test";
import {
  activityLabel,
  compactQuantity,
  easeToward,
  formatBucketWidth,
  ladderPriceColumnX,
  rowShowsText,
} from "./dom-ladder-layout";
import { DomLadderPrimitive } from "./dom-ladder-primitive";
import { createFlowGeometry, flowPoint, formingCloseY, paintTradeFlow } from "./trade-flow-painter";

const metrics = { priceWidth: 64, barMax: 72, activityWidth: 96 };

describe("ladder layout helpers", () => {
  test("eases about 63% of the gap after one tau", () => {
    expect(easeToward(0, 10, 0, 150)).toBe(0);
    expect(easeToward(0, 10, 150, 150)).toBeCloseTo(10 * (1 - Math.exp(-1)));
    expect(easeToward(0, 10, 10_000, 150)).toBeCloseTo(10, 4);
  });

  test("places the price column just right of the last bar and clamps it into the pane", () => {
    // Bid bars (72 px) fit between the forming candle's right edge (405) plus a 4 px gap and the price column.
    expect(ladderPriceColumnX(400, 10, 800, metrics)).toBe(405 + 4 + 72);
    expect(ladderPriceColumnX(-200, 0, 800, metrics)).toBe(metrics.barMax);
    expect(ladderPriceColumnX(790, 10, 800, metrics)).toBe(800 - (64 + 72 + 96));
    expect(ladderPriceColumnX(null, 10, 800, metrics)).toBe(800 - (64 + 72 + 96));
  });

  test("formats quantities and the bucket width", () => {
    expect(compactQuantity(1_200)).toBe("1.2k");
    expect(compactQuantity(999)).toBe("999");
    expect(formatBucketWidth(0.1)).toBe("0.1");
    expect(formatBucketWidth(10)).toBe("10");
  });

  test("picks one activity label and hides text on short rows", () => {
    expect(activityLabel({ bought: 2, sold: 5, pulled: 1 })).toEqual({ text: "5 sold", tone: "sold" });
    expect(activityLabel({ bought: 0, sold: 0, pulled: 3 })?.text).toBe("3 pulled");
    expect(activityLabel({ bought: 1_200, sold: 0, pulled: 0 })?.text).toBe("1.2k bought");
    expect(activityLabel({ bought: 0, sold: 0, pulled: 0 })).toBeUndefined();
    expect(rowShowsText(10)).toBe(false);
    expect(rowShowsText(11)).toBe(true);
  });
});

describe("trade flow geometry and primitive integration", () => {
  const path = { start: { x: 300, y: 100 }, end: { x: 50, y: 160 } };

  test("flowPoint curves from the ladder row to the candle's close", () => {
    expect(flowPoint(path, 0)).toEqual(path.start);
    expect(flowPoint(path, 1)).toEqual(path.end);
    const mid = flowPoint(path, 0.5);
    // Leaves the row flat, so halfway it is still nearer the row's level than a straight line would be.
    expect(mid.y).toBeLessThan((path.start.y + path.end.y) / 2);
    expect(mid.x).toBeLessThan(path.start.x);
    expect(mid.x).toBeGreaterThan(path.end.x);
  });

  test("formingCloseY reads the last bar's close (or value) and maps it to y", () => {
    const toY = (price: number) => 1000 - price;
    expect(formingCloseY({ data: () => [{ close: 10 }, { close: 25 }] }, toY)).toBe(975);
    expect(formingCloseY({ data: () => [{ value: 40 }] }, toY)).toBe(960);
    expect(formingCloseY({ data: () => [] }, toY)).toBeNull();
  });

  test("createFlowGeometry positions ask/bid and maps row y", () => {
    const toY = (price: number) => 1000 - price;
    const geometry = createFlowGeometry({ from: 10, to: 20 }, 200, { x: 50, y: 960 }, toY);

    expect(geometry.candle).toEqual({ x: 50, y: 960 });
    // ask is on right of price column: 200 + 64 + 36 = 300
    expect(geometry.askX).toBe(300);
    // bid is on left of price column: 200 - 36 = 164
    expect(geometry.bidX).toBe(164);
    // mid price for key 2: (2 + 0.5) * 10 = 25 -> toY(25) = 975
    expect(geometry.rowY(2)).toBe(975);
  });

  test("DomLadderPrimitive accepts pushTrades when live and ignores when inactive", () => {
    const primitive = new DomLadderPrimitive();

    // Not live: trades should be ignored
    primitive.pushTrades([{ key: 1, aggressor: "buy", quantity: 10, at: 1000 }]);
    expect(primitive["particles"]).toHaveLength(0);

    // Live with flowAnimation enabled:
    primitive.setBuckets({
      status: "live",
      bids: [{ key: 1, priceFrom: 10, priceTo: 20, quantity: 100, notional: 1500 }],
      asks: [{ key: 2, priceFrom: 20, priceTo: 30, quantity: 100, notional: 2500 }],
      flowAnimation: true,
    });
    primitive.pushTrades([{ key: 1, aggressor: "buy", quantity: 10, at: 1000 }]);
    expect(primitive["particles"]).toHaveLength(1);

    // flowAnimation: false clears and ignores particles
    primitive.setBuckets({
      status: "live",
      bids: [],
      asks: [],
      flowAnimation: false,
    });
    expect(primitive["particles"]).toHaveLength(0);
  });

  test("paintTradeFlow draws in-phase and back-phase particles", () => {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      beginPath: () => calls.push("beginPath"),
      arc: () => calls.push("arc"),
      fill: () => calls.push("fill"),
      moveTo: () => calls.push("moveTo"),
      lineTo: () => calls.push("lineTo"),
      stroke: () => calls.push("stroke"),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    } as unknown as CanvasRenderingContext2D;

    const particles = [
      { id: 1, key: 1, aggressor: "buy" as const, quantity: 10, startedAt: 1000 },
      { id: 2, key: 2, aggressor: "sell" as const, quantity: 20, startedAt: 500 },
    ];
    const geometry = {
      rowY: (key: number) => (key === 1 ? 100 : 200),
      askX: 300,
      bidX: 100,
      candle: { x: 50, y: 150 },
    };
    paintTradeFlow({ context: ctx, particles, geometry, now: 1100 });
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
  });
});
