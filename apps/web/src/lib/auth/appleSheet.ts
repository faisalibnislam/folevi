// Sign in with Apple in Apple's own sheet, in the iPhone and iPad app (docs/IOS.md, "Sign in with Apple"):
// the app shows the sheet (foleviNative.signInWithApple), this page signs in with the id token through Better
// Auth (in the built-in interface that request goes through the app, which keeps the new session itself), then
// hands Apple's one-time authorization code to /apple/native-code so Folevi can revoke Apple's tokens when the
// account is deleted or Apple is removed (App Store 5.1.1(v)). A refusal comes back as a message for the page.
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { socialError } from "@/lib/auth/socialErrors";
import { nativeApp } from "@/lib/nativeApp";

/** Whether this app build has Apple's own sheet. */
export function appleSheetHere(): boolean {
  return typeof nativeApp()?.signInWithApple === "function";
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** "signed-in", "cancelled", or the message to show. */
export async function signInWithAppleSheet(): Promise<"signed-in" | "cancelled" | { error: string }> {
  const app = nativeApp();
  if (!app?.signInWithApple) return { error: socialError("failed", "apple") ?? "Signing in with Apple didn't work." };
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const credential = await app.signInWithApple({ nonce });
  if (!credential) return "cancelled";
  const name = credential.firstName || credential.lastName ? { name: { firstName: credential.firstName ?? undefined, lastName: credential.lastName ?? undefined } } : {};
  const { error } = await authClient.signIn.social({ provider: "apple", idToken: { token: credential.idToken, nonce, user: name } as never });
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code.toLowerCase() === "two_factor_required") return { error: socialError("two_factor_required", "apple") ?? authErrorMessage(error) };
    return { error: authErrorMessage(error) };
  }
  // So Folevi can revoke Apple's tokens later. Signed in either way; the next sign-in with the sheet tries again.
  await authClient.$fetch("/apple/native-code", { method: "POST", body: { authorization_code: credential.authorizationCode } }).catch(() => undefined);
  return "signed-in";
}
