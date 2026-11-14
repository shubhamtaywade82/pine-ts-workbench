import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { paperTrades } from "@/lib/bot-analysis";

// Read-only: the bot repo is never written to from here.
const BOT_DIR = process.env.BOT_REPO_DIR ?? path.resolve(process.cwd(), "../../indian-trading/options-trading-agent");

const jsonLines = (text: string): Record<string, unknown>[] =>
  text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
  });

const readLines = async (file: string): Promise<Record<string, unknown>[]> =>
  jsonLines(await readFile(path.join(BOT_DIR, file), "utf8").catch(() => ""));

const journalEvents = async (): Promise<Record<string, unknown>[]> => {
  const names = await readdir(path.join(BOT_DIR, "data/journal")).catch(() => [] as string[]);
  const journals = names.filter((n) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
  return (await Promise.all(journals.map((n) => readLines(`data/journal/${n}`)))).flat();
};

/** The bot's paper trades, its research ledger, and its replay runs, as stored in its repo. */
export async function GET() {
  const [events, experiments, runs] = await Promise.all([journalEvents(), readLines("docs/research/experiments.jsonl"), readLines("data/research/runs.jsonl")]);
  if (events.length === 0 && experiments.length === 0) {
    return NextResponse.json({ ok: false, error: `No bot data found under ${BOT_DIR}. Set BOT_REPO_DIR to the options-trading-agent folder.` });
  }
  return NextResponse.json({
    ok: true,
    trades: paperTrades(events),
    experiments: experiments.map((e) => ({ seq: e.seq, created: e.created_at, strategy: e.strategy_id, underlying: e.underlying, range: (e.date_range as { label?: string } | undefined)?.label, type: e.experiment_type, holdout: e.holdout_status, cells: e.cells, variants: e.variants_evaluated, result: e.result })),
    runs: runs.filter((r) => typeof r.trades === "number").map((r) => ({ ts: r.ts, data: r.data, costs: r.costs, trades: r.trades, meanR: r.meanR, verdict: r.verdict })),
  });
}
