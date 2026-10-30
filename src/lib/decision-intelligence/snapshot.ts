import type { Bar } from "@nemesis-oss/pine-ts";
import type { Technicals } from "@/lib/technicals";
import type { Wall } from "@/lib/depth-walls";

export interface SnapshotMetadata {
  readonly symbol: string;
  readonly timeframe: string;
  readonly timestamp: number;
}

export interface SnapshotMarketRegime {
  readonly trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  readonly volatility: "LOW" | "NORMAL" | "HIGH";
  readonly summaryAction: string;
  readonly summaryScore: number;
}

export interface SnapshotWall {
  readonly price: number;
  readonly notional: number;
  readonly status: string;
  readonly observedDurationMs: number;
}

export interface SnapshotOrderFlow {
  readonly bestBid?: number;
  readonly bestAsk?: number;
  readonly bidWall?: SnapshotWall;
  readonly askWall?: SnapshotWall;
  readonly coverageValid: boolean;
  readonly feedStatus: "LIVE" | "SYNCING" | "STALE" | "DISCONNECTED";
}

export interface CandidateSetup {
  readonly side: "LONG" | "SHORT";
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly riskReward: number;
}

export interface SnapshotDataQuality {
  readonly allBarsClosed: boolean;
  readonly feedHealthy: boolean;
  readonly missingFields: readonly string[];
}

export interface MarketDecisionSnapshot {
  readonly metadata: SnapshotMetadata;
  readonly marketRegime: SnapshotMarketRegime;
  readonly orderFlow: SnapshotOrderFlow;
  readonly candidate?: CandidateSetup;
  readonly dataQuality: SnapshotDataQuality;
}

export interface BuildSnapshotOptions {
  readonly symbol: string;
  readonly timeframe: string;
  readonly bars: readonly Bar[];
  readonly technicals?: Technicals;
  readonly bidWall?: Wall;
  readonly askWall?: Wall;
  readonly bestBid?: number;
  readonly bestAsk?: number;
  readonly bookCoverageValid?: boolean;
  readonly feedStatus?: "LIVE" | "SYNCING" | "STALE" | "DISCONNECTED";
  readonly candidate?: CandidateSetup;
}

function summarizeWall(wall?: Wall, now = Date.now()): SnapshotWall | undefined {
  if (!wall) return undefined;
  return {
    price: wall.price,
    notional: wall.notional,
    status: wall.status ?? "holding",
    observedDurationMs: Math.max(0, now - wall.observedSince),
  };
}

function calculateTrend(bars: readonly Bar[]): "BULLISH" | "BEARISH" | "SIDEWAYS" {
  if (bars.length < 5) return "SIDEWAYS";
  const recent = bars.slice(-5);
  const first = recent[0]!.close;
  const last = recent[recent.length - 1]!.close;
  const changePct = ((last - first) / first) * 100;
  if (changePct > 0.3) return "BULLISH";
  if (changePct < -0.3) return "BEARISH";
  return "SIDEWAYS";
}

function calculateVolatility(bars: readonly Bar[]): "LOW" | "NORMAL" | "HIGH" {
  if (bars.length < 5) return "NORMAL";
  const recent = bars.slice(-5);
  const avgRangePct = recent.reduce((sum, b) => sum + ((b.high - b.low) / b.close) * 100, 0) / recent.length;
  if (avgRangePct < 0.2) return "LOW";
  if (avgRangePct > 1.2) return "HIGH";
  return "NORMAL";
}

function collectMissingFields(options: BuildSnapshotOptions): string[] {
  const missing: string[] = [];
  if (!options.technicals) missing.push("technicals");
  if (!options.bidWall && !options.askWall) missing.push("orderBookWalls");
  if (options.bestBid === undefined || options.bestAsk === undefined) missing.push("bidAskSpread");
  return missing;
}

export function buildMarketSnapshot(options: BuildSnapshotOptions): MarketDecisionSnapshot {
  const lastBar = options.bars.at(-1);
  const missing = collectMissingFields(options);
  const now = lastBar?.time ? lastBar.time * 1000 : Date.now();

  return {
    metadata: {
      symbol: options.symbol,
      timeframe: options.timeframe,
      timestamp: lastBar?.time ?? Math.floor(Date.now() / 1000),
    },
    marketRegime: {
      trend: calculateTrend(options.bars),
      volatility: calculateVolatility(options.bars),
      summaryAction: options.technicals ? (options.technicals.summaryScore > 0.1 ? "BUY" : options.technicals.summaryScore < -0.1 ? "SELL" : "NEUTRAL") : "UNAVAILABLE",
      summaryScore: options.technicals?.summaryScore ?? 0,
    },
    orderFlow: {
      bestBid: options.bestBid,
      bestAsk: options.bestAsk,
      bidWall: summarizeWall(options.bidWall, now),
      askWall: summarizeWall(options.askWall, now),
      coverageValid: options.bookCoverageValid ?? true,
      feedStatus: options.feedStatus ?? "LIVE",
    },
    candidate: options.candidate,
    dataQuality: {
      allBarsClosed: lastBar?.isClosed !== false,
      feedHealthy: (options.feedStatus ?? "LIVE") === "LIVE",
      missingFields: missing,
    },
  };
}
