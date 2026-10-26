import { describe, expect, test } from "bun:test";
import { sanitizeCompletion, POST } from "./route";

describe("inline-completion route", () => {
  test("sanitizeCompletion strips code blocks and returns first line", () => {
    const raw = "```typescript\nta.rsi(close, 14);\nconst extra = 2;\n```";
    expect(sanitizeCompletion(raw)).toBe("ta.rsi(close, 14);");
  });

  test("POST returns empty completion when given empty prefix", async () => {
    const req = new Request("http://localhost:3100/api/ai/inline-completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; completion: string };
    expect(data.ok).toBe(true);
    expect(data.completion).toBe("");
  });
});
