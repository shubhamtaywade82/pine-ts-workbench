import { NextRequest, NextResponse } from "next/server";
import { connectCoindcxWs } from "@/lib/coindcx-ws";

export const dynamic = "force-dynamic";

function getCredentials(req: NextRequest) {
  const apiKey = req.headers.get("x-coindcx-apikey") || req.nextUrl.searchParams.get("apiKey") || process.env.COINDCX_API_KEY || "";
  const apiSecret = req.headers.get("x-coindcx-secret") || req.nextUrl.searchParams.get("apiSecret") || process.env.COINDCX_API_SECRET || "";
  return { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
}

function createCoindcxSseStream(apiKey: string, apiSecret: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let wsCleanup: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const teardown = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (wsCleanup) { wsCleanup(); wsCleanup = null; }
  };
  signal.addEventListener("abort", teardown);

  return new ReadableStream({
    start(controller) {
      const emit = (event: string, payload: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)); } catch {}
      };
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch {}
      }, 15000);
      wsCleanup = connectCoindcxWs(apiKey, apiSecret, {
        onStatusChange: (status) => emit("status", status),
        onPositionUpdate: (pos) => emit("positions", pos),
        onOrderUpdate: (ord) => emit("orders", ord),
        onBalanceUpdate: (bal) => emit("balances", bal),
      });
    },
    cancel: teardown,
  });
}

/** GET /api/coindcx/stream → Server-side SSE bridge for CoinDCX private WebSocket. */
export async function GET(req: NextRequest) {
  const { apiKey, apiSecret } = getCredentials(req);
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: "Missing CoinDCX API credentials" }, { status: 400 });
  }

  const stream = createCoindcxSseStream(apiKey, apiSecret, req.signal);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
