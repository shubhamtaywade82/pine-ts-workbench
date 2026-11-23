import type { OllamaClient } from "@nemesis-oss/ollama-sdk";
import {
  type MarketDecisionSnapshot,
  toMicroState,
  hashSnapshot,
} from "./snapshot";

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
  readonly cached?: boolean;
}

export interface EvaluateDecisionOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly skipCache?: boolean;
  readonly useMicroState?: boolean;
  readonly ttlMs?: number;
}

interface CacheEntry {
  readonly result: DecisionEvaluationResult;
  readonly expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 15_000;
const decisionCache = new Map<string, CacheEntry>();

export function clearDecisionCache(): void {
  decisionCache.clear();
}

function getCachedResult(key: string, now: number): DecisionEvaluationResult | undefined {
  const entry = decisionCache.get(key);
  if (entry && entry.expiresAt > now) {
    return { ...entry.result, cached: true, latencyMs: 0 };
  }
  return undefined;
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

async function querySystemOne(
  client: OllamaClient,
  snapshot: MarketDecisionSnapshot,
  model: string,
  options?: EvaluateDecisionOptions,
) {
  // Reduces input tokens by swapping nested JSON with dense micro-state when requested
  const state = options?.useMicroState
    ? { microState: toMicroState(snapshot) }
    : (snapshot as unknown as Record<string, unknown>);

  return client.systemOne(
    { model, state, questions: DECISION_QUESTIONS },
    { signal: options?.signal },
  );
}

export async function evaluateDecision(
  client: OllamaClient,
  snapshot: MarketDecisionSnapshot,
  options?: EvaluateDecisionOptions,
): Promise<DecisionEvaluationResult> {
  const startTime = Date.now();
  const model = options?.model ?? DEFAULT_DECISION_MODEL;
  const cacheKey = `${model}:${hashSnapshot(snapshot)}`;

  if (!options?.skipCache) {
    const cached = getCachedResult(cacheKey, startTime);
    if (cached) return cached;
  }

  try {
    const response = await querySystemOne(client, snapshot, model, options);
    const answers = parseAnswers(response.answers as Record<string, unknown>);
    const result: DecisionEvaluationResult = {
      ok: true,
      model,
      answers,
      latencyMs: Date.now() - startTime,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cached: false,
    };

    if (!options?.skipCache) {
      decisionCache.set(cacheKey, {
        result,
        expiresAt: startTime + (options?.ttlMs ?? DEFAULT_CACHE_TTL_MS),
      });
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      model,
      answers: {},
      latencyMs: Date.now() - startTime,
      inputTokens: 0,
      outputTokens: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
