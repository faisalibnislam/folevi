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

export { googleError } from "./googleErrors";
