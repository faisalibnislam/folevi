// Sign in with Apple's own sheet in the iPhone and iPad app (lib/auth/appleSheet.ts): the id token goes to
// Better Auth with the page's nonce, then Apple's one-time code to /apple/native-code; a cancelled sheet does
// nothing, and an account with two-step verification gets the web's message.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const social = vi.fn();
const fetchAuth = vi.fn();
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { social: (...a: unknown[]) => social(...a) }, $fetch: (...a: unknown[]) => fetchAuth(...a) },
  authErrorMessage: (e: { message?: string }) => e.message ?? "failed",
}));

import { appleSheetHere, signInWithAppleSheet } from "@/lib/auth/appleSheet";

const credential = { idToken: "header.payload.sig", authorizationCode: "c0de", firstName: "Sam", lastName: null };

function withBridge(signInWithApple: ((o: { nonce: string }) => Promise<unknown>) | undefined) {
  Object.defineProperty(window, "foleviNative", { value: { platform: "ios", signInWithApple }, configurable: true, writable: true });
}

describe("Apple's own sheet", () => {
  beforeEach(() => {
    social.mockReset();
    fetchAuth.mockReset();
  });
  afterEach(() => {
    delete (window as { foleviNative?: unknown }).foleviNative;
  });

  test("signs in with the id token and the nonce, then hands over the code", async () => {
    let nonce = "";
    withBridge(async (o) => {
      nonce = o.nonce;
      return credential;
    });
    social.mockResolvedValue({ error: null });
    fetchAuth.mockResolvedValue({ error: null });
    expect(appleSheetHere()).toBe(true);
    expect(await signInWithAppleSheet()).toBe("signed-in");
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(social).toHaveBeenCalledWith({ provider: "apple", idToken: { token: credential.idToken, nonce, user: { name: { firstName: "Sam", lastName: undefined } } } });
    expect(fetchAuth).toHaveBeenCalledWith("/apple/native-code", { method: "POST", body: { authorization_code: "c0de" } });
  });

  test("a closed sheet signs nobody in", async () => {
    withBridge(async () => null);
    expect(await signInWithAppleSheet()).toBe("cancelled");
    expect(social).not.toHaveBeenCalled();
  });

  test("two-step accounts are sent to the password sign-in, and the code isn't sent", async () => {
    withBridge(async () => credential);
    social.mockResolvedValue({ error: { code: "TWO_FACTOR_REQUIRED", message: "This account uses two-step verification." } });
    const r = await signInWithAppleSheet();
    expect(r).toEqual({ error: expect.stringContaining("two-step verification") });
    expect(fetchAuth).not.toHaveBeenCalled();
  });

  test("older app builds have no sheet", () => {
    withBridge(undefined);
    expect(appleSheetHere()).toBe(false);
  });
});
