import { describe, expect, test } from "bun:test";
import type { OllamaClient } from "@nemesis-oss/ollama-sdk";
import type { Bar } from "@nemesis-oss/pine-ts";
import {
  buildMarketSnapshot,
  toMicroState,
  hashSnapshot,
} from "@/lib/decision-intelligence/snapshot";
import {
  evaluateDecision,
  clearDecisionCache,
  DECISION_QUESTIONS,
  isOffPeak,
  selectOptimalDecisionModel,
  CLOUD_PRICING_MODELS,
} from "@/lib/decision-intelligence/tev1";
import { GET, POST } from "./route";

const SAMPLE_BARS: readonly Bar[] = [
  { time: 1000, open: 100, high: 102, low: 99, close: 101, volume: 50 },
  { time: 1060, open: 101, high: 103, low: 100, close: 102, volume: 60 },
  { time: 1120, open: 102, high: 104, low: 101, close: 103, volume: 70 },
  { time: 1180, open: 103, high: 105, low: 102, close: 104, volume: 80 },
  { time: 1240, open: 104, high: 106, low: 103, close: 105, volume: 90 },
];

describe("decision-intelligence snapshot builder & micro-state encoder", () => {
  test("builds market snapshot and identifies missing fields", () => {
    const snapshot = buildMarketSnapshot({
      symbol: "SOLUSDT",
      timeframe: "5m",
      bars: SAMPLE_BARS,
    });

    expect(snapshot.metadata.symbol).toBe("SOLUSDT");
    expect(snapshot.metadata.timeframe).toBe("5m");
    expect(snapshot.marketRegime.trend).toBe("BULLISH");
    expect(snapshot.dataQuality.missingFields).toContain("technicals");
    expect(snapshot.dataQuality.missingFields).toContain("orderBookWalls");
  });

  test("includes order book walls and candidate setup when provided", () => {
    const snapshot = buildMarketSnapshot({
      symbol: "BTCUSDT",
      timeframe: "1m",
      bars: SAMPLE_BARS,
      bidWall: { side: "bid", price: 100, quantity: 10, notional: 1000, observedSince: Date.now() - 5000 },
      askWall: { side: "ask", price: 110, quantity: 5, notional: 550, observedSince: Date.now() - 3000 },
      candidate: { side: "LONG", entry: 105, stopLoss: 103, takeProfit: 109, riskReward: 2.0 },
    });

    expect(snapshot.orderFlow.bidWall?.price).toBe(100);
    expect(snapshot.orderFlow.askWall?.price).toBe(110);
    expect(snapshot.candidate?.side).toBe("LONG");
    expect(snapshot.candidate?.riskReward).toBe(2.0);
  });

  test("toMicroState generates compact delimited state and saves tokens", () => {
    const snapshot = buildMarketSnapshot({
      symbol: "BTCUSDT",
      timeframe: "15m",
      bars: SAMPLE_BARS,
      bidWall: { side: "bid", price: 91000, quantity: 15, notional: 1_365_000, observedSince: Date.now() - 120_000 },
      bestBid: 91050,
      bestAsk: 91055,
      candidate: { side: "LONG", entry: 91055, stopLoss: 90700, takeProfit: 91765, riskReward: 2.0 },
    });

    const micro = toMicroState(snapshot);
    expect(micro).toContain("SYM:BTCUSDT|TF:15m");
    expect(micro).toContain("RG:BULLISH,HIGH");
    expect(micro).toContain("OF:91050/91055");
    expect(micro).toContain("BW:91000(1.4M,0m)");
    expect(micro).toContain("SET:LONG@91055,SL:90700,TP:91765,RR:2.0");
    // Under 200 characters (~40 tokens)
    expect(micro.length).toBeLessThan(200);
  });

  test("hashSnapshot returns deterministic identity hash", () => {
    const snapshot = buildMarketSnapshot({
      symbol: "ETHUSDT",
      timeframe: "1h",
      bars: SAMPLE_BARS,
    });
    const hash1 = hashSnapshot(snapshot);
    const hash2 = hashSnapshot(snapshot);
    expect(hash1).toBe(hash2);
    expect(hash1).toContain("ETHUSDT:1h");
  });
});

