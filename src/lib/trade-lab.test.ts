import { describe, expect, it } from "bun:test";
import type { BookRow, Quote } from "./held-options";
import { bookDays, MIN_SAMPLE, runLab, statsOf, vixBand, vixPercentileByDay } from "./trade-lab";

const MIN = 60_000;
const DAY = 86_400_000;
// 09:15 IST, Monday 2 Nov 2026.
const OPEN = Date.UTC(2026, 10, 2, 3, 45);
const q = (close: number): Quote => ({ high: close, low: close, close });

/**
 * A day where spot goes from 25000 to `close` in steps, the call and put priced off it, IV 15
 * (0 on an expiry day's last bar). The held 25000 strikes stay listed all day.
 */
const day = (index: number, close: number, isExpiry = false): BookRow[] =>
  [0, 30, 120, 360].map((minute, step) => {
    const spot = 25000 + ((close - 25000) * step) / 3;
    const decay = 1 - step * 0.05;
    const call = Math.max(1, 100 * decay + Math.max(0, spot - 25000) * 0.5);
    const put = Math.max(1, 100 * decay + Math.max(0, 25000 - spot) * 0.5);
    return {
      time: OPEN + index * DAY + minute * MIN, spot, atm: 25000, iv: isExpiry && step === 3 ? 0 : 15,
      ce: { "25000": q(call) }, pe: { "25000": q(put) },
    };
  });

const rules = { entryMinute: 30, exitMinute: 355 };

describe("runLab", () => {
  const rows = [...day(0, 25400), ...day(1, 25400), ...day(2, 24600), ...day(3, 25000, true)];
  const lab = runLab(rows, rules);

  it("buys a call and a put every day", () => {
    expect(lab.days).toBe(4);
    expect(lab.ce.trades).toHaveLength(4);
    expect(lab.pe.trades).toHaveLength(4);
  });

  it("makes calls win on up-trend days and puts on down-trend days", () => {
    const callOn = (type: string) => lab.ce.byFactor.find((f) => f.factor === "Day type")!.groups.find((g) => g.value === type)!.stats;
    const putOn = (type: string) => lab.pe.byFactor.find((f) => f.factor === "Day type")!.groups.find((g) => g.value === type)!.stats;
    expect(callOn("Trend up").avgReturn).toBeGreaterThan(0);
    expect(callOn("Trend down").avgReturn).toBeLessThan(0);
    expect(putOn("Trend down").avgReturn).toBeGreaterThan(0);
  });

  it("places days in the expiry cycle from the expiry found in the data", () => {
    const dte = lab.ce.trades.map((t) => t.conditions["Days to expiry"]);
    expect(dte).toEqual(["2+ days before", "2+ days before", "1 day before", "Expiry day"]);
  });

  it("reads the move before entry relative to the side", () => {
    const first = (side: "ce" | "pe") => lab[side].trades[0]!.conditions["Move before entry"];
    expect(first("ce")).toBe("With the trade");
    expect(first("pe")).toBe("Against the trade");
  });

  it("replays the same days for every target and stop level", () => {
    expect(lab.ce.targets.map((t) => t.level)).toEqual([undefined, 20, 30, 50, 100]);
    expect(lab.ce.targets.every((t) => t.stats.trades === 4)).toBe(true);
    // A tight 20% target caps the winners, so it cannot beat holding on these steadily rising days.
    expect(lab.ce.targets[1]!.stats.avgReturn).toBeLessThanOrEqual(lab.ce.targets[0]!.stats.avgReturn);
  });

  it("charges slippage on both sides of every trade", () => {
    const trade = lab.ce.trades[0]!;
    expect(trade.returnPct).toBeLessThan(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100);
  });

  it("only calls out conditions with enough trades behind them", () => {
    for (const h of [...lab.ce.favoured, ...lab.ce.avoided, ...lab.pe.favoured, ...lab.pe.avoided]) expect(h.stats.trades).toBeGreaterThanOrEqual(MIN_SAMPLE);
  });
});

describe("bookDays and statsOf", () => {
  it("splits by IST day", () => {
    expect(bookDays([...day(0, 25000), ...day(1, 25000)]).map((d) => d.length)).toEqual([4, 4]);
  });

  it("summarizes returns, excursions and win rate", () => {
    const t = (returnPct: number, mfePct: number, maePct: number, minutesToPeak: number) =>
      ({ returnPct, mfePct, maePct, minutesToPeak, side: "CE" as const, strike: 1, entryTime: 0, entryPrice: 1, exitTime: 0, exitPrice: 1, exitReason: "time" as const });
    expect(statsOf([t(20, 30, -5, 60), t(-10, 5, -20, 10)])).toMatchObject({ trades: 2, winRate: 50, avgReturn: 5, avgMfe: 17.5, avgMae: -12.5, avgMinutesToPeak: 35, verdict: "Too few trades", bestDayShare: 1 });
    expect(statsOf([]).trades).toBe(0);
  });
});

describe("VIX percentile at entry", () => {
  // A year of closes rising 10 → 19.9 by 0.1 a day, timed at the 09:15 IST open.
  const bars = Array.from({ length: 100 }, (_, i) => ({ time: OPEN - (100 - i) * DAY, close: 10 + i * 0.1 }));

  it("ranks the previous close against the closes before it, so nothing from the day itself leaks in", () => {
    const byDay = vixPercentileByDay([...bars, { time: OPEN, close: 5 }]);
    // The 2 Nov session sees the prior close, the highest so far: 100th percentile, not the low 5 that day closed at.
    expect(byDay.get("2026-11-02")).toBe(100);
  });

  it("skips sessions without a quarter-year of history", () => {
    expect(vixPercentileByDay(bars.slice(0, 20)).size).toBe(0);
  });

  it("bands the percentile in thirds", () => {
    expect([vixBand(10), vixBand(50), vixBand(90), vixBand(undefined)]).toEqual(["Low (below 33rd pct)", "Middle (33rd–67th pct)", "High (67th pct and up)", "Unknown"]);
  });

  it("groups lab trades by the band of their day", () => {
    const rows = [...day(0, 25400), ...day(1, 24600)];
    const lab = runLab(rows, rules, { vixPercentiles: new Map([["2026-11-02", 10], ["2026-11-03", 90]]) });
    const groups = lab.ce.byFactor.find((f) => f.factor === "VIX percentile at entry")!.groups.map((g) => g.value).sort();
    expect(groups).toEqual(["High (67th pct and up)", "Low (below 33rd pct)"]);
  });
});

describe("breakout entries", () => {
  const rows = [...day(0, 25400), ...day(1, 25400), ...day(2, 24600), ...day(3, 25000, true)];

  it("trades only the side each day's breakout signals, entering on the bar after it", () => {
    const lab = runLab(rows, { ...rules, entry: "orb" });
    expect(lab.ce.trades.map((t) => t.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(lab.pe.trades.map((t) => t.date)).toEqual(["2026-11-04"]);
    // The breakout closes at the 09:45 bar; the entry is the 11:15 bar after it.
    expect(new Date(lab.ce.trades[0]!.entryTime).toISOString()).toBe("2026-11-02T05:45:00.000Z");
  });

  it("charges costs when the lot size is known", () => {
    const bare = runLab(rows, rules).ce.summary.avgReturn;
    const charged = runLab(rows, rules, { lotSize: 65 }).ce.summary.avgReturn;
    expect(charged).toBeLessThan(bare);
  });
});
