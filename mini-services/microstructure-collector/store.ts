import { PrismaClient } from "@prisma/client";
import type { BookSnapshotRow, MarketEventRow, MarketStore, WallTransitionRow } from "../../src/lib/market-recorder";
import {
  CLASSIFIER_VERSION,
  OUTCOME_SCAN_OPTIONS,
  interactionWrite,
  scanInteractions,
  type InteractionInsert,
} from "../../src/lib/outcome-donut";
import { tradeLookbackStart, windowFrom } from "../../src/lib/outcome-path";

const DAY_MS = 24 * 60 * 60 * 1000;

const db = new PrismaClient();

const eventData = (row: MarketEventRow) => ({
  symbol: row.symbol,
  kind: row.kind,
  seq: BigInt(row.seq),
  exchangeTime: row.exchangeTime,
  receivedAt: row.receivedAt,
  payload: row.payload,
  schemaVersion: row.schemaVersion,
});

const upsertEvent = (row: MarketEventRow) => {
  const data = eventData(row);
  return db.marketEvent.upsert({
    where: { symbol_kind_seq: { symbol: data.symbol, kind: data.kind, seq: data.seq } },
    update: {},
    create: data,
  });
};

// SQLite rejects createMany({ skipDuplicates }), so each event is an upsert in one transaction.
const insertEvents = async (rows: readonly MarketEventRow[]): Promise<void> => {
  if (rows.length === 0) return;
  await db.$transaction(rows.map(upsertEvent));
};

const insertSnapshots = async (rows: readonly BookSnapshotRow[]): Promise<void> => {
  await db.bookSnapshot.createMany({
    data: rows.map((row) => ({
      symbol: row.symbol,
      capturedAt: row.capturedAt,
      lastUpdateId: BigInt(row.lastUpdateId),
      bids: row.bids,
      asks: row.asks,
      coverage: row.coverage,
    })),
  });
};

const insertTransitions = async (rows: readonly WallTransitionRow[]): Promise<void> => {
  await db.wallTransition.createMany({ data: [...rows] });
};

export const store: MarketStore = { insertEvents, insertSnapshots, insertTransitions };

const retentionDays = (): number => {
  const days = Number(process.env.RETENTION_DAYS ?? "3");
  return Number.isFinite(days) && days > 0 ? days : 3;
};

export const purgeOldEvents = async (): Promise<void> => {
  const cutoff = Date.now() - retentionDays() * DAY_MS;
  // WallTransition and LiquidityInteraction are kept as the research record.
  await Promise.all([
    db.marketEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } }),
    db.bookSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
  ]);
};

export const disconnectStore = (): Promise<void> => db.$disconnect();

const WALL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PAGE = 50_000;
const OUTCOME_MS = 60_000;
// SQLite caps variables per statement; 500 ids stay inside it with room to spare.
const STORED_ID_CHUNK = 500;
const INSERT_CHUNK = 200;

const idAfter = (after: number | undefined) => (after === undefined ? {} : { id: { gt: after } });

const nextId = (rows: readonly { id: number }[]): number | undefined =>
  rows.length < PAGE ? undefined : rows[rows.length - 1]?.id;

const loadAfter = async <T extends { id: number }>(
  fetchPage: (after: number | undefined) => Promise<T[]>,
): Promise<T[]> => {
  const found: T[] = [];
  let after: number | undefined;
  let page = await fetchPage(after);
  found.push(...page);
  after = nextId(page);
  while (after !== undefined) {
    page = await fetchPage(after);
    found.push(...page);
    after = nextId(page);
  }
  return found;
};

const loadTransitions = (symbol: string, since: number) => loadAfter((after) =>
  db.wallTransition.findMany({
    where: { symbol, at: { gte: since }, ...idAfter(after) },
    orderBy: { id: "asc" },
    take: PAGE,
  }));

const loadEvents = (symbol: string, kind: "trade" | "gap", since: number) => loadAfter((after) =>
  db.marketEvent.findMany({
    where: { symbol, kind, receivedAt: { gte: since }, ...idAfter(after) },
    orderBy: { id: "asc" },
    take: PAGE,
  }));

const insertInteractions = async (rows: readonly InteractionInsert[]): Promise<void> => {
  for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
    const chunk = rows.slice(from, from + INSERT_CHUNK);
    await db.$transaction(chunk.map((row) => db.liquidityInteraction.upsert(interactionWrite(row))));
  }
};

const storedWallIds = async (wallIds: readonly string[]): Promise<Set<string>> => {
  const stored = new Set<string>();
  for (let from = 0; from < wallIds.length; from += STORED_ID_CHUNK) {
    const rows = await db.liquidityInteraction.findMany({
      where: { wallId: { in: wallIds.slice(from, from + STORED_ID_CHUNK) }, classifierVersion: CLASSIFIER_VERSION },
      select: { wallId: true },
    });
    for (const row of rows) stored.add(row.wallId);
  }
  return stored;
};

const uniqueWallIds = (transitions: readonly WallTransitionRow[]): string[] =>
  [...new Set(transitions.map((row) => row.wallId))];

const classifySymbol = async (symbol: string, now: number): Promise<void> => {
  const tradesFrom = tradeLookbackStart(now, OUTCOME_SCAN_OPTIONS.evaluationWindowMs, OUTCOME_MS);
  const [transitions, trades, gaps] = await Promise.all([
    loadTransitions(symbol, now - WALL_LOOKBACK_MS),
    loadEvents(symbol, "trade", tradesFrom),
    loadEvents(symbol, "gap", now - WALL_LOOKBACK_MS),
  ]);
  // Wall rows are small. Trades are not, so each pass reads only the open evaluation window.
  const input = windowFrom(
    transitions,
    trades.map((row) => ({ payload: row.payload, receivedAt: row.receivedAt, exchangeTime: row.exchangeTime })),
    gaps.map((row) => ({ payload: row.payload, receivedAt: row.receivedAt })),
    now,
  );
  const scan = { now, tradesFrom, storedWallIds: await storedWallIds(uniqueWallIds(transitions)) };
  await insertInteractions(scanInteractions(input, scan));
};

const classifyStored = async (symbols: readonly string[], now = Date.now()): Promise<void> => {
  for (const symbol of symbols) await classifySymbol(symbol, now);
};

export const startOutcomeLoop = (
  symbols: readonly string[],
  flush: () => Promise<unknown>,
): (() => void) => {
  const run = (): void => {
    void flush()
      .then(() => classifyStored(symbols, Date.now()))
      .catch((error: unknown) => console.error(error));
  };
  // The recorder writes about once a second. Scanning first would miss that batch.
  run();
  const timer = setInterval(run, OUTCOME_MS);
  return () => clearInterval(timer);
};
