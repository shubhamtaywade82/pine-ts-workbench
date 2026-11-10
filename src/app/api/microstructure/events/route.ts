import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseEventQuery } from "@/lib/market-recorder";

const MAX_EVENTS = 20_000;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = parseEventQuery(params.get("symbol"), params.get("from"), params.get("to"));
  if (query === undefined) {
    return NextResponse.json({ ok: false, error: "Expected symbol, from, and to (ms)" }, { status: 400 });
  }
  try {
    const rows = await db.marketEvent.findMany({
      where: { symbol: query.symbol, receivedAt: { gte: query.from, lte: query.to } },
      orderBy: { receivedAt: "asc" },
      take: MAX_EVENTS,
    });
    return NextResponse.json({
      ok: true,
      events: rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        kind: row.kind,
        seq: Number(row.seq),
        exchangeTime: row.exchangeTime,
        receivedAt: row.receivedAt,
        payload: row.payload,
        schemaVersion: row.schemaVersion,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), events: [] }, { status: 500 });
  }
}
