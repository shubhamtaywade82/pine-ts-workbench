import { analyzeChain, type ChainAnalytics } from "./option-analytics";
import type { SymbolOption } from "./symbol-catalog";

/** Strikes shown each side of the at-the-money strike. */
export const CHAIN_WINDOW = 10;

export interface ChainLeg {
  readonly ltp: number | undefined;
  readonly oi: number;
  /** Open interest added (or removed, when negative) since the previous session's close. */
  readonly oiChange: number;
  readonly iv: number | undefined;
  readonly delta: number | undefined;
  readonly gamma: number | undefined;
  readonly theta: number | undefined;
  readonly volume: number;
  /** Last session's closing price: the basis for reading whether a contract's price rose or fell. */
  readonly previousClose: number | undefined;
  /** The contract's own Dhan id, which opens its chart. */
  readonly securityId: string | undefined;
}

export interface ChainRow {
  readonly strike: number;
  readonly call: ChainLeg | undefined;
  readonly put: ChainLeg | undefined;
}

export interface ChainSummary {
  readonly spot: number;
  readonly atmStrike: number;
  /** Total put OI over total call OI: above 1 means more puts written than calls. */
  readonly pcr: number;
  /** The expiry price at which option writers pay out least. */
  readonly maxPain: number;
  readonly atmIv: number | undefined;
  /** Price of the at-the-money call and put together: what the market expects the underlying to move. */
  readonly straddle: number | undefined;
  readonly expectedMovePct: number | undefined;
  readonly maxCallOiStrike: number | undefined;
  readonly maxPutOiStrike: number | undefined;
  readonly rows: readonly ChainRow[];
  readonly analytics: ChainAnalytics;
}

/** The SDK's normalized leg and chain, described by the fields used so this module needs no SDK import. */
interface RawLeg {
  readonly last_price?: number;
  readonly oi?: number;
  readonly previous_oi?: number;
  readonly implied_volatility?: number;
  readonly volume?: number;
  readonly previous_close_price?: number;
  readonly greeks?: { readonly delta?: number; readonly gamma?: number; readonly theta?: number };
  readonly security_id?: string | number;
}
export interface RawChain {
  readonly lastPrice?: number;
  readonly strikes: readonly { readonly strike: number; readonly call?: RawLeg; readonly put?: RawLeg }[];
}

const toLeg = (raw: RawLeg | undefined): ChainLeg | undefined => {
  if (raw === undefined) return undefined;
  const oi = raw.oi ?? 0;
  return {
    ltp: raw.last_price,
    oi,
    oiChange: oi - (raw.previous_oi ?? oi),
    iv: raw.implied_volatility,
    delta: raw.greeks?.delta,
    gamma: raw.greeks?.gamma,
    theta: raw.greeks?.theta,
    volume: raw.volume ?? 0,
    previousClose: raw.previous_close_price,
    securityId: raw.security_id === undefined ? undefined : String(raw.security_id),
  };
};

/** The strike where writers pay least if the underlying expired there. */
const maxPainStrike = (rows: readonly ChainRow[]): number => {
  let best = { strike: rows[0]!.strike, pain: Number.POSITIVE_INFINITY };
  for (const { strike: expiry } of rows) {
    let pain = 0;
    for (const row of rows) {
      pain += (row.call?.oi ?? 0) * Math.max(0, expiry - row.strike) + (row.put?.oi ?? 0) * Math.max(0, row.strike - expiry);
    }
    if (pain < best.pain) best = { strike: expiry, pain };
  }
  return best.strike;
};

const strikeOfMaxOi = (rows: readonly ChainRow[], side: "call" | "put"): number | undefined => {
  let best: { strike: number; oi: number } | undefined;
  for (const row of rows) {
    const oi = row[side]?.oi ?? 0;
    if (oi > 0 && (best === undefined || oi > best.oi)) best = { strike: row.strike, oi };
  }
  return best?.strike;
};

const mean = (values: readonly (number | undefined)[]): number | undefined => {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length === 0 ? undefined : known.reduce((sum, v) => sum + v, 0) / known.length;
};

/** Reads a whole chain into the figures an options trader looks at, plus the rows around the money. Undefined for an empty chain. */
export const summarizeChain = (chain: RawChain, window = CHAIN_WINDOW, context: { readonly expiry?: string; readonly now?: number } = {}): ChainSummary | undefined => {
  const spot = chain.lastPrice;
  if (spot === undefined || chain.strikes.length === 0) return undefined;
  const rows: ChainRow[] = chain.strikes.map((s) => ({ strike: s.strike, call: toLeg(s.call), put: toLeg(s.put) }));
  const atmIndex = rows.reduce((best, row, i) => (Math.abs(row.strike - spot) < Math.abs(rows[best]!.strike - spot) ? i : best), 0);
  const atm = rows[atmIndex]!;
  const callOi = rows.reduce((sum, r) => sum + (r.call?.oi ?? 0), 0);
  const putOi = rows.reduce((sum, r) => sum + (r.put?.oi ?? 0), 0);
  const straddle = atm.call?.ltp !== undefined && atm.put?.ltp !== undefined ? atm.call.ltp + atm.put.ltp : undefined;
  return {
    spot,
    atmStrike: atm.strike,
    pcr: callOi === 0 ? 0 : putOi / callOi,
    maxPain: maxPainStrike(rows),
    atmIv: mean([atm.call?.iv, atm.put?.iv]),
    straddle,
    expectedMovePct: straddle === undefined ? undefined : (straddle / spot) * 100,
    maxCallOiStrike: strikeOfMaxOi(rows, "call"),
    maxPutOiStrike: strikeOfMaxOi(rows, "put"),
    rows: rows.slice(Math.max(0, atmIndex - window), atmIndex + window + 1),
    analytics: analyzeChain(rows, spot, atm, context.expiry, context.now ?? Date.now()),
  };
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** "2026-11-17" → "17 NOV". */
export const formatExpiry = (expiry: string): string => {
  const [, month, day] = expiry.split("-");
  const name = MONTHS[Number(month) - 1];
  return name === undefined || day === undefined ? expiry : `${Number(day)} ${name}`;
};

/** A chart-ready symbol for one option contract, as the search would return it. */
export const contractSymbol = (
  underlying: SymbolOption,
  contract: { readonly expiry: string; readonly strike: number; readonly side: "call" | "put"; readonly securityId: string },
): SymbolOption => {
  const name = `${underlying.displayName} ${formatExpiry(contract.expiry)} ${contract.strike} ${contract.side === "call" ? "CALL" : "PUT"}`;
  return {
    ticker: `${underlying.exchange}:${name}`,
    displayName: name,
    provider: "dhan",
    exchange: underlying.exchange,
    category: "derivative",
    binanceSymbol: "BTCUSDT",
    dhanSecurityId: contract.securityId,
    dhanSegment: underlying.exchange === "BSE" ? "BSE_FNO" : "NSE_FNO",
  };
};
