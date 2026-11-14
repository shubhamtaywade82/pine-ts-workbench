import { NextRequest, NextResponse } from "next/server";
import { istToday } from "@/lib/dhan-rolling";
import { heldBook, LAB_INTERVALS } from "@/lib/dhan-held";
import { parseRollingQuery } from "@/lib/rolling-request";

export const dynamic = "force-dynamic";

/** The window Dhan accepts in one call: at most two calendar days. */
const MAX_WINDOW_DAYS = 2;

/**
 * GET /api/options/held?segment=…&securityId=…&instrument=…&expiryFlag=…&expiryCode=…&from=…&to=… (one window)
 * → { ok, rows }: the call and put at every strike within reach of the money, bar by bar, for following a held contract.
 */
export async function GET(req: NextRequest) {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  if (!(LAB_INTERVALS as readonly string[]).includes(params.get("interval") ?? "")) params.set("interval", "5");
  params.set("width", "0");
  const query = parseRollingQuery(params, istToday());
  if (typeof query === "string") return NextResponse.json({ ok: false, error: query }, { status: 400 });
  const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 + 1;
  if (days > MAX_WINDOW_DAYS) return NextResponse.json({ ok: false, error: "ask for one window (at most two days) at a time" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, rows: await heldBook(query) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