describe("tev1 decision evaluator with mock client & cache", () => {
  test("evaluates snapshot and parses typed answers", async () => {
    clearDecisionCache();
    const mockClient = {
      systemOne: async () => ({
        model: "tev1:4b",
        answers: {
          trade_decision: {
            type: "choice",
            choice: "APPROVE",
            probabilities: { APPROVE: 0.85, WAIT: 0.1, REJECT: 0.05 },
            confidence: 0.85,
          },
          market_regime: {
            type: "choice",
            choice: "STRONG_UPTREND",
            probabilities: { STRONG_UPTREND: 0.9, RANGE_BOUND: 0.1 },
            confidence: 0.9,
          },
          mtf_alignment: {
            type: "noul",
            noul: 0.88,
          },
          primary_weakness: {
            type: "choice",
            choice: "NONE",
            probabilities: { NONE: 0.95 },
            confidence: 0.95,
          },
        },
        usage: { input_tokens: 150, output_tokens: 4 },
      }),
    } as unknown as OllamaClient;

    const snapshot = buildMarketSnapshot({
      symbol: "SOLUSDT",
      timeframe: "5m",
      bars: SAMPLE_BARS,
    });

    const result = await evaluateDecision(mockClient, snapshot);
    expect(result.ok).toBe(true);
    expect(result.answers.tradeDecision?.choice).toBe("APPROVE");
    expect(result.answers.marketRegime?.choice).toBe("STRONG_UPTREND");
    expect(result.answers.mtfAlignment?.noul).toBe(0.88);
    expect(result.answers.primaryWeakness?.choice).toBe("NONE");
    expect(result.inputTokens).toBe(150);
    expect(result.cached).toBe(false);

    // Second evaluation should hit cache with 0 latency
    const cachedResult = await evaluateDecision(mockClient, snapshot);
    expect(cachedResult.cached).toBe(true);
    expect(cachedResult.latencyMs).toBe(0);
  });

  test("useMicroState passes compressed state payload to client", async () => {
    clearDecisionCache();
    let capturedState: unknown;
    const mockClient = {
      systemOne: async (req: { state: unknown }) => {
        capturedState = req.state;
        return {
          model: "tev1:4b",
          answers: {
            trade_decision: { type: "choice", choice: "WAIT", probabilities: { WAIT: 0.8 }, confidence: 0.8 },
          },
          usage: { input_tokens: 35, output_tokens: 2 },
        };
      },
    } as unknown as OllamaClient;

    const snapshot = buildMarketSnapshot({
      symbol: "AVAXUSDT",
      timeframe: "5m",
      bars: SAMPLE_BARS,
    });

    const result = await evaluateDecision(mockClient, snapshot, { useMicroState: true, skipCache: true });
    expect(result.ok).toBe(true);
    expect(capturedState).toHaveProperty("microState");
    expect((capturedState as { microState: string }).microState).toContain("SYM:AVAXUSDT");
  });

  test("handles client error gracefully without throwing", async () => {
    clearDecisionCache();
    const mockClient = {
      systemOne: async () => {
        throw new Error("Connection timed out to Ollama");
      },
    } as unknown as OllamaClient;

    const snapshot = buildMarketSnapshot({
      symbol: "SOLUSDT",
      timeframe: "5m",
      bars: SAMPLE_BARS,
    });

    const result = await evaluateDecision(mockClient, snapshot, { skipCache: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Connection timed out");
  });
});

describe("decisions api route", () => {
  test("isOffPeak accurately distinguishes peak from off-peak windows", () => {
    // Weekend: Saturday 14:00 UTC -> off-peak
    const saturday = new Date("2026-11-28T14:00:00Z");
    expect(isOffPeak(saturday)).toBe(true);

    // Weekday peak: Wednesday 14:00 UTC (between 12:00 and 18:00 UTC) -> peak (not off-peak)
    const weekdayPeak = new Date("2026-11-25T14:00:00Z");
    expect(isOffPeak(weekdayPeak)).toBe(false);

    // Weekday off-peak: Wednesday 08:00 UTC -> off-peak
    const weekdayMorning = new Date("2026-11-25T08:00:00Z");
    expect(isOffPeak(weekdayMorning)).toBe(true);

    // Weekday off-peak: Wednesday 20:00 UTC -> off-peak
    const weekdayNight = new Date("2026-11-25T20:00:00Z");
    expect(isOffPeak(weekdayNight)).toBe(true);
  });

  test("selectOptimalDecisionModel routes to discounted deepseek during off-peak", () => {
    const saturday = new Date("2026-11-28T14:00:00Z");
    const model = selectOptimalDecisionModel("reasoning", saturday);
    expect(model).toBe("deepseek-v4.1-flash:cloud");
  });

  test("GET returns decision models array, defaultModel, and off-peak status", () => {
    const res = GET();
    return res.then(async (r) => {
      expect(r.status).toBe(200);
      const data = (await r.json()) as {
        ok: boolean;
        models: string[];
        defaultModel: string;
        isOffPeak: boolean;
        pricingTiers: unknown[];
      };
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.defaultModel).toBeDefined();
      expect(typeof data.isOffPeak).toBe("boolean");
      expect(Array.isArray(data.pricingTiers)).toBe(true);
    });
  });

  test("POST returns 400 for invalid snapshot", async () => {
    const req = new Request("http://localhost:3417/api/ai/decisions", {
      method: "POST",
      body: JSON.stringify({ snapshot: { invalid: true } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
  });
});
