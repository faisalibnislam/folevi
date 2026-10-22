import "server-only";
import { cookies, headers } from "next/headers";
import { getSessionCookie } from "better-auth/cookies";

export const COOKIE_PREFIX = "folevi";

/**
 * Cheap, network-free check used to route signed-out visitors to /signin before rendering the app
 * shell. It only looks for the session cookie; every backend call still validates the real session.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const h = new Headers(await headers());
  if (getSessionCookie(h, { cookiePrefix: COOKIE_PREFIX })) return true;
  const jar = await cookies();
  // Another account's session counts too (several accounts in one browser, docs/MULTI_ACCOUNT_PLAN.md §2.1).
  return jar.getAll().some((c) => Boolean(c.value) && (c.name.endsWith(`${COOKIE_PREFIX}.session_token`) || c.name.includes(`${COOKIE_PREFIX}.session_token_multi-`)));
}
