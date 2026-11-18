import { describe, expect, it } from "bun:test";
import { analyzeStructure, type LiquidityPool, type OrderBlock, type SmcAnalysis, type StructureBreak, type Sweep } from "./terminal-smc";
import { selectValid } from "./terminal-smc-valid";
import type { Bar } from "./terminal-types";

const bar = (o: number, h: number, l: number, c: number): Bar => ({ t: 0, o, h, l, c, v: 1, buyR: 0.5, path: [o, c] });

/** Flat bars at `price`, so only explicitly shaped bars create pivots. */
const flat = (price: number, count: number): Bar[] => Array.from({ length: count }, () => bar(price, price + 0.1, price - 0.1, price));

describe("analyzeStructure", () => {
  it("finds a confirmed swing high and labels a higher high", () => {
    const bars = [
      ...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 6),
      bar(10, 18, 10, 12), ...flat(10, 6),
    ];
    const highs = analyzeStructure(bars).swings.filter((s) => s.kind === "high");
    expect(highs.map((s) => s.price)).toEqual([15, 18]);
    expect(highs[1].label).toBe("HH");
  });

  it("does not confirm a pivot until SWING_LEN bars have followed", () => {
    const bars = [...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 4)];
    expect(analyzeStructure(bars).swings.filter((s) => s.kind === "high")).toHaveLength(0);
  });

  it("marks BOS on a close above the last swing high in an uptrend, CHoCH after a downtrend", () => {
    const up = [...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 6), bar(12, 17, 12, 16.5)];
    expect(analyzeStructure(up).breaks.map((b) => [b.kind, b.dir])).toEqual([["BOS", "bull"]]);

    const reversal = [
      ...flat(10, 6), bar(10, 15, 10, 12), bar(10, 10.1, 7, 9), ...flat(10, 6), bar(10, 10.1, 5, 6),
      ...flat(6, 2), bar(6, 16, 6, 15.5),
    ];
    const kinds = analyzeStructure(reversal).breaks.map((b) => `${b.kind}:${b.dir}`);
    expect(kinds).toEqual(["BOS:bear", "CHoCH:bull"]);
  });
});

describe("findOrderBlocks", () => {
  // idx 6 pivot high 15; idx 7 bearish candle (origin); idx 8..: flat; idx 13: break close 16.
  const base = (): Bar[] => [
    ...flat(10, 6), bar(10, 15, 10, 12), bar(12, 12.5, 9.5, 10), ...flat(10, 5), bar(10, 17, 10, 16),
  ];

  it("takes the last bearish candle before a bullish break as a bull block", () => {
    const smc = analyzeStructure(base());
    expect(smc.blocks).toHaveLength(1);
    expect(smc.blocks[0]).toMatchObject({ dir: "bull", lo: 9.5, hi: 12.5, start: 7, isMitigated: false });
  });

  it("marks the block mitigated once price closes below it", () => {
    const smc = analyzeStructure([...base(), bar(16, 16, 8, 9)]);
    expect(smc.blocks[0]).toMatchObject({ isMitigated: true, end: 14 });
  });
});

describe("liquidity", () => {
  // Two near-equal swing highs (idx 6 = 15, idx 13 = 15.005); flat in between.
  const equalHighs = (): Bar[] => [
    ...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 6), bar(10, 15.005, 10, 12), ...flat(10, 6),
  ];

  it("pairs near-equal swing highs into an EQH pool at the outer level", () => {
    const pool = analyzeStructure(equalHighs()).pools[0];
    expect(pool).toMatchObject({ kind: "EQH", price: 15.005, fromIdx: 6, toIdx: 13 });
    expect(pool.sweptAt).toBeUndefined();
  });

  it("records the first wick through the pool", () => {
    const pool = analyzeStructure([...equalHighs(), bar(10, 15.5, 10, 12)]).pools[0];
    expect(pool.sweptAt).toBe(20);
  });

  it("calls a wick through a swing high that closes back below a bearish sweep", () => {
    const bars = [...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 6), bar(12, 16, 11, 12)];
    expect(analyzeStructure(bars).sweeps).toEqual([{ dir: "bear", level: 15, fromIdx: 6, idx: 13 }]);
  });

  it("does not call a close above the swing a sweep", () => {
    const bars = [...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 6), bar(12, 16, 11, 15.8)];
    expect(analyzeStructure(bars).sweeps).toEqual([]);
  });
});

