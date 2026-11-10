export const CLASSIFIER_VERSION = "1";

export type LiquidityOutcome =
  | "TURNED"
  | "BROKE"
  | "PULLED_BEFORE_TOUCH"
  | "NO_REACTION"
  | "UNRESOLVED"
  | "CONSUMED";

export interface OutcomeWall {
  readonly id: string;
  readonly side: "bid" | "ask";
  readonly price: number;
  readonly detectedAt: number;
  readonly removedAt?: number;
  readonly removedQuantity?: number;
}

export interface PricePoint {
  readonly at: number;
  readonly price: number;
}

export interface OutcomeTrade {
  readonly at: number;
  readonly price: number;
  readonly quantity: number;
}

export interface DataGap {
  readonly from: number;
  readonly to: number;
}

export interface OutcomeOptions {
  readonly proximityPct: number;
  readonly reversalPct: number;
  readonly breakoutPct: number;
  readonly evaluationWindowMs: number;
  readonly consumedPct: number;
  readonly priceTolerance: number;
}

export interface LiquidityInteraction {
  readonly wallId: string;
  readonly side: OutcomeWall["side"];
  readonly levelPrice: number;
  readonly detectedAt: number;
  readonly startAt: number;
  readonly resolvedAt: number | null;
  readonly outcome: LiquidityOutcome;
  readonly maxFavorableExcursionPct: number;
  readonly maxAdverseExcursionPct: number;
  readonly classifierVersion: string;
}

export interface OutcomeContext {
  readonly gaps: readonly DataGap[];
  readonly options: OutcomeOptions;
  readonly now: number;
}

export const classifyInteractions = (
  _wall: OutcomeWall,
  _path: readonly PricePoint[],
  _trades: readonly OutcomeTrade[],
  _context: OutcomeContext,
): LiquidityInteraction[] => [];

export const wilsonInterval = (_successes: number, _total: number): { low: number; high: number } | null => null;

export interface OutcomeStatsFilter {
  readonly classifierVersion?: string;
}

export interface OutcomeStats {
  readonly counts: Record<LiquidityOutcome, number>;
  readonly n: number;
  readonly turnedPct: number | null;
  readonly brokePct: number | null;
  readonly turnedCi: { low: number; high: number } | null;
  readonly brokeCi: { low: number; high: number } | null;
  readonly from: number | null;
  readonly to: number | null;
  readonly avgFavorableExcursionPct: number | null;
  readonly avgAdverseExcursionPct: number | null;
  readonly medianResolutionMs: number | null;
  readonly classifierVersions: readonly string[];
  readonly classifierVersion: string;
}

export const outcomeStats = (
  _interactions: readonly LiquidityInteraction[],
  _filter: OutcomeStatsFilter = {},
): OutcomeStats => ({
  counts: {
    TURNED: 0,
    BROKE: 0,
    PULLED_BEFORE_TOUCH: 0,
    NO_REACTION: 0,
    UNRESOLVED: 0,
    CONSUMED: 0,
  },
  n: 0,
  turnedPct: null,
  brokePct: null,
  turnedCi: null,
  brokeCi: null,
  from: null,
  to: null,
  avgFavorableExcursionPct: null,
  avgAdverseExcursionPct: null,
  medianResolutionMs: null,
  classifierVersions: [],
  classifierVersion: CLASSIFIER_VERSION,
});
