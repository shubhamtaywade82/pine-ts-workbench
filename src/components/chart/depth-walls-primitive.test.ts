import { describe, expect, test } from "bun:test";
import {
  bubbleCenterX,
  DepthWallsPrimitive,
  fitWallLabel,
  formatAge,
  formatPct,
  formatWallPill,
  separateLabels,
  wallLabel,
} from "./depth-walls-primitive";
import { paintWallByStyle } from "./depth-wall-painters";
import type { DepthWallStyle } from "@/lib/chart-settings";

const wall = { side: "bid" as const, price: 79_500, quantity: 25.76, notional: 2_048_054, observedSince: 0 };
const base = { wall, quoteAsset: "USDT", searchedPct: 0.5, clippedByCoverage: false, observedMs: 180_000 };

describe("depth wall bubbles", () => {
  test("labels spread one line apart around close walls, ask above bid", () => {
    expect(separateLabels(100, 102, 14)).toEqual({ ask: 94, bid: 108 });
    expect(separateLabels(100, 102, 22)).toEqual({ ask: 90, bid: 112 });
  });

  test("labels stay on walls that are already far enough apart", () => {
    expect(separateLabels(100, 140, 14)).toEqual({ ask: 100, bid: 140 });
    expect(separateLabels(null, 102, 14)).toEqual({ ask: null, bid: 102 });
  });

  test("sit just right of the forming candle", () => {
    expect(bubbleCenterX(100, 10, 10, 800)).toBe(118);
  });

  test("stay inside the pane at the right edge", () => {
    expect(bubbleCenterX(795, 10, 10, 800)).toBe(790);
  });
});

describe("wall labels", () => {
  test("show price, notional in the quote currency, observation length, and the detection scope", () => {
    expect(wallLabel({ ...base, status: "live" })).toBe("79,500 · 2.05M USDT · observed for 3m · max in ±0.5%");
  });

  test("name the quote currency from the input, never assume USDT", () => {
    expect(wallLabel({ ...base, status: "live", quoteAsset: "EUR" })).toContain("2.05M EUR");
  });

  test("say the window was clipped by snapshot coverage", () => {
    expect(wallLabel({ ...base, status: "live", searchedPct: 0.9, clippedByCoverage: true }))
      .toContain("max in ±0.9% (coverage)");
  });

  test("append a non-live status so a frozen or resyncing wall is not read as current", () => {
    expect(wallLabel({ ...base, status: "stale" })).toEndWith("max in ±0.5% · stale");
    expect(wallLabel({ ...base, status: "syncing" })).toEndWith("max in ±0.5% · syncing");
    expect(wallLabel({ ...base, status: "disconnected" })).toEndWith("max in ±0.5% · disconnected");
  });

  test("never uses the old 'stood' wording, which implied an order's age", () => {
    expect(wallLabel({ ...base, status: "live" })).not.toMatch(/stood|since|age/);
  });

  test("shows dynamic liquidity statuses: reduced, stacking, tested, removed, and pulled", () => {
    const reducedWall = { ...wall, status: "reduced" as const, changePct: -35 };
    expect(wallLabel({ ...base, wall: reducedWall, status: "live" }))
      .toContain("reduced (-35%) · 3m");

    const stackingWall = { ...wall, status: "stacking" as const, changePct: 40 };
    expect(wallLabel({ ...base, wall: stackingWall, status: "live" }))
      .toContain("stacking (+40%) · 3m");

    const testedWall = { ...wall, status: "tested" as const };
    expect(wallLabel({ ...base, wall: testedWall, status: "live" }))
      .toContain("tested (holding) · 3m");

    const removedWall = { ...wall, status: "removed" as const };
    expect(wallLabel({ ...base, wall: removedWall, status: "live" }))
      .toContain("removed · 3m");

    const pulledWall = { ...wall, status: "pulled" as const };
    expect(wallLabel({ ...base, wall: pulledWall, status: "live" }))
      .toContain("pulled");
    expect(wallLabel({ ...base, wall: pulledWall, status: "live" })).not.toContain("cancelled");
    expect(wallLabel({ ...base, wall: removedWall, status: "live" })).not.toContain("filled");
  });
});

describe("compact wall pill formatting", () => {
  test("formats price and compact notional cleanly", () => {
    expect(formatWallPill(wall)).toBe("79,500 · 2.05M");
    expect(formatWallPill({ price: 2043.5, notional: 268_600 })).toBe("2,043.5 · 269k");
    expect(formatWallPill({ price: 12.3456789, notional: 500 })).toBe("12.3456789 · 500");
    expect(formatWallPill({ price: 100, notional: 0 })).toBe("100 · 0");
  });

  test("fitWallLabel prefers compact label when space permits", () => {
    const labels = { compact: "82.94 · 1.0k", notionalOnly: "1.0k" };
    const measure = (t: string) => t.length * 6;
    expect(fitWallLabel(labels, 100, measure)).toBe("82.94 · 1.0k");
  });

  test("fitWallLabel falls back to notional-only label in narrow gaps", () => {
    const labels = { compact: "82.94 · 1.0k", notionalOnly: "1.0k" };
    const measure = (t: string) => t.length * 6;
    expect(fitWallLabel(labels, 50, measure)).toBe("1.0k");
    expect(fitWallLabel(labels, 10, measure)).toBe("1.0k");
  });
});

