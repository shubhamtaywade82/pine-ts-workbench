import { describe, expect, test } from "bun:test";
import {
  activityLabel,
  compactQuantity,
  easeToward,
  formatBucketWidth,
  ladderPriceColumnX,
  rowShowsText,
} from "./dom-ladder-layout";

const metrics = { priceWidth: 64, barMax: 72, activityWidth: 96 };

describe("ladder layout helpers", () => {
  test("eases about 63% of the gap after one tau", () => {
    expect(easeToward(0, 10, 0, 150)).toBe(0);
    expect(easeToward(0, 10, 150, 150)).toBeCloseTo(10 * (1 - Math.exp(-1)));
    expect(easeToward(0, 10, 10_000, 150)).toBeCloseTo(10, 4);
  });

  test("places the price column just right of the last bar and clamps it into the pane", () => {
    expect(ladderPriceColumnX(400, 10, 800, metrics)).toBe(405);
    expect(ladderPriceColumnX(0, 0, 800, metrics)).toBe(metrics.barMax);
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