describe("dealing range and daily levels", () => {
  it("uses the latest swing high and low as the dealing range with equilibrium in the middle", () => {
    const bars = [...flat(10, 6), bar(10, 15, 10, 12), bar(10, 10.1, 6, 9), ...flat(10, 6)];
    const range = analyzeStructure(bars).range;
    expect(range).toMatchObject({ hi: 15, lo: 6, mid: 10.5 });
  });

  it("takes the previous UTC day's high and low, starting at the current day's first bar", () => {
    const day = 86_400_000;
    const at = (t: number, h: number, l: number): Bar => ({ ...bar(10, h, l, 10), t });
    const bars = [at(0, 12, 9), at(1000, 14, 8), at(day, 11, 10), at(day + 1000, 11, 10)];
    expect(analyzeStructure(bars).daily).toEqual({ pdh: 14, pdl: 8, fromIdx: 2 });
  });

  it("has no daily levels when history covers a single day", () => {
    expect(analyzeStructure(flat(10, 4)).daily).toBeUndefined();
  });
});

describe("selectValid", () => {
  const smc = (over: Partial<SmcAnalysis>): SmcAnalysis => ({ swings: [], breaks: [], blocks: [], pools: [], sweeps: [], ...over });

  it("drops mitigated and expired order blocks and keeps the 2 latest active per side", () => {
    const block = (start: number, over: Partial<OrderBlock> = {}): OrderBlock =>
      ({ dir: "bull", lo: 1, hi: 2, start, isMitigated: false, ...over });
    const result = selectValid(smc({ blocks: [block(1), block(2), block(3), block(4, { isMitigated: true, end: 9 }), block(5, { end: 99 })] }), 100);
    expect(result.blocks.map((b) => b.start)).toEqual([2, 3]);
  });

  it("keeps only unswept pools near price", () => {
    const pool = (price: number, sweptAt?: number): LiquidityPool => ({ kind: "EQH", price, fromIdx: 1, toIdx: 2, sweptAt });
    const result = selectValid(smc({ pools: [pool(100), pool(101, 5), pool(150)] }), 100, 100);
    expect(result.pools.map((p) => p.price)).toEqual([100]);
  });

  it("keeps only recent sweeps and the latest few structure breaks", () => {
    const sweep = (idx: number): Sweep => ({ dir: "bear", level: 1, fromIdx: 0, idx });
    const brk = (idx: number): StructureBreak => ({ kind: "BOS", dir: "bull", level: 1, fromIdx: 0, idx });
    const result = selectValid(smc({ sweeps: [sweep(10), sweep(90)], breaks: [brk(1), brk(2), brk(3), brk(4)] }), 100);
    expect(result.sweeps.map((s) => s.idx)).toEqual([90]);
    expect(result.breaks.map((b) => b.idx)).toEqual([2, 3, 4]);
  });
});

describe("displacement", () => {
  it("ignores a break that is only a drift over the level and counts the first real impulse", () => {
    const base = [...flat(10, 6), bar(10, 15, 10, 12), ...flat(10, 6)];
    const drift = [...base, bar(14.9, 15.2, 14.9, 15.1)];
    const options = { swingLen: 5, requireDisplacement: true };
    expect(analyzeStructure(drift, options).breaks).toHaveLength(0);
    expect(analyzeStructure([...drift, bar(15.1, 20, 15.1, 19.8)], options).breaks).toHaveLength(1);
  });
});
