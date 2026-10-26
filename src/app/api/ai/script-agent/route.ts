import { NextResponse } from "next/server";
import { OllamaClient, Agent, ToolRegistry, type AnyTool, type AgentTurn } from "@nemesis-oss/ollama-sdk";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runIndicatorCode } from "@/lib/indicator-runner";
import { runBacktest } from "@/lib/strategy-runner";
import { describeCode } from "@/lib/script-library";

const DEFAULT_MODEL = "minicpm5-toolagent:latest";

// 20 synthetic bars with realistic price action for dry-running indicators and strategies.
const TRIAL_BARS: readonly Bar[] = Array.from({ length: 20 }, (_, i) => {
  const base = 100 + Math.sin(i / 3) * 5;
  return {
    time: 1_700_000_000 + i * 60,
    open: base,
    high: base + 2,
    low: base - 2,
    close: base + 1,
    volume: 100 + i * 10,
  };
});

const SYSTEM_PROMPT = `You are an expert Pine Script (TypeScript / @nemesis-oss/pine-ts) developer.
Your mission is to generate, fix, and optimize trading indicators and strategies using the concise @nemesis-oss/pine-ts DSL.

SYNTAX RULES:
- Indicators: indicator("Title", ({ close, open, high, low, volume, input, plot, hline, draw, ta, math, smc }) => { ... })
- Strategies: defineStrategy("Title", { default_qty_value: 1 }, ({ close, open, high, low, strategy, input, ta, smc }) => { ... })
- Plots: plot(series, "Label", { color: "#..." })
- Thresholds: hline(level, "Label", { color: "#..." })
- Technical Analysis: ta.rsi(close, 14), ta.ema(close, 20), ta.sma(close, 50), ta.macd(close, 12, 26, 9), ta.crossover(a, b), ta.crossunder(a, b)
- Strategy orders: strategy.entry("Long", strategy.long), strategy.close("Long"), strategy.exit("Exit", { from_entry: "Long", profit: 100, loss: 50 })
- Inputs: input.int(14, "Length", { min: 1 }), input.float(1.5, "Factor"), input.bool(true, "Show")

CRITICAL WORKFLOW:
1. When generating or fixing code, you MUST call the "validate_script" tool with your candidate code.
2. If "validate_script" returns valid: false, read the error message, correct the code, and re-call "validate_script".
3. When "validate_script" returns valid: true, present the complete code inside a single \`\`\`typescript ... \`\`\` code block and provide a concise summary.`;

export async function testScript(code: string): Promise<{ valid: boolean; kind?: string; error?: string }> {
  try {
    const isStrategy = describeCode(code).kind === "strategy";
    if (isStrategy) {
      const backtest = await runBacktest(code, TRIAL_BARS);
      if (!backtest.ok) return { valid: false, error: backtest.error };
      return { valid: true, kind: "strategy" };
    }
    const indicator = await runIndicatorCode(code, TRIAL_BARS);
    if (indicator.firstBarError) return { valid: false, error: indicator.firstBarError };
    return { valid: true, kind: "indicator" };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function createValidationTool(): AnyTool {
  return {
    name: "validate_script",
    description: "Validates Pine-TS script syntax and dry-runs on trial bars. Returns { valid: true } or { valid: false, error: string }.",
    schema: {
      safeParse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "code" in input) {
          return { success: true, data: input as { code: string } };
        }
        return { success: false, error: new Error("Expected object with code property") };
      },
    } as unknown as AnyTool["schema"],
    execute: async (params: { code: string }) => testScript(params.code),
    definition: {
      type: "function",
      function: {
        name: "validate_script",
        description: "Validates Pine-TS script syntax and dry-runs on trial bars.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Pine-TS script code to test" },
          },
          required: ["code"],
        },
      },
    },
  };
}

export function extractCodeBlock(text: string): string | null {
  const match = /```(?:typescript|javascript|ts|js)?\s*([\s\S]*?)```/.exec(text);
  return match ? match[1]!.trim() : null;
}

export function buildUserMessage(prompt: string, currentCode?: string, error?: string): string {
  const parts: string[] = [prompt];
  if (currentCode) parts.push(`\n\nCurrent Code:\n\`\`\`typescript\n${currentCode}\n\`\`\``);
  if (error) parts.push(`\n\nCompile/Runtime Error to fix:\n${error}`);
  return parts.join("");
}

function findValidatedCode(turns: readonly AgentTurn[]): string | null {
  for (const turn of turns) {
    if (!turn.toolResults) continue;
    for (const res of turn.toolResults) {
      if (res.toolName !== "validate_script" || !res.success) continue;
      const parsed = res.result as { valid?: boolean } | undefined;
      if (parsed?.valid !== true) continue;
      const call = turn.toolCalls?.find((c) => c.id === res.toolCallId || c.function.name === "validate_script");
      const args = call?.function.arguments;
      if (args && typeof args === "object" && "code" in args) {
        return String((args as { code: unknown }).code);
      }
    }
  }
  return null;
}

export async function GET() {
  try {
    const client = new OllamaClient({ baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434" });
    const models = await client.listModels();
    const toolModels = models
      .filter((m) => {
        const caps = (m as unknown as { capabilities?: readonly string[] }).capabilities;
        return caps?.includes("tools") ?? false;
      })
      .map((m) => m.name);
    return NextResponse.json({ models: toolModels.length > 0 ? toolModels : [DEFAULT_MODEL], defaultModel: DEFAULT_MODEL });
  } catch {
    return NextResponse.json({ models: [DEFAULT_MODEL], defaultModel: DEFAULT_MODEL });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prompt: string; currentCode?: string; error?: string; model?: string };
    const client = new OllamaClient({ baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434" });
    const tools = new ToolRegistry([createValidationTool()]);
    const agent = new Agent(client, { tools, maxIterations: 5 });

    const result = await agent.run({
      model: body.model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(body.prompt, body.currentCode, body.error) },
      ],
    });

    const validatedCode = findValidatedCode(result.turns);
    const rawContent = result.finalMessage.content || "";
    const extracted = extractCodeBlock(rawContent);
    const finalCode = extracted ?? validatedCode ?? body.currentCode ?? "";

    return NextResponse.json({ ok: true, code: finalCode, explanation: rawContent, iterations: result.totalIterations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
