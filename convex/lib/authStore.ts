// Read/revoke helpers over the Better Auth component's tables (sessions, users, connected apps' OAuth
// clients and tokens). All access to the component's data from Folevi functions goes through here.
import { components, internal } from "../_generated/api";
import { appleRevocationFor, type StoredAppleAccount } from "./appleSignIn";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type ReadCtx = QueryCtx | MutationCtx | ActionCtx;
type WriteCtx = MutationCtx | ActionCtx;

export interface AuthSession {
  _id: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthUser {
  _id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean | null;
  createdAt: number;
}

/** The live (unexpired) Better Auth session with this id, or null (signed out, revoked or expired). */
export async function findActiveSession(ctx: ReadCtx, sessionId: string): Promise<AuthSession | null> {
  // Look up by id alone and check expiry here: the component adapter only uses an index when every
  // condition is covered by one, and a second condition would turn this into a table scan.
  const doc = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [{ field: "_id", value: sessionId }],
  })) as AuthSession | null;
  return doc && doc.expiresAt > Date.now() ? doc : null;
}

/** Every unexpired session of a Better Auth user (via the userId index; expiry is checked here). */
export async function listUserSessions(ctx: ReadCtx, userId: string): Promise<AuthSession[]> {
  const now = Date.now();
  const out: AuthSession[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "session",
      where: [{ field: "userId", value: userId }],
      paginationOpts: { numItems: 100, cursor },
    })) as { page: AuthSession[]; isDone: boolean; continueCursor: string };
    for (const s of result.page) if (s.expiresAt > now) out.push(s);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return out;
}

export async function findAuthUser(ctx: ReadCtx, userId: string): Promise<AuthUser | null> {
  const doc = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: userId }] });
  return (doc as AuthUser | null) ?? null;
}

export async function deleteSession(ctx: WriteCtx, sessionId: string): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "session", where: [{ field: "_id", value: sessionId }] } });
}

/** Ends every session of a Better Auth user (optionally keeping one). Returns how many were ended. */
export async function deleteUserSessions(ctx: WriteCtx, userId: string, keepSessionId?: string): Promise<number> {
  const sessions = await listUserSessions(ctx, userId);
  let ended = 0;
  for (const s of sessions) {
    if (s._id === keepSessionId) continue;
    await deleteSession(ctx, s._id);
    ended++;
  }
  return ended;
}

// ---------------------------------------------------------------- connected apps (OAuth, MCP)

export interface OAuthAccessToken {
  _id: string;
  token: string;
  clientId: string;
  userId?: string | null;
  sessionId?: string | null;
  expiresAt?: number | null;
  scopes: string[];
}

export interface OAuthClient {
  _id: string;
  clientId: string;
  name?: string | null;
  uri?: string | null;
  icon?: string | null;
  redirectUris: string[];
  disabled?: boolean | null;
}

/** The access token stored under this hash (the provider stores base64url SHA-256 of the token), if any. */
export async function findOAuthAccessToken(ctx: ReadCtx, tokenHash: string): Promise<OAuthAccessToken | null> {
  const doc = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "oauthAccessToken", where: [{ field: "token", value: tokenHash }] });
  return (doc as OAuthAccessToken | null) ?? null;
}

export async function findOAuthClient(ctx: ReadCtx, clientId: string): Promise<OAuthClient | null> {
  const doc = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "oauthClient", where: [{ field: "clientId", value: clientId }] });
  return (doc as OAuthClient | null) ?? null;
}

/**
 * Ends a connected app's access for one person: their access and refresh tokens for the client and their
 * consent to it, so the next request fails and the app has to ask again.
 */
export async function revokeOAuthClient(ctx: WriteCtx, userId: string, clientId: string): Promise<void> {
  for (const model of ["oauthAccessToken", "oauthRefreshToken"] as const) {
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model,
        where: [{ field: "userId", value: userId }],
        paginationOpts: { numItems: 100, cursor },
      })) as { page: { _id: string; clientId: string }[]; isDone: boolean; continueCursor: string };
      for (const row of page.page) {
        if (row.clientId === clientId) await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model, where: [{ field: "_id", value: row._id }] } });
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    input: { model: "oauthConsent", where: [{ field: "clientId", value: clientId }, { field: "userId", value: userId }] },
    paginationOpts: { numItems: 100, cursor: null },
  });
}

/**
 * Queues the person's Sign in with Apple tokens for revocation at Apple (convex/appleRevoke.ts), before their
 * account rows go. Never stops a deletion: a failure here is logged and the deletion carries on.
 */
async function queueAppleRevocations(ctx: WriteCtx, userId: string): Promise<void> {
  try {
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "account",
      where: [{ field: "userId", value: userId }],
      paginationOpts: { numItems: 50, cursor: null },
    })) as { page: StoredAppleAccount[] };
    const items = res.page.map((a) => appleRevocationFor(a)).filter((x) => x !== null);
    if (items.length) await ctx.runMutation(internal.appleRevoke.queue, { items });
  } catch (error) {
    console.error(JSON.stringify({ event: "apple.revoke.queue_failed", where: "account_deletion", message: error instanceof Error ? error.name : "unknown" }));
  }
}

/** Removes the Better Auth user and everything attached to it (sessions, credentials, 2FA, passkeys, connected apps). */
export async function deleteAuthUser(ctx: WriteCtx, userId: string): Promise<void> {
  await queueAppleRevocations(ctx, userId);
  for (const model of ["session", "account", "twoFactor", "passkey", "oauthAccessToken", "oauthRefreshToken", "oauthConsent"] as const) {
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res = (await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model, where: [{ field: "userId", value: userId }] },
        paginationOpts: { numItems: 100, cursor },
      })) as { isDone?: boolean; continueCursor?: string };
      if (res.isDone !== false || !res.continueCursor) break;
      cursor = res.continueCursor;
    }
  }
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "user", where: [{ field: "_id", value: userId }] } });
}
