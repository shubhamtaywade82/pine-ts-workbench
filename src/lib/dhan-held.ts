import { callDhan } from "@/lib/dhan-call-queue";
import { getDhanClient } from "@/lib/dhan-client";
import { istToday } from "@/lib/dhan-rolling";
import { buildBook, type BookRow, type OffsetSide } from "@/lib/held-options";
import { offsetStrike, trackedOffsets, type RollingQuery } from "@/lib/rolling-request";

/**
 * The strikes around the money for one date window, so a held contract can be followed. A window is many calls
 * (one per strike per side), so the page asks window by window and shows progress; past windows are kept for good.
 */

/** Bar sizes the lab replays on: any interval costs the same calls; one-minute bars time an entry signal closely. */
export const LAB_INTERVALS = ["1", "5"] as const;
const REQUIRED = ["high", "low", "close", "iv", "strike", "spot"];
const TODAY_TTL_MS = 60_000;
const CACHE_LIMIT = 200;

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

/** Every tracked strike's call and put for one window (from…to, at most two days), merged into a book. */
export const heldBook = (query: RollingQuery): Promise<BookRow[]> => {
  const key = JSON.stringify([query.segment, query.securityId, query.instrument, query.expiryFlag, query.expiryCode, query.interval, query.from, query.to]);
  const hit = cache.get(key);
  if (hit !== undefined && (hit.isFinal || Date.now() - hit.at < TODAY_TTL_MS)) return hit.rows;
  const reach = trackedOffsets(query);
  const offsets = Array.from({ length: 2 * reach + 1 }, (_, i) => i - reach);
  const rows = Promise.all(offsets.flatMap((offset) => [fetchOffset(query, "CALL", offset), fetchOffset(query, "PUT", offset)]))
    .then(buildBook)
    .catch((error: unknown) => { cache.delete(key); throw error; });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), isFinal: query.to < istToday(), rows });
  return rows;
};
