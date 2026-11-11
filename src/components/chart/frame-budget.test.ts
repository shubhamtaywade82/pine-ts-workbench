import { describe, expect, test } from "bun:test";
import { createFrameGate } from "./frame-budget";

describe("createFrameGate (one ~30 fps repaint budget shared by every chart animation loop)", () => {
  test("should open the first frame", () => {
    expect(createFrameGate()(1_000)).toBe(true);
  });

  test("should let every loop through within the same frame, so they share one repaint", () => {
    const gate = createFrameGate();
    expect(gate(1_000)).toBe(true);
    expect(gate(1_000)).toBe(true);
    expect(gate(1_000)).toBe(true);
  });

  test("should deny every loop in frames that come sooner than the budget allows", () => {
    const gate = createFrameGate();
    gate(1_000);
    expect(gate(1_016)).toBe(false);
    expect(gate(1_016)).toBe(false);
    expect(gate(1_032)).toBe(false);
  });

  test("should open the next frame once a full ~33 ms has passed", () => {
    const gate = createFrameGate();
    gate(1_000);
    expect(gate(1_034)).toBe(true);
    expect(gate(1_034)).toBe(true);
    expect(gate(1_050)).toBe(false);
  });
});
