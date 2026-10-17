/** The messages for a sign-in with Google that came back refused (convex/auth.ts GOOGLE_REFUSED, and Better Auth's own). */
export function googleError(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "two_factor_required") return "This account uses two-step verification, so sign in with your email, password and code. Google doesn't ask for the code.";
  if (code === "signups_paused") return "New sign-ups are paused right now. Please try again later.";
  if (code === "access_denied") return "Google sign-in was cancelled.";
  return "Signing in with Google didn't work. Try again, or sign in with your email and password.";
}
