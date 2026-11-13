import { DhanClient, FileTokenStore, TokenManager } from "@nemesis-oss/dhanhq-sdk";
import { assertUsableToken, createTotpProvider, DhanTokenProvider } from "@/lib/dhan-token";

/**
 * Server-only DhanHQ client. Its access token comes from algo_scalper_api when that is configured
 * and running (see `dhan-token.ts` for why), and from our own PIN + TOTP login otherwise.
 *
 * Environment:
 *   DHAN_CLIENT_ID, DHAN_PIN, DHAN_TOTP_SECRET
 *                         our own login; required unless algo_scalper_api is always up
 *   DHAN_AUTHORITY_TOKEN  algo_scalper_api's API_OPERATOR_TOKEN; leave unset to log in on our own only
 *   DHAN_AUTHORITY_URL    algo_scalper_api base URL            (default http://localhost:3011)
 *   DHAN_TOKEN_CACHE_DIR  where our own token is kept between restarts (default ~/.dhanhq)
 *
 * Our own token is cached on disk and renewed before it expires, so a restart reuses it instead of
 * spending a PIN + TOTP login (each login can invalidate the token another app holds).
 */

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

interface Shared {
  readonly provider: DhanTokenProvider;
  client?: Promise<DhanClient>;
  /** Set once the client exists: the token manager reuses the client's HTTP settings. */
  config?: ReturnType<DhanClient["getConfig"]>;
  manager?: TokenManager;
}

let shared: Shared | undefined;

const ownTokens = (state: Shared): TokenManager => {
  const clientId = requireEnv("DHAN_CLIENT_ID");
  if (state.config === undefined) throw new Error("Dhan client is not ready for its own login");
  state.manager ??= new TokenManager(state.config, {
    clientId,
    pin: requireEnv("DHAN_PIN"),
    totpProvider: createTotpProvider(requireEnv("DHAN_TOTP_SECRET")),
    store: new FileTokenStore(),
  });
  return state.manager;
};

const ownLogin = async (state: Shared) => {
  const manager = ownTokens(state);
  const accessToken = await manager.ensureValidToken();
  const { expiresAt } = assertUsableToken(manager.getToken(), Date.now());
  return { accessToken, expiresAt };
};

const state = (): Shared => {
  shared ??= (() => {
    const created: Shared = {
      provider: new DhanTokenProvider({
        authorityBaseUrl: process.env.DHAN_AUTHORITY_URL?.trim() || "http://localhost:3011",
        operatorToken: process.env.DHAN_AUTHORITY_TOKEN?.trim() || undefined,
        generate: () => ownLogin(created),
        rejectOwn: async () => { await created.manager?.handleUnauthorized(); },
      }),
    };
    return created;
  })();
  return shared;
};

export const dhanTokenProvider = (): DhanTokenProvider => state().provider;

/** One shared client per server process, so every request reuses the same token. */
export const getDhanClient = (): Promise<DhanClient> => {
  const current = state();
  current.client ??= (async () => {
    const envClientId = process.env.DHAN_CLIENT_ID?.trim();
    // Without DHAN_CLIENT_ID the authority has to supply the id, so ask it before building the client.
    if (envClientId === undefined || envClientId === "") await current.provider.get();
    const client = new DhanClient({
      clientId: current.provider.clientId() ?? requireEnv("DHAN_CLIENT_ID"),
      tokenProvider: current.provider.get,
      onTokenExpired: current.provider.onTokenExpired,
    });
    current.config = client.getConfig();
    await current.provider.get(); // fail here, with the real reason, instead of on the first chart request
    return client;
  })().catch((error: unknown) => {
    current.client = undefined; // a failed login is retried on the next request, not cached for good
    throw error;
  });
  return current.client;
};
