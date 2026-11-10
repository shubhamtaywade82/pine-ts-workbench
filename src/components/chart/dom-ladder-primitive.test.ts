import { describe, expect, test } from "bun:test";
import { rowSlice } from "./dom-ladder-primitive";

describe("DOM ladder row split", () => {
  test("keeps a one-sided row at full height", () => {
    expect(rowSlice("bid", false)).toEqual({ top: 0, height: 1 });
    expect(rowSlice("ask", false)).toEqual({ top: 0, height: 1 });
  });

  test("puts the ask on the top half and the bid on the bottom half when the row has both", () => {
    expect(rowSlice("ask", true)).toEqual({ top: 0, height: 0.5 });
    expect(rowSlice("bid", true)).toEqual({ top: 0.5, height: 0.5 });
  });
});
