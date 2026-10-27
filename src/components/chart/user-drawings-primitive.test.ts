import { describe, expect, it } from "bun:test";
import { UserDrawingsPrimitive } from "./user-drawings-primitive";
import type { UserDrawing } from "@/lib/user-drawings";
import { LABEL_SIZES, resolveLabelBox, type PlacedBox } from "./script-shape-painters";

describe("UserDrawingsPrimitive", () => {
  it("initializes with paneViews and default settings", () => {
    const primitive = new UserDrawingsPrimitive();
    const views = primitive.paneViews();
    expect(views.length).toBe(1);
    expect(views[0]?.renderer()).toBeDefined();
  });

  it("accepts drawings and draft updates without throwing", () => {
    const primitive = new UserDrawingsPrimitive();
    const mockDrawing: UserDrawing = {
      id: "draw-1",
      type: "trendline",
      p1: { time: 1000, price: 100 },
      p2: { time: 2000, price: 110 },
    };

    expect(() => primitive.setDrawings([mockDrawing])).not.toThrow();
    expect(() => primitive.setDraft(mockDrawing)).not.toThrow();
    expect(() => primitive.setIntervalMs(60_000)).not.toThrow();
  });
});

describe("script-shape-painters label sizing and collision avoidance", () => {
  it("defines size options with tiny, small, normal, large, huge, and auto", () => {
    expect(LABEL_SIZES.tiny?.font).toContain("9px");
    expect(LABEL_SIZES.small?.font).toContain("10px");
    expect(LABEL_SIZES.normal?.font).toContain("11px");
    expect(LABEL_SIZES.large?.font).toContain("13px");
    expect(LABEL_SIZES.huge?.font).toContain("16px");
    expect(LABEL_SIZES.auto?.font).toBe(LABEL_SIZES.normal?.font);
  });

  it("leaves non-overlapping label box unchanged", () => {
    const initial: PlacedBox = { left: 100, top: 100, right: 150, bottom: 120 };
    const placed: PlacedBox[] = [{ left: 200, top: 200, right: 250, bottom: 220 }];
    const resolved = resolveLabelBox(initial, "above", placed);
    expect(resolved).toEqual(initial);
  });

  it("shifts overlapping label upward when position is above", () => {
    const existing: PlacedBox = { left: 100, top: 100, right: 150, bottom: 120 };
    const challenger: PlacedBox = { left: 110, top: 105, right: 160, bottom: 125 };
    const resolved = resolveLabelBox(challenger, "above", [existing]);
    expect(resolved.bottom).toBeLessThan(existing.top);
  });

  it("shifts overlapping label downward when position is below", () => {
    const existing: PlacedBox = { left: 100, top: 100, right: 150, bottom: 120 };
    const challenger: PlacedBox = { left: 110, top: 105, right: 160, bottom: 125 };
    const resolved = resolveLabelBox(challenger, "below", [existing]);
    expect(resolved.top).toBeGreaterThan(existing.bottom);
  });
});
