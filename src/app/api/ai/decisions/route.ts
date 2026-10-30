import { NextResponse } from "next/server";
import { OllamaClient } from "@nemesis-oss/ollama-sdk";
import type { MarketDecisionSnapshot } from "@/lib/decision-intelligence/snapshot";
import {
  DEFAULT_DECISION_MODEL,
  evaluateDecision,
} from "@/lib/decision-intelligence/tev1";

// Generous timeout for local decision evaluations on CPU/GPU.
const OLLAMA_TIMEOUT_MS = 120_000;

function createClient(): OllamaClient {
  return new OllamaClient({
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    timeoutMs: OLLAMA_TIMEOUT_MS,
  });
}

export async function GET() {
  try {
    const client = createClient();
    const models = await client.listModels();
    const decisionModels = models
      .filter((m) => {
        const caps = (m as unknown as { capabilities?: readonly string[] }).capabilities;
        const name = m.name.toLowerCase();
        return (caps?.includes("decision") ?? false) || name.includes("tev1");
      })
      .map((m) => m.name);

    return NextResponse.json({
      ok: true,
      models: decisionModels.length > 0 ? decisionModels : [DEFAULT_DECISION_MODEL],
      defaultModel: decisionModels.includes(DEFAULT_DECISION_MODEL) ? DEFAULT_DECISION_MODEL : (decisionModels[0] ?? DEFAULT_DECISION_MODEL),
    });
  } catch {
    return NextResponse.json({
      ok: true,
      models: [DEFAULT_DECISION_MODEL],
      defaultModel: DEFAULT_DECISION_MODEL,
    });
  }
}

interface RequestPayload {
  readonly snapshot?: MarketDecisionSnapshot;
  readonly model?: string;
}

function isValidSnapshot(s: unknown): s is MarketDecisionSnapshot {
  if (typeof s !== "object" || s === null) return false;
  const snap = s as Record<string, unknown>;
  return typeof snap.metadata === "object" && typeof snap.marketRegime === "object" && typeof snap.orderFlow === "object";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestPayload;
    if (!isValidSnapshot(body.snapshot)) {
      return NextResponse.json({ ok: false, error: "Invalid market snapshot payload" }, { status: 400 });
    }

    const client = createClient();
    const result = await evaluateDecision(client, body.snapshot, { model: body.model });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, latencyMs: result.latencyMs }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
