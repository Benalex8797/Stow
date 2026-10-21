"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Fingerprint, Loader2, Wallet } from "lucide-react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import Logo from "@/components/Logo";
import { useSession } from "@/context/SessionProvider";
import { connectAndVerifyWallet, WalletConnectError } from "@/lib/wallet";
import { registerPasskey } from "@/lib/passkey";
import { apiFetch } from "@/lib/api";

const DASHBOARD_PATH = "/dashboard";

/**
 * Signup: creates a brand-new Stow account and sets it up for fast,
 * passwordless logins going forward.
 *
 * There is no endpoint that creates a user from a passkey alone - passkey
 * registration (POST /api/v1/auth/passkey/register/*) requires an existing
 * session (see auth.controller.ts). The account-creation primitive is a
 * Stellar wallet signature: POST /api/v1/auth/challenge + /verify, which
 * auto-creates the user record for a first-time stellar_address (see
 * verifySignature in auth.service.ts). So "sign up with a passkey" here
 * means: connect the wallet and sign the challenge to create the account
 * and establish a session, then immediately register a passkey against
 * that fresh session so the wallet-signing step isn't needed again next
 * time. If passkeys aren't supported in this browser, account creation
 * still succeeds via the wallet step alone - the passkey step is skipped
 * with a clear message rather than failing the whole signup.
 */
export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession } = useSession();
  const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const passkeysSupported = browserSupportsWebAuthn();
  const referralCode = searchParams.get("ref");

  const handleSignup = async () => {
    setStatus("pending");
    setError(null);

    try {
      const { access_token, is_new_user, user } = await connectAndVerifyWallet();
      setSession(access_token, { id: user.id }, user.stellar_address);

      if (is_new_user && referralCode && referralCode !== user.id) {
        try {
          await apiFetch("/api/users/me/referrals/claim", {
            method: "POST",
            body: JSON.stringify({ referrer_id: referralCode }),
          });
        } catch {
          // Referral attribution must not prevent account setup from completing.
        }
      }

      if (passkeysSupported) {
        try {
          await registerPasskey();
        } catch {
          // The account was already created and the session is live - a
          // failed/cancelled passkey step shouldn't strand the new user.
          // They can add a passkey later from settings, so we swallow the
          // error here rather than failing signup over it.
        }
      }

      router.push(DASHBOARD_PATH);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof WalletConnectError
          ? err.message
          : "Something went wrong creating your account. Please try again.",
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
            Create your account
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Connect your Stellar wallet to create an account, then set up a
            passkey so you can skip wallet-signing next time.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            You can link Google, Apple, or GitHub sign-in to your wallet
            account later from Settings.
          </p>

          {!passkeysSupported && status !== "error" && (
            <div
              role="status"
              className="mt-6 flex items-center gap-2 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-left text-sm text-yellow-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              This browser doesn&apos;t support passkeys. You can still sign
              up with your wallet, and add a passkey later from a supported
              browser.
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
            onClick={handleSignup}
            disabled={status === "pending"}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-2 px-6 py-3.5 text-sm font-semibold text-background shadow-lg shadow-brand/25 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {status === "pending" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Setting up your account…
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4" />
                Sign up with your wallet
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
