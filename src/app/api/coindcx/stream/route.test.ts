import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/coindcx/stream", () => {
  it("returns 400 when credentials are missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/coindcx/stream");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("returns 200 SSE stream when credentials provided in headers", async () => {
    const req = new NextRequest("http://localhost:3000/api/coindcx/stream", {
      headers: {
        "x-coindcx-apikey": "test-key",
        "x-coindcx-secret": "test-sec",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("returns 200 SSE stream when credentials provided in query parameters", async () => {
    const req = new NextRequest("http://localhost:3000/api/coindcx/stream?apiKey=test-k&apiSecret=test-s");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
