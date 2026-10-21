"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Fingerprint, Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { useSession } from "@/context/SessionProvider";
import { loginWithPasskey, PasskeyLoginError } from "@/lib/passkey";
import { SESSION_EXPIRED_PARAM } from "@/context/SessionProvider";
import {
  exchangeOAuthCode,
  OAUTH_CLIENT_VERIFIER_KEY,
} from "@/lib/oauth";
import OAuthSignInButtons from "@/components/auth/OAuthSignInButtons";

function safeLocalPath(value: string | null, fallback: string): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }
  const destination = new URL(value, "https://stow.invalid");
  if (destination.origin !== "https://stow.invalid") return fallback;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession } = useSession();
  const oauthError = searchParams.get("oauth_error");
  const [status, setStatus] = useState<"idle" | "pending" | "error">(
    oauthError ? "error" : "idle",
  );
  const [error, setError] = useState<string | null>(() => {
    if (oauthError === "not_linked") {
      return "This provider is not linked to a Stow account. Sign in with your wallet and link it from Settings first.";
    }
    if (oauthError === "cancelled") return "Social sign-in was cancelled.";
    return oauthError ? "Social sign-in failed. Please try again." : null;
  });
  const processedOAuthCode = useRef<string | null>(null);

  const sessionExpired = searchParams.get(SESSION_EXPIRED_PARAM) === "1";
  const returnTo = safeLocalPath(searchParams.get("returnTo"), "/savings");

  useEffect(() => {
    const callbackParams = new URLSearchParams(window.location.hash.slice(1));
    const oauthCode = callbackParams.get("oauth_code");
    if (!oauthCode) {
      if (oauthError) {
        window.sessionStorage.removeItem(OAUTH_CLIENT_VERIFIER_KEY);
      }
      return;
    }
    if (processedOAuthCode.current === oauthCode) return;
    processedOAuthCode.current = oauthCode;
    const safeReturnTo = safeLocalPath(
      callbackParams.get("returnTo"),
      returnTo,
    );
    window.history.replaceState(null, "", window.location.pathname);
    const clientVerifier = window.sessionStorage.getItem(
      OAUTH_CLIENT_VERIFIER_KEY,
    );
    window.sessionStorage.removeItem(OAUTH_CLIENT_VERIFIER_KEY);

    Promise.resolve()
      .then(() => {
        if (!clientVerifier) {
          setStatus("error");
          setError(
            "Could not verify this social sign-in attempt. Please try again.",
          );
          return null;
        }
        setStatus("pending");
        setError(null);
        return exchangeOAuthCode(oauthCode, clientVerifier);
      })
      .then((result) => {
        if (!result) return;
        const { access_token, user } = result;
        setSession(access_token, { id: user.id }, user.stellar_address);
        router.replace(safeReturnTo);
      })
      .catch(() => {
        setStatus("error");
        setError("Could not complete social sign-in. Please try again.");
      });
  }, [oauthError, returnTo, router, setSession]);

  const handleLogin = async () => {
    setStatus("pending");
    setError(null);

    try {
      const { access_token, user } = await loginWithPasskey();
      setSession(access_token, { id: user.id }, user.stellar_address);
      router.push(returnTo);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof PasskeyLoginError
          ? err.message
          : "Something went wrong logging in. Please try again.",
      );
      return;
    }
    setStatus("idle");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand/20 to-brand-2/20 text-brand ring-1 ring-inset ring-brand/20">
            <Fingerprint className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-xl font-semibold text-foreground">
            Log in with your passkey
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Use the passkey on this device to sign in securely, no password
            required.
          </p>

          {sessionExpired && status !== "error" && (
            <div
              role="status"
              className="mt-6 flex items-center gap-2 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-left text-sm text-yellow-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              Your session expired. Please log in again.
            </div>
          )}

          {status === "error" && error && (
            <div
              role="alert"
              className="mt-6 flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-left text-sm text-red-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={status === "pending"}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-2 px-6 py-3.5 text-sm font-semibold text-background shadow-lg shadow-brand/25 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {status === "pending" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for passkey…
              </>
            ) : (
              <>
                <Fingerprint className="h-4 w-4" />
                Continue with passkey
              </>
            )}
          </button>

          <OAuthSignInButtons returnTo={returnTo} />
        </div>
      </div>
    </div>
  );
}
