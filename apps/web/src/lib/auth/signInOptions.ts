import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";

/** How long the sign-in page waits for the backend before leaving Google out. */
const TIMEOUT_MS = 2000;

/**
 * Whether the sign-in and sign-up pages show "Continue with Google": only when the backend has Google's keys
 * (convex/signInOptions.ts). Server only. If the backend can't be reached, the email form is still there.
 */
export async function googleSignInAvailable(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return false;
  try {
    const options = await Promise.race([
      new ConvexHttpClient(url).query(api.signInOptions.options, {}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return options.google;
  } catch {
    return false;
  }
}

/** The messages for a sign-in with Google that came back refused (convex/auth.ts GOOGLE_REFUSED, and Better Auth's own). */
export function googleError(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "two_factor_required") return "This account uses two-step verification, so sign in with your email, password and code. Google doesn't ask for the code.";
  if (code === "signups_paused") return "New sign-ups are paused right now. Please try again later.";
  if (code === "access_denied") return "Google sign-in was cancelled.";
  return "Signing in with Google didn't work. Try again, or sign in with your email and password.";
}
