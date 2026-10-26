import { describe, expect, test } from "bun:test";
import { GET, testScript, extractCodeBlock, buildUserMessage } from "./route";

describe("script-agent api route and validation", () => {
  test("GET returns available models and default model", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { models: string[]; defaultModel: string };
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.defaultModel).toBe("minicpm5-toolagent:latest");
  });

  test("testScript validates correct indicator", async () => {
    const code = 'indicator("ValidRSI", ({ close, plot }) => { plot(ta.rsi(close, 14), "RSI"); });';
    const result = await testScript(code);
    expect(result.valid).toBe(true);
    expect(result.kind).toBe("indicator");
  });

  test("testScript detects broken syntax in indicator", async () => {
    const code = 'indicator("Broken", ({ close }) => { const x = ; });';
    const result = await testScript(code);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("testScript validates correct strategy", async () => {
    const code = 'defineStrategy("SimpleMA", { default_qty_value: 1 }, ({ close, strategy }) => { if (close > 100) strategy.entry("L", strategy.long); });';
    const result = await testScript(code);
    expect(result.valid).toBe(true);
    expect(result.kind).toBe("strategy");
  });

  test("extractCodeBlock extracts typescript code block", () => {
    const markdown = 'Here is the fixed code:\n```typescript\nindicator("RSI", () => {});\n```\nEnjoy!';
    const extracted = extractCodeBlock(markdown);
    expect(extracted).toBe('indicator("RSI", () => {});');
  });

  test("buildUserMessage combines prompt, code, and error", () => {
    const msg = buildUserMessage("Fix this error", "const x = 1;", "Unexpected token");
    expect(msg).toContain("Fix this error");
    expect(msg).toContain("Current Code:\n```typescript\nconst x = 1;\n```");
    expect(msg).toContain("Compile/Runtime Error to fix:\nUnexpected token");
  });
});
