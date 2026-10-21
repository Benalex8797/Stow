import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRouter, useSearchParams } from "next/navigation";
import { SessionProvider } from "@/context/SessionProvider";
import { loginWithPasskey, PasskeyLoginError } from "@/lib/passkey";
import { apiRequest } from "@/lib/api";
import {
  beginOAuthLogin,
  OAUTH_CLIENT_VERIFIER_KEY,
} from "@/lib/oauth";
import LoginPage from "./page";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/login"),
  useSearchParams: vi.fn(),
}));

vi.mock("@/lib/passkey", async () => {
  const actual = await vi.importActual<typeof import("@/lib/passkey")>("@/lib/passkey");
  return { ...actual, loginWithPasskey: vi.fn() };
});

const mockLoginWithPasskey = loginWithPasskey as unknown as ReturnType<typeof vi.fn>;
const mockApiRequest = apiRequest as unknown as ReturnType<typeof vi.fn>;

function renderLoginPage(params: Record<string, string> = {}) {
  (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    new URLSearchParams(params),
  );
  return render(
    <SessionProvider>
      <LoginPage />
    </SessionProvider>,
  );
}

describe("LoginPage", () => {
  const mockPush = vi.fn();
  const mockReplace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({
      success: true,
      data: { providers: ["google", "apple", "github"] },
      timestamp: new Date().toISOString(),
    });
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/login");
  });

  it("renders a passkey login prompt", async () => {
    renderLoginPage();
    expect(
      screen.getByRole("button", { name: /continue with passkey/i }),
    ).toBeInTheDocument();
    await screen.findByRole("button", { name: /continue with google/i });
  });

  it("shows configured social sign-in providers", async () => {
    renderLoginPage();

    expect(
      await screen.findByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with apple/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with github/i }),
    ).toBeInTheDocument();
  });

  it("starts social sign-in with a browser verifier in the POST body", async () => {
    mockApiRequest.mockResolvedValue({
      success: true,
      data: {
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
      },
      timestamp: new Date().toISOString(),
    });

    await expect(
      beginOAuthLogin("google", "a".repeat(64), "/settings"),
    ).resolves.toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/v1/auth/oauth/google/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_verifier: "a".repeat(64),
          return_to: "/settings",
        }),
      }),
    );
  });

  it("shows a session-expired notice when redirected here after a 401", async () => {
    renderLoginPage({ session_expired: "1" });
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    await screen.findByRole("button", { name: /continue with google/i });
  });

  it("logs in and routes to the dashboard on a successful mocked assertion", async () => {
    mockLoginWithPasskey.mockResolvedValue({
      access_token: "token-1",
      refresh_token: "refresh-1",
      user: { id: "user-1", stellar_address: "GADDR1" },
    });

    renderLoginPage();
    fireEvent.click(screen.getByRole("button", { name: /continue with passkey/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/savings"));
  });

  it("routes to a returnTo path when one was provided", async () => {
    mockLoginWithPasskey.mockResolvedValue({
      access_token: "token-1",
      refresh_token: "refresh-1",
      user: { id: "user-1", stellar_address: "GADDR1" },
    });

    renderLoginPage({ returnTo: "/settings" });
    fireEvent.click(screen.getByRole("button", { name: /continue with passkey/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/settings"));
  });

  it("exchanges a one-time OAuth callback code and routes to its local return path", async () => {
    window.sessionStorage.setItem(OAUTH_CLIENT_VERIFIER_KEY, "a".repeat(64));
    window.history.replaceState(
      null,
      "",
      "/login#oauth_code=one-time-code&returnTo=%2Fsettings",
    );
    mockApiRequest.mockImplementation((url: string) => {
      if (url === "/api/v1/auth/oauth/providers") {
        return Promise.resolve({
          success: true,
          data: { providers: [] },
          timestamp: new Date().toISOString(),
        });
      }
      return Promise.resolve({
        success: true,
        data: {
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          user: { id: "oauth-user", stellar_address: "GADDR1" },
        },
        timestamp: new Date().toISOString(),
      });
    });

    renderLoginPage();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/settings"));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/v1/auth/oauth/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          code: "one-time-code",
          code_verifier: "a".repeat(64),
        }),
      }),
    );
  });

  it("rejects an OAuth callback without the initiating browser verifier", async () => {
    window.history.replaceState(null, "", "/login#oauth_code=one-time-code");
    renderLoginPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not verify this social sign-in attempt/i,
    );
    expect(mockApiRequest).not.toHaveBeenCalledWith(
      "/api/v1/auth/oauth/exchange",
      expect.anything(),
    );
  });

  it("shows a clear error message when the passkey prompt is cancelled", async () => {
    mockLoginWithPasskey.mockRejectedValue(
      new PasskeyLoginError("Passkey login was cancelled or timed out.", true),
    );

    renderLoginPage();
    fireEvent.click(screen.getByRole("button", { name: /continue with passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled/i);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a clear error message when the assertion fails outright", async () => {
    mockLoginWithPasskey.mockRejectedValue(
      new PasskeyLoginError("That passkey wasn't recognized, or the login attempt expired. Please try again."),
    );

    renderLoginPage();
    fireEvent.click(screen.getByRole("button", { name: /continue with passkey/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wasn't recognized/i);
  });

  it("disables the button while the login attempt is pending", async () => {
    let resolvePromise: (value: unknown) => void = () => {};
    mockLoginWithPasskey.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );

    renderLoginPage();
    const button = screen.getByRole("button", { name: /continue with passkey/i });
    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: /waiting for passkey/i })).toBeDisabled();

    await act(async () => {
      resolvePromise({
        access_token: "token-1",
        refresh_token: "refresh-1",
        user: { id: "user-1", stellar_address: "GADDR1" },
      });
    });
  });
});
