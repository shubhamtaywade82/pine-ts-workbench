/** Underlyings for the expired-options history. A plain module so server pages can read it, not only client components. */

export interface Underlying {
  readonly name: string;
  readonly securityId: number;
  readonly segment: "NSE_FNO" | "BSE_FNO";
  readonly instrument: "OPTIDX" | "OPTSTK";
  readonly expiryFlag: "WEEK" | "MONTH";
}

/** Where the underlying itself trades, for its price history: indices are IDX_I and stocks NSE_EQ, under the same id. */
export const spotSegmentOf = (underlying: Underlying): "IDX_I" | "NSE_EQ" => (underlying.instrument === "OPTIDX" ? "IDX_I" : "NSE_EQ");

/** Index options with their Dhan ids and expiry cadence (checked against Dhan's instrument list). */
export const INDEX_UNDERLYINGS: readonly Underlying[] = [
  { name: "NIFTY", securityId: 13, segment: "NSE_FNO", instrument: "OPTIDX", expiryFlag: "WEEK" },
  { name: "SENSEX", securityId: 51, segment: "BSE_FNO", instrument: "OPTIDX", expiryFlag: "WEEK" },
  { name: "BANKNIFTY", securityId: 25, segment: "NSE_FNO", instrument: "OPTIDX", expiryFlag: "MONTH" },
  { name: "FINNIFTY", securityId: 27, segment: "NSE_FNO", instrument: "OPTIDX", expiryFlag: "MONTH" },
  { name: "MIDCPNIFTY", securityId: 442, segment: "NSE_FNO", instrument: "OPTIDX", expiryFlag: "MONTH" },
  { name: "BANKEX", securityId: 69, segment: "BSE_FNO", instrument: "OPTIDX", expiryFlag: "MONTH" },
];
