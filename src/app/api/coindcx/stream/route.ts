import { NextRequest, NextResponse } from "next/server";
import { io, type Socket } from "socket.io-client";
import { signCoindcxWsAuth } from "@/lib/coindcx-ws";

export const dynamic = "force-dynamic";

function getCredentials(req: NextRequest) {
  const apiKey = req.headers.get("x-coindcx-apikey") || req.nextUrl.searchParams.get("apiKey") || process.env.COINDCX_API_KEY || "";
  const apiSecret = req.headers.get("x-coindcx-secret") || req.nextUrl.searchParams.get("apiSecret") || process.env.COINDCX_API_SECRET || "";
  return { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
}

function bindSocketEvents(socket: Socket, emit: (event: string, payload: unknown) => void, onDisconnect: () => void) {
  socket.on("df-position-update", (data) => emit("positions", data));
  socket.on("df-order-update", (data) => emit("orders", data));
  socket.on("balance-update", (data) => emit("balances", data));
  socket.on("disconnect", () => {
    emit("status", "polling");
    onDisconnect();
  });
  socket.on("connect_error", () => {
    emit("status", "polling");
    onDisconnect();
  });
}

function createCoindcxSseStream(apiKey: string, apiSecret: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let socket: Socket | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const teardown = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (socket) { socket.disconnect(); socket = null; }
  };
  signal.addEventListener("abort", teardown);

  return new ReadableStream({
    async start(controller) {
      const emit = (event: string, payload: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)); } catch {}
      };
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch {}
      }, 15000);
      try {
        const sig = await signCoindcxWsAuth(apiSecret);
        socket = io("wss://stream.coindcx.com", {
          transports: ["websocket"],
          reconnection: false,
          timeout: 8000,
        });
        socket.on("connect", () => {
          socket?.emit("join", { channelName: "coindcx", authSignature: sig, apiKey });
          emit("status", "live");
        });
        bindSocketEvents(socket, emit, teardown);
      } catch {
        emit("status", "polling");
        teardown();
      }
    },
    cancel: teardown,
  });
}

/** GET /api/coindcx/stream → Server-side Socket.IO bridge to client SSE stream. */
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
