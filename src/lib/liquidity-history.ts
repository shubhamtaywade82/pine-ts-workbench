import type { PriceBucket } from "./price-buckets";

export interface LiquiditySample {
  readonly at: number;
  readonly bids: readonly PriceBucket[];
  readonly asks: readonly PriceBucket[];
}

const SAMPLE_GAP_MS = 1_000;

/** One column per second. Depth arrives faster than the heatmap can show. */
export class LiquidityHistory {
  private readonly buffer: LiquiditySample[] = [];

  public constructor(private readonly capacity = 600) {}

  public push(sample: LiquiditySample): void {
    const last = this.buffer.at(-1);
    if (last !== undefined && sample.at - last.at < SAMPLE_GAP_MS) return;
    this.buffer.push(sample);
    const cap = Math.max(0, this.capacity);
    while (this.buffer.length > cap) this.buffer.shift();
  }

  public samples(): readonly LiquiditySample[] {
    return this.buffer;
  }

  public clear(): void {
    this.buffer.length = 0;
  }
}
