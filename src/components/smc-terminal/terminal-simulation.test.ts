import { describe, expect, it } from "bun:test";
import {
  aggregateOrderBook, buildIntraBarPath, buildSession, computeAllFvgZones, createRng, ensureBars,
  restoreSnapshot, stepBar, syncOrderBookSnap,
} from "./terminal-simulation";
import { getFormingValues } from "./terminal-overlay-painter";
import { fmtAge, fmtP, fmtS, fmtT, hexRGB, mixHex, rgba, tickDecimals } from "./terminal-formatters";
import { BASE_BIN, SESSION_BARS, START_PLAY, type Bar } from "./terminal-types";

describe("SMC Terminal Simulation", () => {
  it("generates deterministic random values for the same seed", () => {
    const rng1 = createRng(1337);
    const rng2 = createRng(1337);
    const vals1 = [rng1(), rng1(), rng1()];
    const vals2 = [rng2(), rng2(), rng2()];
    expect(vals1).toEqual(vals2);
  });

  it("builds an initial session with correct bars and state", () => {
    const session = buildSession(0, 5);
    expect(session.bars.length).toBeGreaterThanOrEqual(SESSION_BARS - 1);
    expect(session.playhead).toBe(START_PLAY);
    expect(session.book.size).toBeGreaterThan(0);
    expect(session.snaps.length).toBe(session.bars.length);
  });

  it("steps bars and records intra-bar path and order book snapshots", () => {
    const session = buildSession(0, 5);
    const initialLen = session.bars.length;
    stepBar(session, initialLen);
    expect(session.bars.length).toBe(initialLen + 1);
    const lastBar = session.bars[session.bars.length - 1];
    expect(lastBar.path.length).toBe(12);
    expect(lastBar.path[0]).toBe(lastBar.o);
    expect(lastBar.path[11]).toBe(lastBar.c);
    expect(session.snaps[initialLen]).toBeDefined();
  });

  it("ensures target bar count is generated monotonically", () => {
    const session = buildSession(0, 5);
    ensureBars(session, 260);
    expect(session.bars.length).toBeGreaterThanOrEqual(261);
  });

  it("restores order book and bigs snapshot to a specific historical frame", () => {
    const session = buildSession(0, 5);
    restoreSnapshot(session, 100);
    const snap100 = session.snaps[100];
    expect(session.book.size).toBe(snap100.length);
  });

  it("aggregates order book correctly into custom bin sizes", () => {
    const snaps: [number, number][][] = [
      [[Math.round(74.0 / BASE_BIN), 100], [Math.round(74.05 / BASE_BIN), 200]],
    ];
    const agg01 = aggregateOrderBook(snaps, 0.1);
    expect(agg01.length).toBe(1);
    const total = [...agg01[0].values()].reduce((sum, v) => sum + v, 0);
    expect(total).toBe(300);
  });

  it("syncs order book snapshots and computes big wall levels", () => {
    const session = buildSession(0, 5);
    const book = new Map<number, number>([
      [Math.round(74.0 / BASE_BIN), 100],
      [Math.round(74.5 / BASE_BIN), 2500],
    ]);
    syncOrderBookSnap(session, book);
    const f = Math.floor(session.playhead);
    expect(session.snaps[f].length).toBe(2);
    expect(session.bigsSnap[f].length).toBeGreaterThan(0);
    expect(session.bigsSnap[f][0].size).toBe(2500);
  });

  it("computes FVG zones across confirmed bars", () => {
    const bars: Bar[] = [
      { t: 1000, o: 100, h: 101, l: 99, c: 100.5, v: 1000, buyR: 0.5, path: [100, 100.5] },
      { t: 2000, o: 101, h: 105, l: 101, c: 104, v: 2000, buyR: 0.8, path: [101, 104] },
      { t: 3000, o: 104, h: 106, l: 102.5, c: 105, v: 1500, buyR: 0.6, path: [104, 105] },
    ];
    const zones = computeAllFvgZones(bars);
    expect(zones.length).toBe(1);
    expect(zones[0].side).toBe("bull");
    expect(zones[0].lo).toBe(101);
    expect(zones[0].hi).toBe(102.5);
  });

  it("animates forming bar smoothly along intra-bar path with 0.05 step waypoints", () => {
    const session = buildSession(0, 5);
    const lastIdx = session.bars.length - 1;
    const last = session.bars[lastIdx];
    last.o = 74.0;
    last.c = 74.5;
    last.h = 74.8;
    last.l = 73.8;
    last.path = buildIntraBarPath({ o: 74.0, c: 74.5, h: 74.8, l: 73.8 });

    session.playhead = lastIdx;
    const fvStart = getFormingValues(session);
    expect(fvStart.cur).toBe(74.0);

    session.playhead = lastIdx + 1;
    const fvEnd = getFormingValues(session);
    expect(fvEnd.cur).toBe(74.5);
    expect(fvEnd.h).toBe(74.8);
    expect(fvEnd.l).toBe(73.8);

    session.playhead = lastIdx + 0.5;
    const fvMid = getFormingValues(session);
    expect(fvMid.cur).toBeGreaterThanOrEqual(73.8);
    expect(fvMid.cur).toBeLessThanOrEqual(74.8);
  });
});

describe("SMC Terminal Formatters", () => {
  it("formats prices to two decimals", () => {
    expect(fmtP(74.5)).toBe("74.50");
    expect(tickDecimals(0.01)).toBe(2);
    expect(tickDecimals(0.1)).toBe(1);
    expect(tickDecimals(0.001)).toBe(3);
    expect(tickDecimals(1)).toBe(0);
    expect(fmtP(123.456)).toBe("123.46");
  });

  it("formats volume sizes with k suffix when >= 1000", () => {
    expect(fmtS(500)).toBe("500");
    expect(fmtS(1250)).toBe("1.3k");
    expect(fmtS(12400)).toBe("12.4k");
  });

  it("formats timestamps into HH:MM", () => {
    const time = new Date(2026, 0, 1, 14, 30).getTime();
    expect(fmtT(time)).toBe("14:30");
  });

  it("formats bar age based on timeframe", () => {
    expect(fmtAge(0, 5)).toBe("<1m");
    expect(fmtAge(6, 5)).toBe("30m");
    expect(fmtAge(24, 5)).toBe("2.0h");
  });

  it("converts hex to RGB and rgba strings", () => {
    expect(hexRGB("#19E3B1")).toEqual([25, 227, 177]);
    expect(rgba("#19E3B1", 0.5)).toBe("rgba(25,227,177,0.5)");
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});
