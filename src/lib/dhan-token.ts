/**
 * Dhan access-token source for the workbench: reuse algo_scalper_api's live token, and only
 * mint one of our own when algo_scalper_api is not running.
 *
 * Why: Dhan issues one active token per login. Generating a token invalidates every other
 * holder (they start failing with DH-906 "Invalid Token"), so two apps that each log in take
 * turns knocking each other out. algo_scalper_api owns the token and shares it read-only at
 * `GET /api/dhan/token`; this module is a consumer of that and never renews it.
 *
 * "Not running" means exactly one thing: the connection to algo_scalper_api failed. Any HTTP
 * answer (401 bad token, 503 no live token yet) means it IS running, so we surface the error
 * instead of logging in and invalidating the token it holds.
 *
 * Server-side only — the token can place live orders and must never reach the browser.
 */

import { DhanAuth } from "@nemesis-oss/dhanhq-sdk";

export type TokenSource = "algo_scalper_api" | "own";

export interface DhanTokenProviderOptions {
  /** algo_scalper_api base URL, e.g. http://localhost:3011. Omit with `operatorToken` to log in on our own only. */
  readonly authorityBaseUrl?: string;
  /** algo_scalper_api's API_OPERATOR_TOKEN. */
  readonly operatorToken?: string;
  /** Mints a token when the authority is unreachable or not configured; resolves the token and its expiry (epoch ms). */
  readonly generate: () => Promise<{ readonly accessToken: string; readonly expiresAt: number }>;
  /** Called when our own token is rejected (401), so its owner can drop it and log in again. */
  readonly rejectOwn?: () => Promise<void>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  /** Treat a token as expired this long before it really is. Default 2 minutes. */
  readonly safetyMs?: number;
  /** While on our own token, how often to check whether algo_scalper_api came back. Default 30 s. */
  readonly reprobeMs?: number;
  /** Per-request timeout for the authority. Default 2 s. */
  readonly timeoutMs?: number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly source: TokenSource;
  readonly clientId?: string;
}

export class AuthorityError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthorityError";
  }
}

const DEFAULT_SAFETY_MS = 120_000;
const DEFAULT_REPROBE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 2_000;

export class DhanTokenProvider {
  private cached: CachedToken | undefined;
  private lastProbeAt = 0;
  private inFlight: Promise<CachedToken> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  public constructor(private readonly options: DhanTokenProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Usable access token; plug into `DhanClientConfig.tokenProvider`. */
  public readonly get = async (): Promise<string> => (await this.resolve()).accessToken;

  /** Where the current token came from, once one has been obtained. */
  public source(): TokenSource | undefined {
    return this.cached?.source;
  }

  /** Dhan client id reported by algo_scalper_api, if the token came from it. */
  public clientId(): string | undefined {
    return this.cached?.clientId;
  }

  /**
   * A request was rejected with 401; plug into `DhanClientConfig.onTokenExpired`.
   * Drops the cached token so the next `get()` re-asks the authority. It never renews a shared
   * token itself: algo_scalper_api owns renewal. Our own token is handed to `rejectOwn`, since its
   * owner may still hold the rejected copy and would otherwise serve it again.
   */
  public readonly onTokenExpired = async (): Promise<void> => {
    const rejected = this.cached;
    this.cached = undefined;
    if (rejected?.source === "own") await this.options.rejectOwn?.();
  };

  private resolve(): Promise<CachedToken> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async load(): Promise<CachedToken> {
    const current = this.cached;
    if (current !== undefined && this.isFresh(current) && !this.shouldReprobe(current)) return current;

    const shared = await this.tryAuthority();
    if (shared !== undefined) return (this.cached = shared);
    if (current !== undefined && this.isFresh(current)) return current;
    return (this.cached = await this.generateOwn());
  }

  private isFresh(token: CachedToken): boolean {
    return token.expiresAt - (this.options.safetyMs ?? DEFAULT_SAFETY_MS) > this.now();
  }

  private shouldReprobe(token: CachedToken): boolean {
    return token.source === "own" && this.now() - this.lastProbeAt >= (this.options.reprobeMs ?? DEFAULT_REPROBE_MS);
  }

  /** The shared token, or undefined when the connection failed (algo_scalper_api not running). */
  private async tryAuthority(): Promise<CachedToken | undefined> {
    this.lastProbeAt = this.now();
    const { authorityBaseUrl, operatorToken } = this.options;
    if (authorityBaseUrl === undefined || operatorToken === undefined) return undefined;
    let response: Response;
    try {
      response = await this.fetchImpl(`${authorityBaseUrl.replace(/\/$/, "")}/api/dhan/token`, {
        headers: { Authorization: `Bearer ${operatorToken}` },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return undefined;
    }
    if (!response.ok) {
      throw new AuthorityError(`algo_scalper_api refused to share its Dhan token (HTTP ${response.status})`, response.status);
    }
    const body = (await response.json()) as { access_token?: string; expires_at?: string; client_id?: string };
    if (!body.access_token || !body.expires_at) throw new AuthorityError("algo_scalper_api token response is incomplete", response.status);
    return {
      accessToken: body.access_token,
      expiresAt: Date.parse(body.expires_at),
      source: "algo_scalper_api",
      clientId: body.client_id,
    };
  }

  private async generateOwn(): Promise<CachedToken> {
    const { accessToken, expiresAt } = await this.options.generate();
    return { accessToken, expiresAt, source: "own" };
  }
}

/** A code generated with fewer seconds than this left in its window can arrive after the roll-over and be rejected. */
export const TOTP_MIN_VALID_SECONDS = 5;

/** Supplies a fresh TOTP code per login, waiting for the next window when the current one is nearly over. */
export const createTotpProvider = (
  secret: string,
  clock: { readonly now?: () => number; readonly sleep?: (ms: number) => Promise<void> } = {},
): (() => Promise<string>) => {
  const now = clock.now ?? Date.now;
  const sleep = clock.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async () => {
    const remaining = DhanAuth.totpSecondsRemaining({ timestamp: now() });
    // The extra second lands the wait inside the next window.
    if (remaining < TOTP_MIN_VALID_SECONDS) await sleep((remaining + 1) * 1000);
    return DhanAuth.generateTotp(secret, { timestamp: now() });
  };
};

/**
 * Refuses a token with no usable expiry: the SDK treats it as always due for renewal, so every request
 * would start a fresh PIN+TOTP login, and each login can invalidate the token before it.
 */
export const assertUsableToken = (token: { readonly expiresAt?: number } | undefined, now: number): { readonly expiresAt: number } => {
  if (token === undefined) throw new Error("Dhan login returned no token");
  const { expiresAt } = token;
  if (expiresAt === undefined || !Number.isFinite(expiresAt)) {
    throw new Error("Dhan login returned a token without an expiry; refusing it, since every request would start a fresh PIN+TOTP login");
  }
  if (now >= expiresAt) {
    throw new Error(`Dhan login returned a token that already expired (${new Date(expiresAt).toISOString()}); check the host clock`);
  }
  return { expiresAt };
};
