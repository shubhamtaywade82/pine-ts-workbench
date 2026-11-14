import type { ChainLeg, ChainRow, ChainSummary } from "./option-chain";

/**
 * What an options desk reads off a chain, worked out from every strike. These are indicators of positioning,
 * not predictions: open interest shows where contracts are held, not who is long or short.
 */

const MS_PER_DAY = 86_400_000;
// Options expire at 15:30 IST, which is 10:00 UTC.
const EXPIRY_UTC_HOUR = 10;
const LEVELS_SHOWN = 3;
const FLOWS_SHOWN = 5;
/** Strikes this far out (as a share of spot) are compared to read the IV skew. */
const SKEW_DISTANCE = 0.03;
/** An IV-based move is never worked out for less than this many days: the last hours are not a straight line. */
const MIN_DAYS_FOR_MOVE = 0.25;
/** One side's fresh OI must be this many times the other's to count as the direction of new positioning. */
const FRESH_LEAN_RATIO = 1.2;
/** A bias score this far from zero is called a direction; PCR alone at its extremes reaches it. */
const DIRECTIONAL_SCORE = 25;

export type FlowKind = "long buildup" | "short buildup" | "short covering" | "long unwinding" | "added" | "reduced";

export interface Level {
  readonly strike: number;
  readonly oi: number;
  readonly oiChange: number;
  /** How far the strike is from spot, in percent (negative below). */
  readonly distancePct: number;
}

export interface Flow {
  readonly side: "call" | "put";
  readonly strike: number;
  readonly oiChange: number;
  readonly kind: FlowKind;
  /** Plain reading, e.g. "Call writing". */
  readonly label: string;
  /** Which way this positioning leans: calls written or puts bought lean down, puts written or calls bought lean up. */
  readonly lean: "bullish" | "bearish" | "neutral";
}

export interface Bias {
  /** -100 (bearish) to 100 (bullish). */
  readonly score: number;
  readonly label: "Bullish" | "Bearish" | "Neutral";
  readonly reasons: readonly string[];
}

export interface ChainAnalytics {
  readonly daysToExpiry: number | undefined;
  readonly pcrOi: number;
  readonly pcrVolume: number;
  /** Put OI added today over call OI added today: where fresh positioning is going. Undefined when no call OI was added. */
  readonly pcrOiChange: number | undefined;
  readonly resistances: readonly Level[];
  readonly supports: readonly Level[];
  /** Strike where cumulative call-minus-put gamma changes sign; an approximation. */
  readonly gammaFlip: number | undefined;
  readonly netGamma: number;
  /** Put IV minus call IV, three percent out either side: positive means downside is priced dearer. */
  readonly ivSkew: number | undefined;
  /** What the at-the-money straddle loses to time per day. */
  readonly straddleThetaPerDay: number | undefined;
  /** One standard deviation move to expiry implied by ATM IV, in index points. */
  readonly oneSigmaMove: number | undefined;
  readonly lowerBreakeven: number | undefined;
  readonly upperBreakeven: number | undefined;
  readonly flows: readonly Flow[];
  readonly bias: Bias;
}

export const daysToExpiry = (expiry: string | undefined, now: number): number | undefined => {
  if (expiry === undefined) return undefined;
  const [year, month, day] = expiry.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const close = Date.UTC(year, month - 1, day, EXPIRY_UTC_HOUR);
  return Number.isFinite(close) ? Math.max(0, (close - now) / MS_PER_DAY) : undefined;
};

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);
const ratio = (top: number, bottom: number): number => (bottom === 0 ? 0 : top / bottom);

const level = (row: ChainRow, leg: ChainLeg, spot: number): Level =>
  ({ strike: row.strike, oi: leg.oi, oiChange: leg.oiChange, distancePct: ((row.strike - spot) / spot) * 100 });

const topLevels = (rows: readonly ChainRow[], side: "call" | "put", spot: number, isWanted: (strike: number) => boolean): Level[] =>
  rows
    .filter((row) => isWanted(row.strike) && (row[side]?.oi ?? 0) > 0)
    .sort((a, b) => b[side]!.oi - a[side]!.oi)
    .slice(0, LEVELS_SHOWN)
    .map((row) => level(row, row[side]!, spot));

const flowKind = (leg: ChainLeg): FlowKind => {
  const priceChange = leg.ltp !== undefined && leg.previousClose !== undefined ? leg.ltp - leg.previousClose : undefined;
  if (priceChange === undefined || priceChange === 0) return leg.oiChange > 0 ? "added" : "reduced";
  if (leg.oiChange > 0) return priceChange > 0 ? "long buildup" : "short buildup";
  return priceChange > 0 ? "short covering" : "long unwinding";
};

