import { DhanAuth, DhanClient } from "@nemesis-oss/dhanhq-sdk";
import { DhanTokenProvider } from "@/lib/dhan-token";

/**
 * Server-only DhanHQ client whose access token comes from algo_scalper_api when it is running
 * (see `dhan-token.ts` for why), and from our own TOTP login only when it is not.
 *
 * Environment:
 *   DHAN_AUTHORITY_URL    algo_scalper_api base URL            (default http://localhost:3011)
 *   DHAN_AUTHORITY_TOKEN  algo_scalper_api's API_OPERATOR_TOKEN (required)
 *   DHAN_CLIENT_ID, DHAN_PIN, DHAN_TOTP_SECRET
 *                         only used for the fallback login when algo_scalper_api is down
 */

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const ownLogin = async () => {
  const clientId = requireEnv("DHAN_CLIENT_ID");
  const totp = DhanAuth.generateTotp(requireEnv("DHAN_TOTP_SECRET"));
  const token = await DhanAuth.generateAccessToken({ clientId, pin: requireEnv("DHAN_PIN"), totp });
  return { accessToken: token.accessToken, expiresAt: token.expiresAt ?? Date.now() + 6 * 3_600_000 };
};

let shared: { readonly provider: DhanTokenProvider; client?: Promise<DhanClient> } | undefined;

export const dhanTokenProvider = (): DhanTokenProvider => {
  shared ??= {
    provider: new DhanTokenProvider({
      authorityBaseUrl: process.env.DHAN_AUTHORITY_URL?.trim() || "http://localhost:3011",
      operatorToken: requireEnv("DHAN_AUTHORITY_TOKEN"),
      generate: ownLogin,
    }),
  };
  return shared.provider;
};

/** One shared client per server process, so every request reuses the same token. */
export const getDhanClient = (): Promise<DhanClient> => {
  const provider = dhanTokenProvider();
  shared!.client ??= (async () => {
    await provider.get(); // learn the client id from algo_scalper_api (or fall back to env)
    return new DhanClient({
      clientId: provider.clientId() ?? requireEnv("DHAN_CLIENT_ID"),
      tokenProvider: provider.get,
      onTokenExpired: provider.onTokenExpired,
    });
  })();
  return shared!.client;
};
