import { NextResponse } from "next/server";
import {
  OllamaClient,
  Agent,
  ToolRegistry,
  OllamaAgentMaxIterationsError,
  type AnyTool,
} from "@nemesis-oss/ollama-sdk";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runBacktest, type BacktestSummary, type BacktestTrade } from "@/lib/strategy-runner";
import type { InputValue } from "@/lib/script-library";

const DEFAULT_MODEL = "minicpm5-toolagent:latest";
// Generous timeout for local multi-turn agent runs on CPU/GPU.
const OLLAMA_TIMEOUT_MS = 120_000;

// 30 synthetic bars with realistic trend and mean reversion for backtesting parameter sweeps.
const TRIAL_BARS: readonly Bar[] = Array.from({ length: 30 }, (_, i) => {
  const base = 100 + Math.sin(i / 4) * 8 + (i > 15 ? (i - 15) * 1.5 : 0);
  return {
    time: 1_700_000_000 + i * 300,
    open: base,
    high: base + 3,
    low: base - 3,
    close: base + (i % 2 === 0 ? 1.5 : -1.5),
    volume: 500 + i * 20,
  };
});

const SYSTEM_PROMPT = `You are a quant trading strategy auditor and parameter optimizer for @nemesis-oss/pine-ts.
Your mission is to audit backtest results, inspect trade excursions (MAE/MFE), and optimize strategy parameters.

CRITICAL PINE-TS STRATEGY SYNTAX:
- Declaration: defineStrategy("Title", { initial_capital: 10_000, default_qty_value: 1 }, ({ close, open, high, low, strategy, input, ta, smc }) => { ... })
- Allowed strategy methods:
  - strategy.entry("Long", "long", { when: condition, qty?: number })
  - strategy.entry("Short", "short", { when: condition, qty?: number })
  - strategy.close("Long", { when: condition })
  - strategy.close_all({ when?: condition })
  - strategy.exit("Exit", { from_entry: "Long", profit?: number, loss?: number, limit?: number, stop?: number, when?: condition })
- FORBIDDEN: DO NOT call strategy.getPositions(), strategy.positions, or strategy.order(). They do NOT exist.
- Inspecting position size: read strategy.engine.position_size or pass { when: condition } to strategy.entry/close.
- Technical analysis: ta.rsi(close, length), ta.sma(close, length), ta.ema(close, length), ta.crossover(a, b), ta.crossunder(a, b)

WORKFLOW:
1. Inspect the strategy's performance metrics and identify weaknesses.
2. You may call the "test_parameter_variation" tool AT MOST ONCE to test new input parameters.
3. Provide your final response in markdown:
   - ### Strategy Audit: Diagnostic breakdown of performance, risk, and excursions.
   - ### Parameter Optimization: Summary comparing original vs optimal parameters.
   - ### Optimized Script: Complete updated script inside a \`\`\`typescript ... \`\`\` block.`;

