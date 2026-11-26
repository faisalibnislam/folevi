// A recent sign-in, for the few actions that someone holding only a stolen session must not be able to take:
// starting encryption over with new keys (e2ee.keys.resetAccount), lowering a space's encryption level or turning
// one of its feature switches on (e2ee.spaces.lower, setSwitches), and asking a Vault's custodians for its key
// again (vaultKeys.requestReset). Each of those ends with someone else's device handing over keys or readable
// text, so a session that has been open for days isn't enough: the person signs in again first.
//
// The window is the one convex/auth.ts uses before linking a Google or Apple account (FRESH_LINK_MS, Better
// Auth's freshAge). When the session began is the Better Auth session row's createdAt, read by the session id
// the token carries: the same row requireActiveSession checks on every call. Refreshing a session moves its
// expiresAt and updatedAt, never its createdAt, so the time can't be pushed forward by staying signed in.
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sessionIdOf } from "./auth";
import { findActiveSession } from "./authStore";
import { fail } from "./errors";

/** How recent the sign-in must be: 10 minutes. */
export const FRESH_SESSION_MS = 10 * 60_000;

/** What the person is told. The `reason` on the error lets an app offer signing in again. */
export const FRESH_SESSION_MESSAGE = "For your security, sign out and sign in again, then try this within 10 minutes.";
export const FRESH_SESSION_REASON = "session_not_fresh";

/** When a Better Auth date (stored as a number; older rows may hold a string) was, or null. */
function timeOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || value instanceof Date) {
    const at = new Date(value).getTime();
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/**
 * When the caller's session began (ms), or null when the token carries no live session or the row has no
 * readable start time.
 */
export async function sessionStartedAt(ctx: QueryCtx | MutationCtx): Promise<number | null> {
  const identity = await ctx.auth.getUserIdentity();
  const sessionId = identity ? sessionIdOf(identity) : null;
  const session = sessionId ? await findActiveSession(ctx, sessionId) : null;
  return session ? timeOf(session.createdAt) : null;
}

/**
 * Refuses unless the caller signed in within the last 10 minutes. A session whose start can't be read is
 * treated as old: the check fails closed.
 */
export async function requireFreshSession(ctx: QueryCtx | MutationCtx, now = Date.now()): Promise<void> {
  const startedAt = await sessionStartedAt(ctx);
  if (startedAt === null || now - startedAt > FRESH_SESSION_MS) fail("forbidden", FRESH_SESSION_MESSAGE, { reason: FRESH_SESSION_REASON });
}
