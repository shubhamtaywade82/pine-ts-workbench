import { NextRequest, NextResponse } from "next/server";
import { fetchDhanBars, isDhanInterval } from "@/lib/dhan-bars";
import { SYMBOL_CATALOG } from "@/lib/symbol-catalog";

// Server-side only: the Dhan token (shared from algo_scalper_api) never reaches the browser.
export const dynamic = "force-dynamic";

const MAX_BARS = 2000;

/** GET /api/dhan/bars?ticker=NSE:NIFTY50&interval=5m&limit=500 → { ok, bars } */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = SYMBOL_CATALOG.find((s) => s.ticker === searchParams.get("ticker") && s.provider === "dhan");
  const interval = searchParams.get("interval") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 500) || 500, MAX_BARS);

  if (symbol === undefined) return NextResponse.json({ ok: false, error: "unknown Dhan ticker" }, { status: 400 });
  if (!isDhanInterval(interval)) return NextResponse.json({ ok: false, error: `Dhan has no ${interval} candles` }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, bars: await fetchDhanBars(symbol, interval, limit) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