// Writing a call or buying a put leans down; writing a put or buying a call leans up.
const FLOW_READING: Record<"call" | "put", Partial<Record<FlowKind, { readonly label: string; readonly lean: Flow["lean"] }>>> = {
  call: {
    "short buildup": { label: "Call writing", lean: "bearish" },
    "long buildup": { label: "Call buying", lean: "bullish" },
    "short covering": { label: "Call short covering", lean: "bullish" },
    "long unwinding": { label: "Call unwinding", lean: "bearish" },
  },
  put: {
    "short buildup": { label: "Put writing", lean: "bullish" },
    "long buildup": { label: "Put buying", lean: "bearish" },
    "short covering": { label: "Put short covering", lean: "bearish" },
    "long unwinding": { label: "Put unwinding", lean: "bullish" },
  },
};

const topFlows = (rows: readonly ChainRow[]): Flow[] => {
  const all = rows.flatMap((row) => (["call", "put"] as const).flatMap((side) => {
    const leg = row[side];
    return leg === undefined || leg.oiChange === 0 ? [] : [{ side, strike: row.strike, leg }];
  }));
  return all
    .sort((a, b) => Math.abs(b.leg.oiChange) - Math.abs(a.leg.oiChange))
    .slice(0, FLOWS_SHOWN)
    .map(({ side, strike, leg }) => {
      const kind = flowKind(leg);
      const reading = FLOW_READING[side][kind] ?? { label: `${side === "call" ? "Call" : "Put"} OI ${kind}`, lean: "neutral" as const };
      return { side, strike, oiChange: leg.oiChange, kind, ...reading };
    });
};

/** Calls count as positive gamma and puts as negative, the usual convention for dealer positioning; an approximation. */
const gammaProfile = (rows: readonly ChainRow[]): { readonly flip: number | undefined; readonly net: number } => {
  let cumulative = 0;
  let flip: number | undefined;
  for (const row of rows) {
    const before = cumulative;
    cumulative += (row.call?.gamma ?? 0) * (row.call?.oi ?? 0) - (row.put?.gamma ?? 0) * (row.put?.oi ?? 0);
    if (flip === undefined && before !== 0 && Math.sign(before) !== Math.sign(cumulative)) flip = row.strike;
  }
  return { flip, net: cumulative };
};

const nearestRow = (rows: readonly ChainRow[], target: number): ChainRow =>
  rows.reduce((best, row) => (Math.abs(row.strike - target) < Math.abs(best.strike - target) ? row : best), rows[0]!);

const scoreBias = (parts: { pcrOi: number; putAdds: number; callAdds: number; flows: readonly Flow[] }): Bias => {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string): void => { score += points; reasons.push(reason); };
  const { pcrOi, putAdds, callAdds, flows } = parts;
  if (pcrOi >= 1.3) add(25, `PCR ${pcrOi.toFixed(2)}: heavy put writing under the market`);
  else if (pcrOi >= 1) add(10, `PCR ${pcrOi.toFixed(2)}: more puts than calls held`);
  else if (pcrOi <= 0.7) add(-25, `PCR ${pcrOi.toFixed(2)}: heavy call writing over the market`);
  else if (pcrOi < 0.9) add(-10, `PCR ${pcrOi.toFixed(2)}: more calls than puts held`);
  if (putAdds > 0 && putAdds >= callAdds * FRESH_LEAN_RATIO) add(20, "Fresh positioning is going into puts");
  else if (callAdds > 0 && callAdds >= putAdds * FRESH_LEAN_RATIO) add(-20, "Fresh positioning is going into calls");
  const leaning = sum(flows.map((f) => (f.lean === "bullish" ? 1 : f.lean === "bearish" ? -1 : 0) * Math.sign(Math.abs(f.oiChange))));
  if (leaning >= 2) add(15, "Biggest OI moves lean up");
  else if (leaning <= -2) add(-15, "Biggest OI moves lean down");
  const clamped = Math.max(-100, Math.min(100, score));
  return { score: clamped, label: clamped >= DIRECTIONAL_SCORE ? "Bullish" : clamped <= -DIRECTIONAL_SCORE ? "Bearish" : "Neutral", reasons };
};

