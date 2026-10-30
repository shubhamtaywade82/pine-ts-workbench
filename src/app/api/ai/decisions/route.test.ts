import { describe, expect, test } from "bun:test";
import type { OllamaClient } from "@nemesis-oss/ollama-sdk";
import type { Bar } from "@nemesis-oss/pine-ts";
import { buildMarketSnapshot } from "@/lib/decision-intelligence/snapshot";
import { evaluateDecision, DECISION_QUESTIONS } from "@/lib/decision-intelligence/tev1";
import { GET, POST } from "./route";

const SAMPLE_BARS: readonly Bar[] = [
  { time: 1000, open: 100, high: 102, low: 99, close: 101, volume: 50 },
  { time: 1060, open: 101, high: 103, low: 100, close: 102, volume: 60 },
  { time: 1120, open: 102, high: 104, low: 101, close: 103, volume: 70 },
  { time: 1180, open: 103, high: 105, low: 102, close: 104, volume: 80 },
  { time: 1240, open: 104, high: 106, low: 103, close: 105, volume: 90 },
];

describe("decision-intelligence snapshot builder", () => {
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
});

describe("tev1 decision evaluator with mock client", () => {
  test("evaluates snapshot and parses typed answers", async () => {
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
  });

  test("handles client error gracefully without throwing", async () => {
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

    const result = await evaluateDecision(mockClient, snapshot);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Connection timed out");
  });
});

describe("decisions api route", () => {
  test("GET returns decision models array and defaultModel", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; models: string[]; defaultModel: string };
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.defaultModel).toBeDefined();
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
