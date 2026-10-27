import { describe, expect, test } from "bun:test";
import { bubbleCenterX, formatAge, formatNotional, wallLabel } from "./depth-walls-primitive";

describe("depth wall bubbles", () => {
  test("sit just right of the forming candle", () => {
    // half a bar (5) + gap (3) + radius (10)
    expect(bubbleCenterX(100, 10, 10, 800)).toBe(118);
  });

  test("stay inside the pane at the right edge", () => {
    expect(bubbleCenterX(795, 10, 10, 800)).toBe(790);
  });

  test("format quote notional compactly", () => {
    expect(formatNotional(950)).toBe("950");
    expect(formatNotional(12_300)).toBe("12.3K");
    expect(formatNotional(2_048_054)).toBe("2.05M");
    expect(formatNotional(1_250_000_000)).toBe("1.25B");
  });

  test("show how long a wall has stood, from 10 s", () => {
    expect(formatAge(9_000)).toBe("");
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(180_000)).toBe("3m");
    expect(formatAge(3_900_000)).toBe("1h 5m");
  });

  test("label price, notional, age, and a non-live status", () => {
    const wall = { side: "bid" as const, price: 79_500, quantity: 25.76, notional: 2_048_054, since: 0 };
    expect(wallLabel(wall, "live", 180_000)).toBe("79,500 · 2.05M · 3m");
    expect(wallLabel(wall, "stale", 5_000)).toBe("79,500 · 2.05M · stale");
  });
});
