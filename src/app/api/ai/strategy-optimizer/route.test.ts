import { describe, expect, test } from "bun:test";
import { GET, extractCodeBlock, buildAuditMessage, validateOptimizedCode } from "./route";

describe("strategy-optimizer api route", () => {
  test("GET returns models array and defaultModel", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { models: string[]; defaultModel: string };
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.defaultModel).toBe("minicpm5-toolagent:latest");
  });

  test("extractCodeBlock extracts typescript block from text", () => {
    const text = "### Analysis\n```typescript\ndefineStrategy('Optimized', {}, () => {});\n```";
    expect(extractCodeBlock(text)).toBe("defineStrategy('Optimized', {}, () => {});");
  });

  test("buildAuditMessage formats strategy and metrics summary", () => {
    const msg = buildAuditMessage("const strategyCode = 1;", {
      initialCapital: 10000,
      netProfit: 1250,
      grossProfit: 2000,
      grossLoss: 750,
      maxDrawdown: 350,
      finalEquity: 11250,
      winTrades: 13,
      lossTrades: 7,
      profitFactor: 2.66,
      winRate: 0.65,
      totalTrades: 20,
    });
    expect(msg).toContain("Strategy Code:");
    expect(msg).toContain("Net Profit: $1250.00");
    expect(msg).toContain("Profit Factor: 2.66");
    expect(msg).toContain("Win Rate: 65.0%");
  });

  test("validateOptimizedCode accepts valid strategy and preserves candidate", async () => {
    const valid = 'defineStrategy("Valid", { default_qty_value: 1 }, ({ strategy }) => { strategy.entry("L", "long"); });';
    const original = 'defineStrategy("Orig", {}, () => {});';
    const result = await validateOptimizedCode(valid, original);
    expect(result.code).toBe(valid);
    expect(result.notice).toBeUndefined();
  });

  test("validateOptimizedCode guards against hallucinated getPositions and retains original", async () => {
    const broken = 'defineStrategy("Broken", {}, ({ strategy }) => { (strategy as any).getPositions(); });';
    const original = 'defineStrategy("Orig", {}, () => {});';
    const result = await validateOptimizedCode(broken, original);
    expect(result.code).toBe(original);
    expect(result.notice).toContain("Compiler Validation Warning");
    expect(result.notice).toContain("getPositions is not a function");
  });
});
