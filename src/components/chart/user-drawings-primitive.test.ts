import { describe, expect, it } from "bun:test";
import { UserDrawingsPrimitive } from "./user-drawings-primitive";
import type { UserDrawing } from "@/lib/user-drawings";

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
