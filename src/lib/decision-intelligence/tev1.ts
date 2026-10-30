import type { OllamaClient } from "@nemesis-oss/ollama-sdk";
import type { MarketDecisionSnapshot } from "./snapshot";

export const DEFAULT_DECISION_MODEL = "tev1:4b";
export const FALLBACK_DECISION_MODEL = "tev1:0.8b";

export const DECISION_QUESTIONS = {
  trade_decision: {
    type: "choice" as const,
    instructions: "Evaluate the supplied trade candidate using only provided evidence and strategy criteria. Do not predict future prices.",
    criteria: {
      APPROVE: "The evidence satisfies trend, order flow, technical rating, and risk-reward requirements.",
      WAIT: "The setup is developing but an important confirmation is missing or forming.",
      REJECT: "The supplied facts conflict with the candidate direction or fail mandatory conditions.",
      INSUFFICIENT_DATA: "The information required to evaluate the setup is missing or stale.",
    },
  },
  market_regime: {
    type: "choice" as const,
    instructions: "Classify the market condition from the supplied technical and price evidence.",
    criteria: {
      STRONG_UPTREND: "Clear bullish structure and technical ratings.",
      STRONG_DOWNTREND: "Clear bearish structure and technical ratings.",
      RANGE_BOUND: "Oscillators neutral or conflicting, bounded price action.",
      HIGH_VOLATILITY: "Extreme candle ranges or erratic shifts.",
      CHOPPY: "Frequent whipsaws without directional follow-through.",
      UNCERTAIN: "Data is insufficient or ambiguous.",
    },
  },
  mtf_alignment: {
    type: "noul" as const,
    instructions: "Does the primary trend and technical momentum align with the candidate direction?",
  },
  primary_weakness: {
    type: "choice" as const,
    instructions: "Identify the primary weakness in the candidate using only the supplied facts.",
    criteria: {
      NONE: "No material setup weakness is evident.",
      TREND_CONFLICT: "Higher timeframe or technical direction conflicts with the setup.",
      LIQUIDITY_AGAINST: "Opposing resting liquidity wall is absorbing or heavy.",
      POOR_RR: "Supplied risk-reward ratio does not meet minimum standards.",
      INSUFFICIENT_DATA: "Evidence is incomplete or missing.",
    },
  },
};

export interface ChoiceAnswerData {
  readonly choice: string;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

export interface NoulAnswerData {
  readonly noul: number;
}

export interface ParsedDecisionAnswers {
  readonly tradeDecision?: ChoiceAnswerData;
  readonly marketRegime?: ChoiceAnswerData;
  readonly mtfAlignment?: NoulAnswerData;
  readonly primaryWeakness?: ChoiceAnswerData;
}

export interface DecisionEvaluationResult {
  readonly ok: boolean;
  readonly model: string;
  readonly answers: ParsedDecisionAnswers;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly error?: string;
}

export interface EvaluateDecisionOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
}

function parseAnswers(rawAnswers: Record<string, unknown>): ParsedDecisionAnswers {
  const result: Record<string, unknown> = {};

  if (rawAnswers.trade_decision && typeof rawAnswers.trade_decision === "object") {
    result.tradeDecision = rawAnswers.trade_decision;
  }
  if (rawAnswers.market_regime && typeof rawAnswers.market_regime === "object") {
    result.marketRegime = rawAnswers.market_regime;
  }
  if (rawAnswers.mtf_alignment && typeof rawAnswers.mtf_alignment === "object") {
    result.mtfAlignment = rawAnswers.mtf_alignment;
  }
  if (rawAnswers.primary_weakness && typeof rawAnswers.primary_weakness === "object") {
    result.primaryWeakness = rawAnswers.primary_weakness;
  }

  return result as ParsedDecisionAnswers;
}

export async function evaluateDecision(
  client: OllamaClient,
  snapshot: MarketDecisionSnapshot,
  options?: EvaluateDecisionOptions,
): Promise<DecisionEvaluationResult> {
  const startTime = Date.now();
  const model = options?.model ?? DEFAULT_DECISION_MODEL;

  try {
    const response = await client.systemOne({
      model,
      state: snapshot as unknown as Record<string, unknown>,
      questions: DECISION_QUESTIONS,
    }, { signal: options?.signal });

    const latencyMs = Date.now() - startTime;
    const answers = parseAnswers(response.answers as Record<string, unknown>);

    return {
      ok: true,
      model,
      answers,
      latencyMs,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      model,
      answers: {},
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      error: message,
    };
  }
}
