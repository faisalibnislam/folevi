import { describe, expect, test } from "vitest";
import { authErrorMessage } from "@/lib/auth/client";
import { defaultPasskeyName, passkeyAutofillAvailable, passkeysAvailable } from "@/lib/auth/passkeys";

type FakeWindow = Window & typeof globalThis;

function fakeWindow({ webauthn = true, desktop = false, platform = false, autofill = false } = {}): FakeWindow {
  const PublicKeyCredential = webauthn
    ? Object.assign(function PublicKeyCredential() {}, {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => platform,
        isConditionalMediationAvailable: async () => autofill,
      })
    : undefined;
  return { PublicKeyCredential, navigator: { credentials: {} }, foleviDesktop: desktop ? { platform: "mac" } : undefined } as unknown as FakeWindow;
}

describe("passkeysAvailable", () => {
  test("browsers with WebAuthn can use passkeys, even without a built-in authenticator", async () => {
    expect(await passkeysAvailable(fakeWindow())).toBe(true);
    expect(await passkeysAvailable(fakeWindow({ webauthn: false }))).toBe(false);
    expect(await passkeysAvailable(undefined)).toBe(false);
  });

  test("the Mac app offers passkeys only when macOS lets it use this Mac's", async () => {
    expect(await passkeysAvailable(fakeWindow({ desktop: true }))).toBe(false);
    expect(await passkeysAvailable(fakeWindow({ desktop: true, platform: true }))).toBe(true);
  });

  test("autofill needs conditional mediation", async () => {
    expect(await passkeyAutofillAvailable(fakeWindow())).toBe(false);
    expect(await passkeyAutofillAvailable(fakeWindow({ autofill: true }))).toBe(true);
    expect(await passkeyAutofillAvailable(fakeWindow({ desktop: true, autofill: true }))).toBe(false);
  });
});

describe("defaultPasskeyName", () => {
  test("names the browser and system", () => {
    expect(defaultPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Safari on Mac");
    expect(defaultPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge on Windows");
    expect(defaultPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(defaultPasskeyName("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(defaultPasskeyName("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Linux");
    expect(defaultPasskeyName("")).toBe("Passkey");
  });
});

describe("passkey error messages", () => {
  test("say what happened in plain words", () => {
    expect(authErrorMessage({ code: "AUTH_CANCELLED" })).toBe("The passkey request was cancelled or timed out.");
    expect(authErrorMessage({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "The operation either timed out or was not allowed." })).toBe("The passkey request was cancelled or timed out.");
    expect(authErrorMessage({ code: "PASSKEY_NOT_FOUND" })).toMatch(/didn't work/);
    expect(authErrorMessage({ code: "SESSION_NOT_FRESH" })).toMatch(/sign in again/);
    expect(authErrorMessage({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe("This device already has a passkey for your account.");
    expect(authErrorMessage({ code: "PASSKEY_ADMIN_NEEDS_CODE" })).toBe("Admin accounts sign in with a password and an authenticator code.");
    expect(authErrorMessage({ code: "PASSKEY_NOT_VERIFIED" })).toMatch(/Sign in with your password/);
  });
});