/** Positioning, levels, volatility and flow figures for a whole chain at `spot`. */
export const analyzeChain = (rows: readonly ChainRow[], spot: number, atm: ChainRow, expiry: string | undefined, now: number): ChainAnalytics => {
  const callLegs = rows.flatMap((r) => (r.call === undefined ? [] : [r.call]));
  const putLegs = rows.flatMap((r) => (r.put === undefined ? [] : [r.put]));
  const pcrOi = ratio(sum(putLegs.map((l) => l.oi)), sum(callLegs.map((l) => l.oi)));
  const putAdds = sum(putLegs.map((l) => Math.max(0, l.oiChange)));
  const callAdds = sum(callLegs.map((l) => Math.max(0, l.oiChange)));
  const flows = topFlows(rows);
  const days = daysToExpiry(expiry, now);
  const straddle = atm.call?.ltp !== undefined && atm.put?.ltp !== undefined ? atm.call.ltp + atm.put.ltp : undefined;
  const iv = [atm.call?.iv, atm.put?.iv].filter((v): v is number => v !== undefined);
  const atmIv = iv.length === 0 ? undefined : sum(iv) / iv.length;
  const putWing = nearestRow(rows, spot * (1 - SKEW_DISTANCE)).put?.iv;
  const callWing = nearestRow(rows, spot * (1 + SKEW_DISTANCE)).call?.iv;
  const gamma = gammaProfile(rows);
  const theta = atm.call?.theta !== undefined && atm.put?.theta !== undefined ? -(atm.call.theta + atm.put.theta) : undefined;
  return {
    daysToExpiry: days,
    pcrOi,
    pcrVolume: ratio(sum(putLegs.map((l) => l.volume)), sum(callLegs.map((l) => l.volume))),
    pcrOiChange: callAdds === 0 ? undefined : putAdds / callAdds,
    resistances: topLevels(rows, "call", spot, (strike) => strike >= spot),
    supports: topLevels(rows, "put", spot, (strike) => strike <= spot),
    gammaFlip: gamma.flip,
    netGamma: gamma.net,
    ivSkew: putWing !== undefined && callWing !== undefined ? putWing - callWing : undefined,
    straddleThetaPerDay: theta,
    oneSigmaMove: atmIv !== undefined && days !== undefined ? spot * (atmIv / 100) * Math.sqrt(Math.max(days, MIN_DAYS_FOR_MOVE) / 365) : undefined,
    lowerBreakeven: straddle === undefined ? undefined : atm.strike - straddle,
    upperBreakeven: straddle === undefined ? undefined : atm.strike + straddle,
    flows,
    bias: scoreBias({ pcrOi, putAdds, callAdds, flows }),
  };
};

export interface Signal {
  readonly at: number;
  readonly text: string;
  readonly tone: "bullish" | "bearish" | "neutral";
}

/** An ATM straddle moving this much between two readings is worth a line. */
const STRADDLE_JUMP = 0.05;

const wallOf = (levels: readonly Level[]): number | undefined => levels[0]?.strike;

/** What changed between two readings of the same chain, as lines a desk would want to see. */
export const detectSignals = (previous: ChainSummary, next: ChainSummary, at: number): Signal[] => {
  const signals: Signal[] = [];
  const say = (text: string, tone: Signal["tone"]): void => { signals.push({ at, text, tone }); };
  const before = previous.analytics;
  const now = next.analytics;
  if (before.bias.label !== now.bias.label) {
    say(`Bias turned ${now.bias.label} (${now.bias.score > 0 ? "+" : ""}${now.bias.score})`, now.bias.label === "Bullish" ? "bullish" : now.bias.label === "Bearish" ? "bearish" : "neutral");
  }
  const callWall = [wallOf(before.resistances), wallOf(now.resistances)] as const;
  if (callWall[0] !== undefined && callWall[1] !== undefined && callWall[0] !== callWall[1]) {
    say(`Call wall moved ${callWall[0]} → ${callWall[1]}`, callWall[1] > callWall[0] ? "bullish" : "bearish");
  }
  const putWall = [wallOf(before.supports), wallOf(now.supports)] as const;
  if (putWall[0] !== undefined && putWall[1] !== undefined && putWall[0] !== putWall[1]) {
    say(`Put wall moved ${putWall[0]} → ${putWall[1]}`, putWall[1] > putWall[0] ? "bullish" : "bearish");
  }
  if (before.pcrOi < 1 && now.pcrOi >= 1) say(`PCR crossed above 1.0 (${now.pcrOi.toFixed(2)})`, "bullish");
  if (before.pcrOi >= 1 && now.pcrOi < 1) say(`PCR crossed below 1.0 (${now.pcrOi.toFixed(2)})`, "bearish");
  if (previous.maxPain !== next.maxPain) say(`Max pain moved ${previous.maxPain} → ${next.maxPain}`, next.maxPain > previous.maxPain ? "bullish" : "bearish");
  const flip = now.gammaFlip;
  if (flip !== undefined && previous.spot < flip !== next.spot < flip) {
    say(`Spot crossed ${next.spot >= flip ? "above" : "below"} the gamma flip ${flip}`, next.spot >= flip ? "bullish" : "bearish");
  }
  if (previous.straddle !== undefined && next.straddle !== undefined && previous.straddle > 0) {
    const change = (next.straddle - previous.straddle) / previous.straddle;
    if (Math.abs(change) >= STRADDLE_JUMP) say(`ATM straddle ${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}% (${next.straddle.toFixed(1)})`, "neutral");
  }
  return signals;
};
