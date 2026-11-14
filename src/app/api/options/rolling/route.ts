import { NextRequest, NextResponse } from "next/server";
import { istToday, rollingHistory } from "@/lib/dhan-rolling";
import { parseRollingQuery } from "@/lib/rolling-request";

export const dynamic = "force-dynamic";

/**
 * GET /api/options/rolling?segment=NSE_FNO&securityId=13&instrument=OPTIDX&expiryFlag=WEEK&expiryCode=1&width=0&interval=5&from=…&to=…
 * → { ok, rows }: expired option bars at the rolling strike, call at ATM+width and put at ATM−width.
 */
export async function GET(req: NextRequest) {
  const query = parseRollingQuery(req.nextUrl.searchParams, istToday());
  if (typeof query === "string") return NextResponse.json({ ok: false, error: query }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, rows: await rollingHistory(query) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
