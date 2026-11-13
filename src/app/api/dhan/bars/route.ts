import { NextRequest, NextResponse } from "next/server";
import { fetchDhanBars, isDhanInstrument, isDhanInterval } from "@/lib/dhan-bars";

// Server-side only: the Dhan token (shared from algo_scalper_api) never reaches the browser.
export const dynamic = "force-dynamic";

const MAX_BARS = 2000;

/** GET /api/dhan/bars?segment=IDX_I&securityId=13&interval=5m&limit=500 → { ok, bars }; any instrument from the symbol search. */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const segment = searchParams.get("segment") ?? "";
  const securityId = searchParams.get("securityId") ?? "";
  const interval = searchParams.get("interval") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 500) || 500, MAX_BARS);

  if (!isDhanInstrument(segment, securityId)) return NextResponse.json({ ok: false, error: "unknown Dhan instrument" }, { status: 400 });
  if (!isDhanInterval(interval)) return NextResponse.json({ ok: false, error: `Dhan has no ${interval} candles` }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, bars: await fetchDhanBars({ segment, securityId }, interval, limit) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
