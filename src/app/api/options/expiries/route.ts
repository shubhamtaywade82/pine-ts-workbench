import { NextRequest, NextResponse } from "next/server";
import { isOptionUnderlying, optionExpiries } from "@/lib/dhan-options";

export const dynamic = "force-dynamic";

/** GET /api/options/expiries?segment=IDX_I&securityId=13 → { ok, expiries }; empty when the instrument has no options. */
export async function GET(req: NextRequest) {
  const segment = req.nextUrl.searchParams.get("segment") ?? "";
  const securityId = req.nextUrl.searchParams.get("securityId") ?? "";
  if (!isOptionUnderlying(segment, securityId)) return NextResponse.json({ ok: true, expiries: [] });
  try {
    return NextResponse.json({ ok: true, expiries: await optionExpiries(segment, securityId) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