function createSweepTool(code: string): AnyTool {
  return {
    name: "test_parameter_variation",
    description: "Runs trial backtest of strategy with modified inputs.",
    schema: {
      safeParse: (input: unknown) => {
        if (typeof input === "object" && input !== null && "inputs" in input) {
          return { success: true, data: input as { inputs: Record<string, unknown> } };
        }
        return { success: false, error: new Error("Expected object with inputs dictionary") };
      },
    } as unknown as AnyTool["schema"],
    execute: async (params: { inputs: Record<string, unknown> }) => {
      try {
        const res = await runBacktest(code, TRIAL_BARS, {
          inputs: params.inputs as Record<string, InputValue>,
          properties: {},
        });
        if (!res.ok || !res.summary) return { ok: false, error: res.error ?? "Backtest failed" };
        return {
          ok: true,
          netProfit: res.summary.netProfit,
          profitFactor: res.summary.profitFactor,
          maxDrawdown: res.summary.maxDrawdown,
          winRate: res.summary.winRate,
          totalTrades: res.summary.totalTrades,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    definition: {
      type: "function",
      function: {
        name: "test_parameter_variation",
        description: "Runs trial backtest with modified inputs.",
        parameters: {
          type: "object",
          properties: {
            inputs: {
              type: "object",
              description: "Key-value dictionary of strategy input parameter overrides",
            },
          },
          required: ["inputs"],
        },
      },
    },
  };
}

export function extractCodeBlock(text: string): string | null {
  const match = /```(?:typescript|javascript|ts|js)?\s*([\s\S]*?)```/.exec(text);
  return match ? match[1]!.trim() : null;
}

export function buildAuditMessage(
  code: string,
  summary?: BacktestSummary,
  trades?: readonly BacktestTrade[],
): string {
  const parts: string[] = ["Audit and optimize this strategy:"];
  parts.push(`\n\nStrategy Code:\n\`\`\`typescript\n${code}\n\`\`\``);
  if (summary) {
    parts.push(
      `\n\nCurrent Performance Metrics:\n` +
      `- Net Profit: $${summary.netProfit.toFixed(2)}\n` +
      `- Max Drawdown: $${summary.maxDrawdown.toFixed(2)}\n` +
      `- Profit Factor: ${summary.profitFactor.toFixed(2)}\n` +
      `- Win Rate: ${(summary.winRate * 100).toFixed(1)}%\n` +
      `- Total Trades: ${summary.totalTrades}`,
    );
  }
  if (trades && trades.length > 0) {
    const sample = trades.slice(0, 5).map((t) => ({
      direction: t.direction,
      profit: t.profit,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      qty: t.qty,
    }));
    parts.push(`\n\nRecent Trade Samples:\n${JSON.stringify(sample)}`);
  }
  return parts.join("");
}

async function runOptimizationAgent(
  client: OllamaClient,
  model: string,
  code: string,
  auditMessage: string,
): Promise<{ rawContent: string; iterations: number }> {
  const tools = new ToolRegistry([createSweepTool(code)]);
  // Cap at 4 turns to balance parameter experimentation with quick convergence.
  const agent = new Agent(client, { tools, maxIterations: 4 });
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: auditMessage },
  ];

  try {
    const res = await agent.run({ model, messages });
    return { rawContent: res.finalMessage.content || "", iterations: res.totalIterations };
  } catch (err) {
    // Eager tool models exceed iterations: synthesize from final chat turn without tools.
    if (err instanceof OllamaAgentMaxIterationsError) {
      const fallback = await client.chat({
        model,
        messages: [
          ...messages,
          {
            role: "user",
            content: "Synthesize your audit and output the final code inside ```typescript ... ``` now.",
          },
        ],
      });
      return { rawContent: fallback.message.content || "", iterations: 4 };
    }
    throw err;
  }
}

export async function validateOptimizedCode(
  candidate: string,
  original: string,
): Promise<{ code: string; notice?: string }> {
  const test = await runBacktest(candidate, TRIAL_BARS);
  if (test.ok) return { code: candidate };
  // Guard user against broken hallucinated code by retaining original script with a diagnostic warning.
  return {
    code: original,
    notice: `\n\n> ⚠️ **Compiler Validation Warning**: Candidate script failed execution test: *${test.error}*. Original script was retained.`,
  };
}

export async function GET() {
  try {
    const client = new OllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      timeoutMs: OLLAMA_TIMEOUT_MS,
    });
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
    const body = (await req.json()) as {
      code: string;
      summary?: BacktestSummary;
      trades?: readonly BacktestTrade[];
      model?: string;
    };
    if (!body.code) return NextResponse.json({ ok: false, error: "Missing strategy code" }, { status: 400 });

    const client = new OllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      timeoutMs: OLLAMA_TIMEOUT_MS,
    });
    const model = body.model || DEFAULT_MODEL;
    const auditMessage = buildAuditMessage(body.code, body.summary, body.trades);
    const { rawContent, iterations } = await runOptimizationAgent(client, model, body.code, auditMessage);

    const extracted = extractCodeBlock(rawContent);
    const validation = extracted ? await validateOptimizedCode(extracted, body.code) : { code: body.code };

    return NextResponse.json({
      ok: true,
      analysis: rawContent + (validation.notice ?? ""),
      optimizedCode: validation.code,
      iterations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
