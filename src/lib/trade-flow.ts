// Slow enough to follow by eye on a ~100 px ladder-to-candle trip.
export const IN_MS = 700;
export const BACK_MS = 450;
export const TOTAL_FLOW_MS = IN_MS + BACK_MS;
export const MAX_PARTICLES = 40;

const MIN_RADIUS_SCALE = 0.25;
const MAX_RADIUS_SCALE = 2.5;

export type FlowAggressor = "buy" | "sell";

export interface TradeInput {
  readonly key: number;
  readonly aggressor: FlowAggressor;
  readonly quantity: number;
  readonly at: number;
}

export interface TradeBatch {
  readonly key: number;
  readonly aggressor: FlowAggressor;
  readonly quantity: number;
  readonly at: number;
}

interface PendingBatch {
  readonly key: number;
  readonly aggressor: FlowAggressor;
  quantity: number;
  readonly openedAt: number;
  closed: boolean;
}

export class TradeFlowBatcher {
  private readonly batches: PendingBatch[] = [];

  constructor(private readonly windowMs: number = 150) {}

  public get pendingCount(): number {
    return this.batches.length;
  }

  public add(trade: TradeInput): void {
    if (!(trade.quantity > 0) || !Number.isFinite(trade.quantity)) return;
    const open = this.findOpen(trade);
    if (open !== undefined) {
      open.quantity += trade.quantity;
      return;
    }
    this.closeExpired(trade.key, trade.aggressor, trade.at);
    this.batches.push({
      key: trade.key,
      aggressor: trade.aggressor,
      quantity: trade.quantity,
      openedAt: trade.at,
      closed: false,
    });
  }

  public drain(now: number): TradeBatch[] {
    const ready: TradeBatch[] = [];
    let i = 0;
    while (i < this.batches.length) {
      const b = this.batches[i];
      if (b.closed || now >= b.openedAt + this.windowMs) {
        ready.push({ key: b.key, aggressor: b.aggressor, quantity: b.quantity, at: b.openedAt });
        this.batches.splice(i, 1);
      } else {
        i++;
      }
    }
    return ready;
  }

  private findOpen(trade: TradeInput): PendingBatch | undefined {
    return this.batches.find(
      (b) =>
        !b.closed &&
        b.key === trade.key &&
        b.aggressor === trade.aggressor &&
        trade.at >= b.openedAt &&
        trade.at <= b.openedAt + this.windowMs,
    );
  }

  private closeExpired(key: number, aggressor: FlowAggressor, at: number): void {
    for (const b of this.batches) {
      if (!b.closed && b.key === key && b.aggressor === aggressor && at > b.openedAt + this.windowMs) {
        b.closed = true;
      }
    }
  }
}

export interface FlowParticle {
  readonly id: number;
  readonly key: number;
  readonly aggressor: FlowAggressor;
  readonly quantity: number;
  readonly startedAt: number;
  readonly referenceQuantity?: number;
  arrived?: boolean;
}

export interface NextParticlesOptions {
  readonly now: number;
  readonly maxParticles?: number;
  readonly minQuantity?: number;
  readonly referenceQuantity?: number;
}

let particleIdCounter = 0;

export const resetParticleIdCounter = (): void => {
  particleIdCounter = 0;
};

export const nextParticles = (
  particles: readonly FlowParticle[],
  batches: readonly TradeBatch[],
  options: NextParticlesOptions,
): FlowParticle[] => {
  const { now, maxParticles = MAX_PARTICLES, minQuantity } = options;
  const alive = particles.filter((p) => now < p.startedAt + TOTAL_FLOW_MS);
  const appended: FlowParticle[] = [];
  for (const batch of batches) {
    if (minQuantity !== undefined && batch.quantity < minQuantity) continue;
    particleIdCounter = (particleIdCounter + 1) | 0;
    appended.push({
      id: particleIdCounter,
      key: batch.key,
      aggressor: batch.aggressor,
      quantity: batch.quantity,
      startedAt: now,
      ...(options.referenceQuantity !== undefined ? { referenceQuantity: options.referenceQuantity } : {}),
    });
  }
  const combined = [...alive, ...appended];
  return combined.length > maxParticles ? combined.slice(combined.length - maxParticles) : combined;
};

/** Cubic ease-out gives particles a punchy launch that decelerates into the candle. */
export const easeProgress = (t: number): number => {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
};

export interface ParticleFrame {
  readonly phase: "in" | "back" | "done";
  readonly progress: number;
  readonly radiusScale: number;
}

const calculateRadiusScale = (quantity: number, referenceQuantity?: number): number => {
  const ref = referenceQuantity !== undefined && referenceQuantity > 0 ? referenceQuantity : quantity;
  if (!(ref > 0) || !(quantity > 0)) return 1;
  const raw = Math.sqrt(quantity / ref);
  return Math.max(MIN_RADIUS_SCALE, Math.min(MAX_RADIUS_SCALE, Number.isFinite(raw) ? raw : 1));
};

export const particleFrame = (
  particle: FlowParticle,
  now: number,
  referenceQuantity?: number,
): ParticleFrame => {
  const elapsed = Math.max(0, now - particle.startedAt);
  const radiusScale = calculateRadiusScale(particle.quantity, referenceQuantity ?? particle.referenceQuantity);
  if (elapsed < IN_MS) {
    return { phase: "in", progress: easeProgress(elapsed / IN_MS), radiusScale };
  }
  if (elapsed < TOTAL_FLOW_MS) {
    return { phase: "back", progress: easeProgress((elapsed - IN_MS) / BACK_MS), radiusScale };
  }
  return { phase: "done", progress: 1, radiusScale };
};

const SCALE_SAMPLES = 200;
// Below a quarter of a typical batch is noise; size against the 90th percentile so big prints stand out.
const NOISE_FRACTION_OF_MEDIAN = 0.25;
const REFERENCE_PERCENTILE = 0.9;

const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

/**
 * Sizes particles against recent trade batches, not resting book size: a ladder row holds
 * thousands of units while single trades are tiny, so a book-based cutoff hides almost all flow.
 */
export class FlowScale {
  private readonly samples: number[] = [];

  public observe(batches: readonly TradeBatch[]): void {
    for (const batch of batches) this.samples.push(batch.quantity);
    if (this.samples.length > SCALE_SAMPLES) this.samples.splice(0, this.samples.length - SCALE_SAMPLES);
  }

  public thresholds(): { minQuantity: number; referenceQuantity: number } | undefined {
    if (this.samples.length === 0) return undefined;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      minQuantity: percentile(sorted, 0.5) * NOISE_FRACTION_OF_MEDIAN,
      referenceQuantity: percentile(sorted, REFERENCE_PERCENTILE),
    };
  }
}