describe("formatting", () => {
  test("observation length: under 10 s is shown, not hidden", () => {
    expect(formatAge(0)).toBe("<10s");
    expect(formatAge(9_000)).toBe("<10s");
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(180_000)).toBe("3m");
    expect(formatAge(3_900_000)).toBe("1h 5m");
  });

  test("the detection window prints without padding", () => {
    expect(formatPct(0.5)).toBe("0.5");
    expect(formatPct(0.9)).toBe("0.9");
    expect(formatPct(1.25)).toBe("1.25");
    expect(formatPct(0.2985)).toBe("0.3");
  });
});

describe("depth wall visual styles and painters", () => {
  const createMockContext = () => {
    const textCalls: Array<{ text: string; x: number; y: number }> = [];
    let clipCount = 0;
    return {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      clip: () => { clipCount++; },
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      rect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillText: (text: string, x: number, y: number) => { textCalls.push({ text, x, y }); },
      setLineDash: () => {},
      measureText: (text: string) => ({ width: text.length * 6 }),
      globalAlpha: 1,
      lineWidth: 1,
      fillStyle: "",
      strokeStyle: "",
      textAlign: "left",
      textBaseline: "middle",
      _textCalls: textCalls,
      _getClipCount: () => clipCount,
    } as unknown as CanvasRenderingContext2D & {
      _textCalls: typeof textCalls;
      _getClipCount: () => number;
    };
  };

  const styles: DepthWallStyle[] = ["shelf", "dom", "bracket", "bubbles"];

  test("all 4 styles paint without throwing", () => {
    const ctx = createMockContext();
    const fullLabel = wallLabel({ ...base, status: "live" });
    const compactLabel = formatWallPill(wall);

    for (const style of styles) {
      expect(() => {
        paintWallByStyle(style, {
          context: ctx,
          side: "bid",
          wall,
          x: 100,
          y: 200,
          labelY: 200,
          alpha: 1,
          radius: 12,
          paneWidth: 800,
          status: "live",
          quoteAsset: "USDT",
          searchedPct: 0.5,
          clippedByCoverage: false,
          observedMs: 60_000,
          fullLabel,
          compactLabel,
          label: compactLabel,
          minLabelX: 120,
        });
      }).not.toThrow();
    }
  });

  test("pills never start left of minLabelX even when pane is narrow", () => {
    const ctx = createMockContext();
    const compactLabel = formatWallPill(wall);
    // minLabelX is 350, paneWidth is 400. Text width is length * 6 ~ 84.
    // paneWidth - pillW - 4 < minLabelX, so it clamps to minLabelX (350).
    paintWallByStyle("shelf", {
      context: ctx,
      side: "bid",
      wall,
      x: 300,
      y: 200,
      labelY: 200,
      alpha: 1,
      radius: 12,
      paneWidth: 400,
      status: "live",
      quoteAsset: "USDT",
      searchedPct: 0.5,
      clippedByCoverage: false,
      observedMs: 60_000,
      fullLabel: "detailed",
      compactLabel,
      label: compactLabel,
      minLabelX: 350,
    });
    const lastText = ctx._textCalls.at(-1);
    expect(lastText).toBeDefined();
    expect(lastText?.x).toBeGreaterThanOrEqual(350);
  });

  test("draws notional-only pill in compact mode when space to pane edge is narrow", () => {
    const ctx = createMockContext();
    paintWallByStyle("shelf", {
      context: ctx,
      side: "bid",
      wall,
      x: 340,
      y: 200,
      labelY: 200,
      alpha: 1,
      radius: 12,
      paneWidth: 400,
      status: "live",
      quoteAsset: "USDT",
      searchedPct: 0.5,
      clippedByCoverage: false,
      observedMs: 60_000,
      fullLabel: "79,500 · 2.05M USDT",
      compactLabel: "79,500 · 2.05M",
      notionalOnly: "2.05M",
      label: "79,500 · 2.05M",
      minLabelX: 360,
    });
    expect(ctx._textCalls.at(-1)?.text).toBe("2.05M");
  });

  test("overflowing pill text is clipped rather than shifting left", () => {
    const ctx = createMockContext();
    const fullLabel = wallLabel({ ...base, status: "live" });
    paintWallByStyle("shelf", {
      context: ctx,
      side: "bid",
      wall,
      x: 350,
      y: 200,
      labelY: 200,
      alpha: 1,
      radius: 12,
      paneWidth: 400,
      status: "live",
      quoteAsset: "USDT",
      searchedPct: 0.5,
      clippedByCoverage: false,
      observedMs: 60_000,
      fullLabel,
      compactLabel: formatWallPill(wall),
      label: fullLabel, // ~60 chars * 6 = 360px wide, overflows 400px pane
      minLabelX: 360,
    });
    expect(ctx._getClipCount()).toBeGreaterThan(0);
  });

  test("DepthWallsPrimitive accepts style and label mode changes", () => {
    const primitive = new DepthWallsPrimitive();
    expect(() => {
      primitive.setStyle("shelf");
      primitive.setStyle("dom");
      primitive.setLabel("compact");
      primitive.setLabel("detailed");
      primitive.setWallLabel("compact");
    }).not.toThrow();
  });
});
