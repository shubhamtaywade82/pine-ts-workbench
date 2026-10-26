import { NextResponse } from "next/server";
import { OllamaClient, Agent, ToolRegistry, type AnyTool } from "@nemesis-oss/ollama-sdk";
import type { Bar } from "@nemesis-oss/pine-ts";
import { runBacktest, type BacktestSummary, type BacktestTrade } from "@/lib/strategy-runner";
import type { InputValue } from "@/lib/script-library";

const DEFAULT_MODEL = "minicpm5-toolagent:latest";

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

WORKFLOW:
1. Inspect the strategy's performance metrics and identify weaknesses (high drawdown, low profit factor, poor R:R).
2. Call the "test_parameter_variation" tool to test 1 to 3 variations on inputs declared in the strategy (e.g., lengths, thresholds, multipliers).
3. Evaluate the tested variations and choose the optimal, robust parameter set.
4. Provide a structured response:
   - ### Strategy Audit: Diagnostic breakdown of performance, risk, and excursions.
   - ### Parameter Optimization: Summary table comparing original vs optimal parameters and backtest metrics.
   - ### Optimized Script: Complete updated script inside a \`\`\`typescript ... \`\`\` block.`;

function createSweepTool(code: string): AnyTool {
  return {
    name: "test_parameter_variation",
    description: "Runs a trial backtest of the strategy with modified parameter inputs. Returns performance metrics.",
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
    const body = (await req.json()) as {
      code: string;
      summary?: BacktestSummary;
      trades?: readonly BacktestTrade[];
      model?: string;
    };

    if (!body.code) return NextResponse.json({ ok: false, error: "Missing strategy code" }, { status: 400 });

    const client = new OllamaClient({ baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434" });
    const tools = new ToolRegistry([createSweepTool(body.code)]);
    const agent = new Agent(client, { tools, maxIterations: 5 });

    const result = await agent.run({
      model: body.model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildAuditMessage(body.code, body.summary, body.trades) },
      ],
    });

    const rawContent = result.finalMessage.content || "";
    const extractedCode = extractCodeBlock(rawContent) ?? body.code;

    return NextResponse.json({
      ok: true,
      analysis: rawContent,
      optimizedCode: extractedCode,
      iterations: result.totalIterations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
