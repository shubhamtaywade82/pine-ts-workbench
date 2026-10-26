import { describe, expect, test } from "bun:test";
import { pineCompletions } from "./pine-completions";
import type { CompletionContext } from "@codemirror/autocomplete";

function mockContext(text: string, pos: number, explicit = false): CompletionContext {
  return {
    pos,
    explicit,
    matchBefore: (regex: RegExp) => {
      const slice = text.slice(0, pos);
      const endRegex = new RegExp(regex.source + "$");
      const match = endRegex.exec(slice);
      if (!match) return null;
      return { from: pos - match[0].length, to: pos, text: match[0] };
    },
  } as unknown as CompletionContext;
}

describe("pineCompletions", () => {
  test("returns ta completions when cursor follows ta.", () => {
    const ctx = mockContext("const r = ta.", 13, true);
    const result = pineCompletions(ctx);
    expect(result).not.toBeNull();
    expect(result?.options.some((o) => o.label === "rsi")).toBe(true);
    expect(result?.options.some((o) => o.label === "ema")).toBe(true);
  });

  test("returns smc completions when cursor follows smc.", () => {
    const ctx = mockContext("smc.", 4, true);
    const result = pineCompletions(ctx);
    expect(result).not.toBeNull();
    expect(result?.options.some((o) => o.label === "fairValueGaps")).toBe(true);
    expect(result?.options.some((o) => o.label === "liquidity")).toBe(true);
  });

  test("returns strategy completions when cursor follows strategy.", () => {
    const ctx = mockContext("strategy.", 9, true);
    const result = pineCompletions(ctx);
    expect(result).not.toBeNull();
    expect(result?.options.some((o) => o.label === "entry")).toBe(true);
    expect(result?.options.some((o) => o.label === "close")).toBe(true);
  });

  test("returns root completions for empty prefix with explicit trigger", () => {
    const ctx = mockContext("", 0, true);
    const result = pineCompletions(ctx);
    expect(result).not.toBeNull();
    expect(result?.options.some((o) => o.label === "indicator")).toBe(true);
    expect(result?.options.some((o) => o.label === "defineStrategy")).toBe(true);
  });
});
