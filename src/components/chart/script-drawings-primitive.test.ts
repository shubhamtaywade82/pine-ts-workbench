import { describe, expect, test } from "bun:test";
import { isDrawingVisible, type ChartDrawing } from "./script-drawings-primitive";

const range = { from: 1_000, to: 2_000 };

const box = (from: number, to: number): ChartDrawing =>
  ({ kind: "box", from, to, top: 2, bottom: 1, isBullish: true });

const label = (time: number): ChartDrawing =>
  ({ kind: "label", x: 0, y: 1, text: "BOS", time });

describe("isDrawingVisible (cull script drawings outside the visible time range)", () => {
  test("should keep a span that overlaps the range on either side", () => {
    expect(isDrawingVisible(box(500, 1_200), range)).toBe(true);
    expect(isDrawingVisible(box(1_800, 2_500), range)).toBe(true);
    expect(isDrawingVisible(box(500, 2_500), range)).toBe(true);
  });

  test("should drop a span entirely before or after the range", () => {
    expect(isDrawingVisible(box(100, 999), range)).toBe(false);
    expect(isDrawingVisible(box(2_001, 3_000), range)).toBe(false);
  });

  test("should keep a single-time drawing inside the range and drop one outside", () => {
    expect(isDrawingVisible(label(1_500), range)).toBe(true);
    expect(isDrawingVisible(label(2_500), range)).toBe(false);
  });

  test("should always keep tables, which are pinned to the pane", () => {
    const table: ChartDrawing = { kind: "table", table: { position: "top_right", rows: [] } as never };
    expect(isDrawingVisible(table, range)).toBe(true);
  });
});
