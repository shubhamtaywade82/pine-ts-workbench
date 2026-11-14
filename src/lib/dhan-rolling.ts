import { callDhan } from "@/lib/dhan-call-queue";
import { getDhanClient } from "@/lib/dhan-client";
import { alignRows, IST_OFFSET_MS, type RawSide, type RollingRow } from "@/lib/rolling-options";
import { dateWindows, strikeFor, type RollingQuery } from "@/lib/rolling-request";

/**
 * Expired option history from Dhan, server-side. A past day never changes, so each two-day window is cached for
 * the life of the process; only a window that includes today is re-read, after a minute.
 */

const REQUIRED = ["open", "high", "low", "close", "iv", "volume", "strike", "oi", "spot"];
const TODAY_TTL_MS = 60_000;
/** Enough windows for several underlyings' full ranges without growing without bound. */
const CACHE_LIMIT = 400;

const cache = new Map<string, { readonly at: number; readonly isFinal: boolean; readonly rows: Promise<RollingRow[]> }>();

export const istToday = (now = Date.now()): string => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

const fetchSide = (query: RollingQuery, window: { from: string; to: string }, side: "CALL" | "PUT"): Promise<RawSide> =>
  callDhan(() => requestSide(query, window, side));

const requestSide = async (query: RollingQuery, window: { from: string; to: string }, side: "CALL" | "PUT"): Promise<RawSide> => {
  const client = await getDhanClient();
  const response = await client.charts.option({
    exchangeSegment: query.segment, interval: query.interval, securityId: query.securityId, instrument: query.instrument,
    expiryFlag: query.expiryFlag, expiryCode: query.expiryCode, strike: strikeFor(side, query.width), drvOptionType: side,
    requiredData: REQUIRED as never, fromDate: window.from, toDate: window.to,
  });
  const data = (response as { data?: { ce?: RawSide; pe?: RawSide } }).data;
  return (side === "CALL" ? data?.ce : data?.pe) ?? {};
};

const windowRows = (query: RollingQuery, window: { from: string; to: string }, today: string): Promise<RollingRow[]> => {
  const key = JSON.stringify([query.segment, query.securityId, query.instrument, query.expiryFlag, query.expiryCode, query.width, query.interval, window.from, window.to]);
  const hit = cache.get(key);
  if (hit !== undefined && (hit.isFinal || Date.now() - hit.at < TODAY_TTL_MS)) return hit.rows;
  const rows = Promise.all([fetchSide(query, window, "CALL"), fetchSide(query, window, "PUT")]) // queued, so still one at a time
    .then(([ce, pe]) => alignRows(ce, pe))
    .catch((error: unknown) => { cache.delete(key); throw error; }); // a failure is retried next time, never cached
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), isFinal: window.to < today, rows });
  return rows;
};

/** Every bar in the range, oldest first. Windows are read one after another to stay well inside Dhan's rate limit. */
export const rollingHistory = async (query: RollingQuery): Promise<RollingRow[]> => {
  const today = istToday();
  const all: RollingRow[] = [];
  for (const window of dateWindows(query.from, query.to)) all.push(...await windowRows(query, window, today));
  return all;
};
