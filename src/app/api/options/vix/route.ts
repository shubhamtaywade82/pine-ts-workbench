import { NextResponse } from "next/server";
import { indiaVix } from "@/lib/dhan-options";

export const dynamic = "force-dynamic";

/** GET /api/options/vix → { ok, vix } with the level, day change and one-year percentile; vix is null when unavailable. */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, vix: (await indiaVix()) ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
