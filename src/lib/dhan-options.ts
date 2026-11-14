import { fetchDhanBars } from "@/lib/dhan-bars";
import { getDhanClient } from "@/lib/dhan-client";
import { vixReading, type VixReading } from "@/lib/option-filter";
import { summarizeChain, type ChainSummary } from "@/lib/option-chain";

/**
 * Option chains from Dhan for the chart's option panel. Server-side only.
 *
 * Dhan allows one option-chain call every three seconds across the whole account, and a chart polls, so every
 * call goes through one queue with a gap, and answers are cached: a chart never asks Dhan directly.
 */

const UNDERLYING_SEGMENTS: ReadonlySet<string> = new Set(["IDX_I", "NSE_EQ", "BSE_EQ"]);
const MIN_GAP_MS = 3_100;
const EXPIRY_TTL_MS = 600_000;
const EXPIRY_MAX_STALE_MS = 3_600_000;
const CHAIN_TTL_MS = 4_000;
// Past this age a chain is too old to show without waiting for a fresh one.
const CHAIN_MAX_STALE_MS = 30_000;

export const isOptionUnderlying = (segment: string, securityId: string): boolean =>
  UNDERLYING_SEGMENTS.has(segment) && /^\d+$/.test(securityId);

export const isExpiry = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let gate: Promise<unknown> = Promise.resolve();
const rateLimited = <T>(task: () => Promise<T>): Promise<T> => {
  const run = gate.then(task);
  gate = run.then(() => sleep(MIN_GAP_MS), () => sleep(MIN_GAP_MS));
  return run;
};

interface Entry<T> { readonly at: number; readonly value: T }

/**
 * Fresh answers come straight from the cache. A slightly stale one is served at once while a refresh runs
 * behind it, so a caller never waits on Dhan's three-second gap for data that is seconds old. Concurrent
 * callers share one refresh, and a failed refresh keeps serving what it has.
 */
export const cachedCall = <T>(cache: Map<string, Entry<T>>, inFlight: Map<string, Promise<Entry<T>>>, ttlMs: number, maxStaleMs: number, schedule: <R>(task: () => Promise<R>) => Promise<R> = rateLimited) =>
  (key: string, load: () => Promise<T>): Promise<Entry<T>> => {
    const hit = cache.get(key);
    const age = hit === undefined ? Number.POSITIVE_INFINITY : Date.now() - hit.at;
    if (hit !== undefined && age < ttlMs) return Promise.resolve(hit);
    const refresh = inFlight.get(key) ?? schedule(load)
      .then((value) => { const entry = { at: Date.now(), value }; cache.set(key, entry); return entry; })
      .catch((error: unknown) => { if (hit !== undefined) return hit; throw error; })
      .finally(() => { inFlight.delete(key); });
    inFlight.set(key, refresh);
    if (hit !== undefined && age < maxStaleMs) return Promise.resolve(hit);
    return refresh;
  };

const expiryCache = new Map<string, Entry<readonly string[]>>();
const chainCache = new Map<string, Entry<ChainSummary | undefined>>();
const expiryCall = cachedCall(expiryCache, new Map(), EXPIRY_TTL_MS, EXPIRY_MAX_STALE_MS);
const chainCall = cachedCall(chainCache, new Map(), CHAIN_TTL_MS, CHAIN_MAX_STALE_MS);

/** Expiry dates of an underlying's options, soonest first; empty when it has no options. */
export const optionExpiries = async (segment: string, securityId: string): Promise<readonly string[]> =>
  (await expiryCall(`${segment}:${securityId}`, async () => {
    const client = await getDhanClient();
    try {
      const response = await client.optionChain.expiryList({ underlyingScrip: Number(securityId), underlyingSeg: segment });
      return response.data ?? [];
    } catch (error) {
      // Dhan answers an underlying without options with an error; that is "none", not an outage.
      console.warn(`[options] no expiries for ${segment}:${securityId}:`, error instanceof Error ? error.message : error);
      return [];
    }
  })).value;

/** The chain for one expiry, boiled down to the figures and rows the panel shows, with when Dhan was last read. */
export const optionChainSummary = async (segment: string, securityId: string, expiry: string): Promise<{ readonly summary: ChainSummary | undefined; readonly asOf: number }> => {
  const { value, at } = await chainCall(`${segment}:${securityId}:${expiry}`, async () => {
    const client = await getDhanClient();
    return summarizeChain(await client.optionChain.fetchNormalized({ underlyingScrip: Number(securityId), underlyingSeg: segment, expiry }), undefined, { expiry });
  });
  return { summary: value, asOf: at };
};

const VIX_TTL_MS = 60_000;
const VIX_HISTORY_BARS = 260;
let vixInstrument: Promise<string | undefined> | undefined;
let vixCache: Entry<VixReading | undefined> | undefined;

/** Dhan's id for India VIX, found once by name. */
const vixSecurityId = (): Promise<string | undefined> =>
  (vixInstrument ??= getDhanClient()
    .then((client) => client.instruments.search("INDIA VIX", { segments: ["IDX_I"], limit: 10 }))
    .then((found) => found.find((i) => i.symbolName === "INDIA VIX")?.securityId)
    .catch((error: unknown) => { vixInstrument = undefined; throw error; }));

/** India VIX now, its day change, and where it ranks among the last year's closes. */
export const indiaVix = async (): Promise<VixReading | undefined> => {
  if (vixCache !== undefined && Date.now() - vixCache.at < VIX_TTL_MS) return vixCache.value;
  const securityId = await vixSecurityId();
  if (securityId === undefined) return undefined;
  const { bars } = await fetchDhanBars({ segment: "IDX_I", securityId }, "1d", VIX_HISTORY_BARS);
  vixCache = { at: Date.now(), value: vixReading(bars) };
  return vixCache.value;
};

const CONTRACT_SEGMENTS: ReadonlySet<string> = new Set(["NSE_FNO", "BSE_FNO", "MCX_COMM"]);

export const isContract = (segment: string, securityId: string): boolean =>
  CONTRACT_SEGMENTS.has(segment) && /^\d+$/.test(securityId);

// A contract's lot size is fixed for its life, so it is looked up once and kept.
const lotSizes = new Map<string, Promise<number | undefined>>();

/** Units in one lot of an option contract, from Dhan's instrument master; undefined if it is not listed. */
export const contractLotSize = (segment: string, securityId: string): Promise<number | undefined> => {
  const key = `${segment}:${securityId}`;
  let known = lotSizes.get(key);
  if (known === undefined) {
    known = getDhanClient()
      .then((client) => client.instruments.findBySecurityId(segment, securityId))
      .then((instrument) => (instrument?.lotSize !== undefined && instrument.lotSize > 0 ? instrument.lotSize : undefined))
      .catch((error: unknown) => { lotSizes.delete(key); throw error; });
    lotSizes.set(key, known);
  }
  return known;
};
