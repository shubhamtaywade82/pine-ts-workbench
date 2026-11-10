const finite = (values: readonly number[]): number[] =>
  values.filter((value) => Number.isFinite(value));

const medianOf = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** Rolling median of bucket notionals. Old samples fall off so memory stays at `maxSamples`. */
export class LiquidityBaseline {
  private readonly samples: number[][] = [];
  private cachedMedian: number | null = null;

  public constructor(
    private readonly maxSamples: number,
    private readonly minSamples: number,
  ) {}

  public add(sampleNotionals: readonly number[]): void {
    this.samples.push(finite(sampleNotionals));
    const cap = Math.max(0, this.maxSamples);
    while (this.samples.length > cap) this.samples.shift();
    this.cachedMedian = medianOf(this.samples.flat());
  }

  public relativeStrength(notional: number): number | null {
    if (this.samples.length < this.minSamples) return null;
    if (!Number.isFinite(notional)) return null;
    const median = this.cachedMedian;
    if (median === null || !(median > 0)) return null;
    return notional / median;
  }
}
