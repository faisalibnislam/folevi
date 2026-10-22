import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";

/** How long the sign-in page waits for the backend before leaving Google and Apple out. */
const TIMEOUT_MS = 2000;

/** Which of "Continue with Google" and "Continue with Apple" this deployment offers. */
export type SocialOptions = { google: boolean; apple: boolean };

const NONE: SocialOptions = { google: false, apple: false };

/**
 * What the sign-in and sign-up pages offer besides email and password: Google and Apple only when the backend
 * has their keys (convex/signInOptions.ts). Server only. If the backend can't be reached, the email form is
 * still there.
 */
export async function socialSignInOptions(): Promise<SocialOptions> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NONE;
  try {
    const options = await Promise.race([
      new ConvexHttpClient(url).query(api.signInOptions.options, {}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    // A backend from before Apple was added answers without it.
    return { google: options.google === true, apple: options.apple === true };
  } catch {
    return NONE;
  }
}

export { socialError } from "./socialErrors";
