import { apiRequest } from "@/lib/api";

export const OAUTH_PROVIDERS = ["google", "apple", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const OAUTH_CLIENT_VERIFIER_KEY = "stow_oauth_client_verifier";

export function createOAuthClientVerifier(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
}

function isSuccessEnvelope<T>(
  result: unknown,
): result is ApiSuccessEnvelope<T> {
  return (
    typeof result === "object" &&
    result !== null &&
    "success" in result &&
    result.success === true &&
    "data" in result
  );
}

async function oauthRequest<T>(
  url: string,
  init?: Parameters<typeof apiRequest>[1],
): Promise<T> {
  const result = await apiRequest<T | ApiSuccessEnvelope<T>>(url, init);
  return isSuccessEnvelope<T>(result) ? result.data : result;
}

const AUTHORIZATION_HOSTS: Record<OAuthProvider, string> = {
  google: "accounts.google.com",
  apple: "appleid.apple.com",
  github: "github.com",
};

export function isValidOAuthAuthorizationUrl(
  provider: OAuthProvider,
  value: string,
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === AUTHORIZATION_HOSTS[provider] &&
      url.pathname.length > 0
    );
  } catch {
    return false;
  }
}

export async function beginOAuthLogin(
  provider: OAuthProvider,
  clientVerifier: string,
  returnTo = "/savings",
): Promise<string> {
  const result = await oauthRequest<{ authorization_url: string }>(
    `/api/v1/auth/oauth/${provider}/start`,
    {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({
        client_verifier: clientVerifier,
        return_to: returnTo,
      }),
    },
  );
  return result.authorization_url;
}

export async function getAvailableOAuthProviders(): Promise<OAuthProvider[]> {
  const result = await oauthRequest<{ providers: OAuthProvider[] }>(
    "/api/v1/auth/oauth/providers",
    { skipAuth: true },
  );
  return result.providers.filter((provider) =>
    OAUTH_PROVIDERS.includes(provider),
  );
}

export async function exchangeOAuthCode(code: string, codeVerifier: string) {
  return oauthRequest<{
    access_token: string;
    refresh_token: string;
    user: { id: string; stellar_address: string };
  }>("/api/v1/auth/oauth/exchange", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
}

export async function getLinkedOAuthProviders(): Promise<OAuthProvider[]> {
  const result = await oauthRequest<{ providers: OAuthProvider[] }>(
    "/api/v1/auth/oauth/identities",
  );
  return result.providers.filter((provider) =>
    OAUTH_PROVIDERS.includes(provider),
  );
}

export async function beginOAuthLink(
  provider: OAuthProvider,
  clientVerifier: string,
): Promise<string> {
  const result = await oauthRequest<{ authorization_url: string }>(
    `/api/v1/auth/oauth/${provider}/link/start`,
    {
      method: "POST",
      body: JSON.stringify({ client_verifier: clientVerifier }),
    },
  );
  return result.authorization_url;
}
