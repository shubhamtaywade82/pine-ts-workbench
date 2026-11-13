import { describe, expect, it } from "bun:test";
import { assertUsableToken, AuthorityError, createTotpProvider, DhanTokenProvider, TOTP_MIN_VALID_SECONDS } from "./dhan-token";

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

describe("without an authority configured", () => {
  const ownOnly = (rejectOwn?: () => Promise<void>) => {
    const calls = { fetch: 0, generate: 0 };
    const provider = new DhanTokenProvider({
      fetchImpl: (async () => { calls.fetch++; throw new Error("must not be called"); }) as unknown as typeof fetch,
      generate: async () => { calls.generate++; return { accessToken: "own-token", expiresAt: Date.now() + 6 * HOUR }; },
      rejectOwn,
    });
    return { provider, calls };
  };

  it("logs in on its own and never contacts an authority", async () => {
    const { provider, calls } = ownOnly();

    expect(await provider.get()).toBe("own-token");
    expect(provider.source()).toBe("own");
    expect(calls).toEqual({ fetch: 0, generate: 1 });
  });

  it("tells the owner of our own token when it is rejected, then logs in again", async () => {
    let rejected = 0;
    const { provider, calls } = ownOnly(async () => { rejected++; });
    await provider.get();

    await provider.onTokenExpired();
    await provider.get();

    expect(rejected).toBe(1);
    expect(calls.generate).toBe(2);
  });
});

describe("createTotpProvider", () => {
  const SECRET = "JBSWY3DPEHPK3PXP";
  const WINDOW_MS = 30_000;

  it("waits for the next window when the current one is nearly over", async () => {
    const clock = { now: 10 * WINDOW_MS + (WINDOW_MS - 2_000) };
    const slept: number[] = [];
    const next = createTotpProvider(SECRET, {
      now: () => clock.now,
      sleep: async (ms) => { slept.push(ms); clock.now += ms; },
    });

    const code = await next();

    expect(slept).toEqual([3_000]);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("answers at once while the window has time left", async () => {
    const slept: number[] = [];
    const next = createTotpProvider(SECRET, { now: () => 10 * WINDOW_MS + 1_000, sleep: async (ms) => { slept.push(ms); } });

    await next();

    expect(slept).toEqual([]);
    expect(TOTP_MIN_VALID_SECONDS).toBeLessThan(WINDOW_MS / 1000);
  });
});

describe("assertUsableToken", () => {
  it("accepts a token that expires later and returns its expiry", () => {
    expect(assertUsableToken({ expiresAt: 2_000 }, 1_000)).toEqual({ expiresAt: 2_000 });
  });

  it("refuses a missing token, a missing expiry and an expired token", () => {
    expect(() => assertUsableToken(undefined, 1_000)).toThrow("no token");
    expect(() => assertUsableToken({}, 1_000)).toThrow("without an expiry");
    expect(() => assertUsableToken({ expiresAt: 1_000 }, 1_000)).toThrow("already expired");
  });
});
