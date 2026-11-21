/**
 * Tracks temporal persistence of resting liquidity to differentiate committed
 * institutional limit orders from manipulative short-lived spoofing.
 */

export interface LevelPersistence {
  readonly price: number;
  readonly persistenceScore: number;
  readonly durationMs: number;
  readonly peakNotional: number;
  readonly currentNotional: number;
  readonly isCommitted: boolean;
  readonly isSpoofCandidate: boolean;
}

export interface PersistenceOptions {
  readonly windowMs?: number;
  readonly committedThreshold?: number;
  readonly spoofThreshold?: number;
  readonly minNotional?: number;
}

interface TrackedLevel {
  firstSeenAt: number;
  lastSeenAt: number;
  totalPresentMs: number;
  peakNotional: number;
  currentNotional: number;
  isSpoof: boolean;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_COMMITTED_THRESHOLD = 0.75;
const DEFAULT_SPOOF_THRESHOLD = 0.25;

/**
 * Calculates raw persistence score normalized to [0.0, 1.0].
 */
export function calculatePersistenceScore(presentDurationMs: number, windowMs: number): number {
  if (windowMs <= 0 || presentDurationMs <= 0) return 0;
  return Math.min(1.0, presentDurationMs / windowMs);
}

/**
 * Computes rate of quantity change per second.
 */
export function calculateVelocity(quantity: number, durationSeconds: number): number {
  if (durationSeconds <= 0 || quantity <= 0) return 0;
  return quantity / durationSeconds;
}

/**
 * Determines whether a level withdrawal matches the spoofing signature:
 * low persistence, high percentage pulled, and within close proximity to active price.
 */
export function isSpoofing(
  persistenceScore: number,
  pulledRatio: number,
  distanceInTicks: number
): boolean {
  return persistenceScore < DEFAULT_SPOOF_THRESHOLD && pulledRatio >= 0.8 && distanceInTicks <= 3;
}

export class PersistenceTracker {
  private readonly windowMs: number;
  private readonly committedThreshold: number;
  private readonly spoofThreshold: number;
  private readonly levels = new Map<number, TrackedLevel>();

  public constructor(options: PersistenceOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.committedThreshold = options.committedThreshold ?? DEFAULT_COMMITTED_THRESHOLD;
    this.spoofThreshold = options.spoofThreshold ?? DEFAULT_SPOOF_THRESHOLD;
  }

  /**
   * Records presence of a liquidity level at timestamp `at`.
   */
  public record(price: number, notional: number, at: number): void {
    if (notional <= 0) {
      this.clearLevel(price);
      return;
    }

    const existing = this.levels.get(price);
    if (!existing) {
      this.levels.set(price, {
        firstSeenAt: at,
        lastSeenAt: at,
        totalPresentMs: 0,
        peakNotional: notional,
        currentNotional: notional,
        isSpoof: false,
      });
      return;
    }

    const elapsed = Math.max(0, at - existing.lastSeenAt);
    // Ignore gaps longer than window to prevent stale accumulation.
    if (elapsed <= this.windowMs) {
      existing.totalPresentMs += elapsed;
    }
    existing.lastSeenAt = at;
    existing.currentNotional = notional;
    if (notional > existing.peakNotional) {
      existing.peakNotional = notional;
    }
  }

  /**
   * Checks for spoof withdrawal when quantity is removed.
   */
  public recordRemoval(
    price: number,
    pulledNotional: number,
    at: number,
    lastPrice: number,
    tickSize: number
  ): void {
    const existing = this.levels.get(price);
    if (!existing) return;

    const score = this.scoreFor(existing, at);
    const pulledRatio = existing.peakNotional > 0 ? pulledNotional / existing.peakNotional : 0;
    const distanceTicks = tickSize > 0 ? Math.abs(price - lastPrice) / tickSize : 999;

    if (isSpoofing(score, pulledRatio, distanceTicks)) {
      existing.isSpoof = true;
    }
    existing.currentNotional = 0;
  }

  public get(price: number, at: number): LevelPersistence | undefined {
    const entry = this.levels.get(price);
    if (!entry) return undefined;
    return this.buildPersistence(price, entry, at);
  }

  public getAll(at: number): readonly LevelPersistence[] {
    const result: LevelPersistence[] = [];
    for (const [price, entry] of this.levels) {
      result.push(this.buildPersistence(price, entry, at));
    }
    return result;
  }

  public prune(now: number): void {
    for (const [price, entry] of this.levels) {
      if (now - entry.lastSeenAt > this.windowMs) {
        this.levels.delete(price);
      }
    }
  }

  private clearLevel(price: number): void {
    const entry = this.levels.get(price);
    if (entry) entry.currentNotional = 0;
  }

  private scoreFor(entry: TrackedLevel, at: number): number {
    const activeElapsed = entry.currentNotional > 0 ? Math.max(0, at - entry.lastSeenAt) : 0;
    const totalMs = entry.totalPresentMs + activeElapsed;
    return calculatePersistenceScore(totalMs, this.windowMs);
  }

  private buildPersistence(price: number, entry: TrackedLevel, at: number): LevelPersistence {
    const score = this.scoreFor(entry, at);
    const durationMs = at - entry.firstSeenAt;

    return {
      price,
      persistenceScore: score,
      durationMs,
      peakNotional: entry.peakNotional,
      currentNotional: entry.currentNotional,
      isCommitted: score >= this.committedThreshold,
      isSpoofCandidate: entry.isSpoof,
    };
  }
}
