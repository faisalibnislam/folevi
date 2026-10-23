// How someone signs in from the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1): "Continue with Apple" and
// "Continue with Google" open the sign-in sheet straight on that provider's page (the website's /app-google,
// which goes on by itself), and "Sign in with email" opens the website's own sign-in page (/connect). Asking here,
// in the app, means the sheet never shows a second choice of the same three.
import { chooseAction } from "@/lib/native/ui";
import type { ShellSignInOptions } from "@/lib/shell/types";

export type SignInWay = "apple" | "google" | "email";

/** The ways, in the order the app shows them (Apple first, as on the website's sign-in page). */
export const SIGN_IN_WAYS: readonly { id: SignInWay; title: string }[] = [
  { id: "apple", title: "Continue with Apple" },
  { id: "google", title: "Continue with Google" },
  { id: "email", title: "Sign in with email" },
];

/** What the host's signIn takes for a way: the provider, or nothing for the website's sign-in page. */
export function signInOptionsFor(way: SignInWay): ShellSignInOptions {
  return way === "email" ? {} : { provider: way };
}

const isWay = (v: unknown): v is SignInWay => v === "apple" || v === "google" || v === "email";

/**
 * Asks how (an action sheet in the iPhone and iPad app, a small dialog on the Mac): the options for the host's
 * signIn, or null when dismissed.
 */
export async function chooseSignInWay(o: { title?: string; anchor?: Element | null } = {}): Promise<ShellSignInOptions | null> {
  const picked = await chooseAction({ title: o.title ?? "Sign in to Folevi", actions: SIGN_IN_WAYS.map((w) => ({ id: w.id, title: w.title })), anchor: o.anchor ?? null });
  return isWay(picked) ? signInOptionsFor(picked) : null;
}
