"use client";

import { useEffect, useState } from "react";
import {
  beginOAuthLogin,
  createOAuthClientVerifier,
  getAvailableOAuthProviders,
  isValidOAuthAuthorizationUrl,
  OAUTH_CLIENT_VERIFIER_KEY,
  type OAuthProvider,
} from "@/lib/oauth";

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
  github: "GitHub",
};

export default function OAuthSignInButtons({
  returnTo,
}: {
  returnTo: string;
}) {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSignIn = async (provider: OAuthProvider) => {
    try {
      setPending(true);
      setError(null);
      const clientVerifier = createOAuthClientVerifier();
      window.sessionStorage.setItem(OAUTH_CLIENT_VERIFIER_KEY, clientVerifier);
      const authorizationUrl = await beginOAuthLogin(
        provider,
        clientVerifier,
        returnTo,
      );
      if (!isValidOAuthAuthorizationUrl(provider, authorizationUrl)) {
        throw new Error("The provider returned an invalid sign-in address.");
      }
      window.location.assign(authorizationUrl);
    } catch {
      window.sessionStorage.removeItem(OAUTH_CLIENT_VERIFIER_KEY);
      setPending(false);
      setError("Could not start social sign-in. Please try again.");
    }
  };

  useEffect(() => {
    let active = true;
    getAvailableOAuthProviders()
      .then((availableProviders) => {
        if (active) setProviders(availableProviders);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (unavailable) {
    return (
      <p className="mt-4 text-center text-xs text-muted" role="status">
        Social sign-in is currently unavailable.
      </p>
    );
  }

  if (providers.length === 0) return null;

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-5">
      <p className="text-xs text-muted">Or continue with a linked account</p>
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => void startSignIn(provider)}
          disabled={pending}
          className="flex w-full items-center justify-center rounded-xl border border-border bg-background px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-border/40 focus:outline-none focus:ring-2 focus:ring-brand/50"
        >
          Continue with {PROVIDER_LABELS[provider]}
        </button>
      ))}
      {error && (
        <p className="text-center text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted">
        Link a provider to your wallet account from Settings before using it to
        sign in.
      </p>
    </div>
  );
}
