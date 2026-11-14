import { callDhan } from "@/lib/dhan-call-queue";
import { getDhanClient } from "@/lib/dhan-client";
import { istToday } from "@/lib/dhan-rolling";
import { buildBook, type BookRow, type OffsetSide, type SpotRange } from "@/lib/held-options";
import { offsetStrike, trackedOffsets, type RollingQuery } from "@/lib/rolling-request";

/**
 * The strikes around the money for one date window, so a held contract can be followed. A window is many calls
 * (one per strike per side), so the page asks window by window and shows progress; past windows are kept for good.
 */

/** Bar sizes the lab replays on: any interval costs the same calls; one-minute bars time an entry signal closely. */
export const LAB_INTERVALS = ["1", "5"] as const;
const REQUIRED = ["high", "low", "close", "iv", "strike", "spot"];
const TODAY_TTL_MS = 60_000;
// One-minute windows are large (hundreds of bars × every strike); a month of them is what the page can ask for.
const CACHE_LIMIT = 40;

const cache = new Map<string, { readonly at: number; readonly isFinal: boolean; readonly rows: Promise<BookRow[]> }>();

const fetchOffset = (query: RollingQuery, side: "CALL" | "PUT", offset: number): Promise<OffsetSide> =>
  callDhan(async () => {
    const client = await getDhanClient();
    const response = await client.charts.option({
      exchangeSegment: query.segment, interval: query.interval, securityId: query.securityId, instrument: query.instrument,
      expiryFlag: query.expiryFlag, expiryCode: query.expiryCode, strike: offsetStrike(offset), drvOptionType: side,
      requiredData: REQUIRED as never, fromDate: query.from, toDate: query.to,
    });
    const data = (response as { data?: { ce?: Omit<OffsetSide, "side" | "offset">; pe?: Omit<OffsetSide, "side" | "offset"> } }).data;
    return { side, offset, ...((side === "CALL" ? data?.ce : data?.pe) ?? {}) };
  });

/**
 * The underlying's own bars for the window, whose high and low show whether the money crossed a strike inside a bar.
 * Index options read the index; stock options the stock on NSE.
 */
const fetchUnderlying = (query: RollingQuery): Promise<Map<number, SpotRange>> =>
  callDhan(async () => {
    const client = await getDhanClient();
    const isIndex = query.instrument === "OPTIDX";
    const response = await client.charts.intraday({
      securityId: String(query.securityId), exchangeSegment: isIndex ? "IDX_I" : "NSE_EQ", instrument: isIndex ? "INDEX" : "EQUITY",
      // Dates only; the day after `to` makes sure `to` is covered, and bars past it simply find no row to join.
      interval: query.interval, fromDate: query.from, toDate: new Date(Date.parse(query.to) + 86_400_000).toISOString().slice(0, 10),
    });
    const { timestamp = [], high = [], low = [] } = response as { timestamp?: number[]; high?: number[]; low?: number[] };
    return new Map(timestamp.map((seconds, i) => [seconds * 1000, { high: high[i]!, low: low[i]! }]));
  });

/** Every tracked strike's call and put for one window (from…to, at most two days), merged into a book. */
export const heldBook = (query: RollingQuery): Promise<BookRow[]> => {
  const key = JSON.stringify([query.segment, query.securityId, query.instrument, query.expiryFlag, query.expiryCode, query.interval, query.from, query.to]);
  const hit = cache.get(key);
  if (hit !== undefined && (hit.isFinal || Date.now() - hit.at < TODAY_TTL_MS)) return hit.rows;
  const reach = trackedOffsets(query);
  const offsets = Array.from({ length: 2 * reach + 1 }, (_, i) => i - reach);
  const rows = Promise.all([
    Promise.all(offsets.flatMap((offset) => [fetchOffset(query, "CALL", offset), fetchOffset(query, "PUT", offset)])),
    // Without the underlying's range the book still builds, falling back to bar-to-bar strike changes.
    fetchUnderlying(query).catch(() => new Map<number, SpotRange>()),
  ])
    .then(([series, spot]) => buildBook(series, spot))
    .catch((error: unknown) => { cache.delete(key); throw error; });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), isFinal: query.to < istToday(), rows });
  return rows;
};
