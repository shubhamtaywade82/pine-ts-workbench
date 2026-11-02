import { describe, expect, it } from "bun:test";
import { AuthorityError, DhanTokenProvider } from "./dhan-token";

const HOUR = 3_600_000;

interface Harness {
  readonly provider: DhanTokenProvider;
  readonly calls: { authority: number; generate: number };
  readonly clock: { now: number };
  authorityDown: boolean;
  authorityStatus: number;
}

const harness = (overrides: Partial<{ safetyMs: number; reprobeMs: number }> = {}): Harness => {
  const state = { authorityDown: false, authorityStatus: 200 };
  const calls = { authority: 0, generate: 0 };
  const clock = { now: 1_000_000 };
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.authority++;
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer operator-secret");
    if (state.authorityDown) throw new TypeError("connect ECONNREFUSED 127.0.0.1:3011");
    if (state.authorityStatus !== 200) return new Response("{}", { status: state.authorityStatus });
    return Response.json({
      access_token: "shared-token",
      expires_at: new Date(clock.now + 6 * HOUR).toISOString(),
      client_id: "1100",
    });
  }) as unknown as typeof fetch;

  const provider = new DhanTokenProvider({
    authorityBaseUrl: "http://localhost:3011/",
    operatorToken: "operator-secret",
    fetchImpl,
    now: () => clock.now,
    generate: async () => {
      calls.generate++;
      return { accessToken: "own-token", expiresAt: clock.now + 6 * HOUR };
    },
    ...overrides,
  });

  return Object.assign(state, { provider, calls, clock }) as Harness;
};

describe("DhanTokenProvider", () => {
  it("uses algo_scalper_api's token and never generates its own while it is running", async () => {
    const h = harness();

    expect(await h.provider.get()).toBe("shared-token");

    expect(h.provider.source()).toBe("algo_scalper_api");
    expect(h.provider.clientId()).toBe("1100");
    expect(h.calls.generate).toBe(0);
  });

  it("reuses the cached shared token without asking again until it nears expiry", async () => {
    const h = harness();
    await h.provider.get();
    await h.provider.get();
    expect(h.calls.authority).toBe(1);

    h.clock.now += 6 * HOUR - 60_000; // inside the 2-minute safety window
    await h.provider.get();
    expect(h.calls.authority).toBe(2);
    expect(h.calls.generate).toBe(0);
  });

  it("generates its own token only when the connection to algo_scalper_api fails", async () => {
    const h = harness();
    h.authorityDown = true;

    expect(await h.provider.get()).toBe("own-token");

    expect(h.provider.source()).toBe("own");
    expect(h.calls.generate).toBe(1);
  });

  it("does NOT generate when algo_scalper_api answers with an error: it is running and owns the token", async () => {
    const h = harness();
    h.authorityStatus = 503;

    await expect(h.provider.get()).rejects.toBeInstanceOf(AuthorityError);
    expect(h.calls.generate).toBe(0);

    h.authorityStatus = 401;
    await expect(h.provider.get()).rejects.toMatchObject({ status: 401 });
    expect(h.calls.generate).toBe(0);
  });

  it("switches back to algo_scalper_api once it is reachable again, instead of keeping its own token", async () => {
    const h = harness({ reprobeMs: 30_000 });
    h.authorityDown = true;
    await h.provider.get();
    expect(h.provider.source()).toBe("own");

    h.authorityDown = false;
    h.clock.now += 10_000;
    expect(await h.provider.get()).toBe("own-token"); // not re-probed yet

    h.clock.now += 25_000;
    expect(await h.provider.get()).toBe("shared-token");
    expect(h.provider.source()).toBe("algo_scalper_api");
    expect(h.calls.generate).toBe(1);
  });

  it("keeps a still-valid own token if algo_scalper_api is probed and still down", async () => {
    const h = harness({ reprobeMs: 30_000 });
    h.authorityDown = true;
    await h.provider.get();

    h.clock.now += 31_000;
    await h.provider.get();

    expect(h.calls.generate).toBe(1);
  });

  it("re-asks the authority after a 401 instead of renewing the shared token itself", async () => {
    const h = harness();
    await h.provider.get();

    h.provider.onTokenExpired();
    await h.provider.get();

    expect(h.calls.authority).toBe(2);
    expect(h.calls.generate).toBe(0);
  });

  it("coalesces concurrent callers into a single authority request", async () => {
    const h = harness();

    await Promise.all([h.provider.get(), h.provider.get(), h.provider.get()]);

    expect(h.calls.authority).toBe(1);
  });
});
