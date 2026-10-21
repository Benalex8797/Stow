"use client";

import { useEffect, useState } from "react";
import {
  beginOAuthLink,
  createOAuthClientVerifier,
  getAvailableOAuthProviders,
  getLinkedOAuthProviders,
  isValidOAuthAuthorizationUrl,
  OAUTH_CLIENT_VERIFIER_KEY,
  type OAuthProvider,
} from "@/lib/oauth";

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
  github: "GitHub",
};

export default function OAuthAccountsSettings() {
  const [available, setAvailable] = useState<OAuthProvider[]>([]);
  const [linked, setLinked] = useState<OAuthProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callbackStatus, setCallbackStatus] = useState<{
    linked: boolean;
    error: string | null;
  }>({ linked: false, error: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    if (query.has("oauth_linked") || query.has("oauth_error")) {
      window.sessionStorage.removeItem(OAUTH_CLIENT_VERIFIER_KEY);
    }
    Promise.all([getAvailableOAuthProviders(), getLinkedOAuthProviders()])
      .then(([configuredProviders, linkedProviders]) => {
        if (!active) return;
        setAvailable(configuredProviders);
        setLinked(linkedProviders);
        setLoaded(true);
        setCallbackStatus({
          linked: query.get("oauth_linked") === "1",
          error: query.get("oauth_error"),
        });
      })
      .catch(() => {
        if (active) setError("Could not load linked sign-in providers.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLink = async (provider: OAuthProvider) => {
    setPending(provider);
    setError(null);
    try {
      const clientVerifier = createOAuthClientVerifier();
      window.sessionStorage.setItem(OAUTH_CLIENT_VERIFIER_KEY, clientVerifier);
      const authorizationUrl = await beginOAuthLink(provider, clientVerifier);
      if (!isValidOAuthAuthorizationUrl(provider, authorizationUrl)) {
        throw new Error("The provider returned an invalid sign-in address.");
      }
      window.location.assign(authorizationUrl);
    } catch (linkError) {
      window.sessionStorage.removeItem(OAUTH_CLIENT_VERIFIER_KEY);
      setError(
        linkError instanceof Error
          ? linkError.message
          : "Could not start provider linking.",
      );
      setPending(null);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">
        Social sign-in
      </h2>
      <p className="mt-1 text-sm text-muted">
        Link a provider to this wallet account to use it for future sign-ins.
      </p>

      {callbackStatus.linked && (
        <p className="mt-4 text-sm text-green-400" role="status">
          Social sign-in provider linked successfully.
        </p>
      )}
      {callbackStatus.error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {callbackStatus.error === "cancelled"
            ? "Provider linking was cancelled."
            : "Could not link that provider. Please try again."}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-muted" role="status">
          Loading providers…
        </p>
      ) : loaded && available.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Social sign-in providers are not configured.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {available.map((provider) => {
            const isLinked = linked.includes(provider);
            return (
              <li
                key={provider}
                className="flex items-center justify-between gap-4 py-3"
              >
                <span className="text-sm font-medium text-foreground">
                  {PROVIDER_LABELS[provider]}
                </span>
                {isLinked ? (
                  <span className="text-sm text-green-400">Linked</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleLink(provider)}
                    disabled={pending !== null}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-border/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending === provider ? "Connecting…" : "Link"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
