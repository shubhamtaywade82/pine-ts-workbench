import type { SmcAnalysis, SmcOptions } from "./terminal-smc";

// Major swings only: the 5-bar internal swings flood a 15m chart with labels.
export const DISPLAY_OPTIONS: SmcOptions = { swingLen: 10, requireDisplacement: true };

const MAX_LABELED_SWINGS = 6;
const MAX_BREAKS = 3;
const MAX_BLOCKS_PER_SIDE = 2;
const MAX_POOLS = 4;
// A pool far from price is not a target yet.
const POOL_MAX_DISTANCE = 0.04;
const MAX_SWEEPS = 3;
const SWEEP_RECENT_BARS = 60;

const lastN = <T>(items: T[], n: number): T[] => items.slice(Math.max(0, items.length - n));

/**
 * Reduces everything detected to what still matters now: recent structure, untouched order blocks and
 * liquidity near price, and fresh sweeps. Mitigated blocks, swept pools and stale items are dropped.
 */
export function selectValid(all: SmcAnalysis, barCount: number, lastClose?: number): SmcAnalysis {
  const activeBlocks = all.blocks.filter((b) => !b.isMitigated && b.end === undefined);
  const nearPrice = (price: number): boolean =>
    lastClose === undefined || Math.abs(price - lastClose) <= lastClose * POOL_MAX_DISTANCE;
  return {
    ...all,
    swings: lastN(all.swings.filter((s) => s.label), MAX_LABELED_SWINGS),
    breaks: lastN(all.breaks, MAX_BREAKS),
    blocks: [
      ...lastN(activeBlocks.filter((b) => b.dir === "bull"), MAX_BLOCKS_PER_SIDE),
      ...lastN(activeBlocks.filter((b) => b.dir === "bear"), MAX_BLOCKS_PER_SIDE),
    ],
    pools: lastN(all.pools.filter((p) => p.sweptAt === undefined && nearPrice(p.price)), MAX_POOLS),
    sweeps: lastN(all.sweeps.filter((s) => s.idx >= barCount - SWEEP_RECENT_BARS), MAX_SWEEPS),
  };
}
