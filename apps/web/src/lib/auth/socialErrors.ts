/** The ways to sign in with another account that Folevi offers (convex/auth.ts). */
export type SocialProvider = "google" | "apple";

export const PROVIDER_NAMES: Record<SocialProvider, string> = { google: "Google", apple: "Apple" };

export function isSocialProvider(v: unknown): v is SocialProvider {
  return v === "google" || v === "apple";
}

/**
 * The message for a sign-in with Google or Apple that came back refused (convex/auth.ts SOCIAL_REFUSED, and
 * Better Auth's and the providers' own codes).
 */
export function socialError(code: string | undefined, provider: SocialProvider = "google"): string | undefined {
  if (!code) return undefined;
  const name = PROVIDER_NAMES[provider];
  if (code === "two_factor_required") return `This account uses two-step verification, so sign in with your email, password and code. ${name} doesn't ask for the code.`;
  if (code === "signups_paused") return "New sign-ups are paused right now. Please try again later.";
  // Google says access_denied; Apple says user_cancelled_authorize.
  if (code === "access_denied" || code === "user_cancelled_authorize") return `${name} sign-in was cancelled.`;
  if (code === "account_not_linked") return `There's a Folevi account with this email that isn't confirmed yet. Open the link we emailed you, or sign in with your password, then try ${name} again.`;
  if (code === "account_already_linked_to_different_user") return `This ${name} account is already linked to another Folevi account.`;
  return `Signing in with ${name} didn't work. Try again, or sign in with your email and password.`;
}
