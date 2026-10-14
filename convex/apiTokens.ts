// Personal access tokens for Folevi's REST API (https://app.folevi.com/api/v1, convex/restApiServer.ts).
//
// A token is made in Settings → Connected apps with a name, what it may do (the connected-app scopes:
// notes:read, notes:write, tasks:read, tasks:write), where (Personal and chosen workspaces) and when it
// expires. It's shown once ("fvpat_" and 43 random characters); only its SHA-256 hash is kept, looked up
// by index on every request, so revoking one stops it at once. Requests run as the person, through the same
// code as connected apps (convex/mcp.ts), never seeing more than they can.
import { v } from "convex/values";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { randomToken, sha256Base64url } from "./lib/crypto";
import { MCP_SCOPES, type McpScope } from "./lib/mcp/config";

export const TOKEN_PREFIX = "fvpat_";
export const MAX_TOKENS = 20;
/** The expiry choices, in days (null: never). */
export const EXPIRY_DAYS = [30, 90, 365] as const;

const SCOPE_SET = new Set<string>(MCP_SCOPES);
const DAY = 24 * 60 * 60_000;

/** What a token is worth, once checked. */
export type TokenAuth = { ok: true; tokenId: Id<"apiTokens">; profileId: Id<"profiles">; scopes: McpScope[] } | { ok: false; reason: "invalid_token" | "expired" | "account" };

/** Checks a token (by its hash): it exists, hasn't expired, and the person's account is active. */
export const authorize = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args): Promise<TokenAuth> => {
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!token) return { ok: false, reason: "invalid_token" };
    if (token.expiresAt !== undefined && token.expiresAt <= Date.now()) return { ok: false, reason: "expired" };
    const profile = await ctx.db.get(token.profileId);
    if (!profile || profile.status !== "active") return { ok: false, reason: "account" };
    return { ok: true, tokenId: token._id, profileId: profile._id, scopes: token.scopes.filter((s): s is McpScope => SCOPE_SET.has(s)) };
  },
});

/** A token and its person, still usable (checked again inside each request's own transaction). */
export async function tokenContext(ctx: QueryCtx, tokenId: Id<"apiTokens">): Promise<{ token: Doc<"apiTokens">; profile: Doc<"profiles"> }> {
  const token = await ctx.db.get(tokenId);
  if (!token) fail("unauthenticated", "This token was revoked.");
  if (token.expiresAt !== undefined && token.expiresAt <= Date.now()) fail("unauthenticated", "This token has expired.");
  const profile = await ctx.db.get(token.profileId);
  if (!profile || profile.status !== "active") fail("unauthenticated", "This account can't be used right now.");
  return { token, profile };
}

/** The token's reach, as connected apps have it: its places, no pages shared from elsewhere, and changes allowed. */
export const reachOf = (token: Doc<"apiTokens">) => ({ personal: token.personal, workspaceIds: token.workspaceIds, includeShared: false, createOnly: false });

// ---------------------------------------------------------------- Settings → Connected apps

/** Makes a token. The token is returned this once; Folevi keeps only its hash. */
export const create = mutation({
  args: {
    name: v.string(),
    scopes: v.array(v.string()),
    personal: v.boolean(),
    workspaceIds: v.array(v.string()),
    /** 30, 90 or 365; null for a token that doesn't expire. */
    expiresInDays: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const name = args.name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) fail("invalid_argument", "Give the token a name, so you know what it's for.");
    const scopes = MCP_SCOPES.filter((s) => args.scopes.includes(s));
    if (!scopes.length) fail("invalid_argument", "Allow at least one thing it can do.");
    if (args.expiresInDays !== null && !(EXPIRY_DAYS as readonly number[]).includes(args.expiresInDays)) fail("invalid_argument", "Choose when the token expires.");
    const workspaceIds: Id<"workspaces">[] = [];
    for (const publicId of [...new Set(args.workspaceIds)].slice(0, 50)) {
      const { scope } = await resolveScope(ctx, profile, { kind: "workspace", workspaceId: publicId });
      if (scope.kind === "workspace") workspaceIds.push(scope.workspaceId);
    }
    if (!args.personal && !workspaceIds.length) fail("invalid_argument", "Choose at least one place.");
    const existing = await ctx.db
      .query("apiTokens")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_TOKENS + 1);
    if (existing.length >= MAX_TOKENS) fail("limit_exceeded", `You can have up to ${MAX_TOKENS} tokens. Revoke one you no longer use first.`);
    const token = `${TOKEN_PREFIX}${randomToken(32)}`;
    const now = Date.now();
    await ctx.db.insert("apiTokens", {
      profileId: profile._id,
      name,
      tokenHash: await sha256Base64url(token),
      hint: token.slice(0, TOKEN_PREFIX.length + 4),
      scopes,
      personal: args.personal,
      workspaceIds,
      createdAt: now,
      ...(args.expiresInDays === null ? {} : { expiresAt: now + args.expiresInDays * DAY }),
    });
    return { token };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("apiTokens")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_TOKENS + 5);
    const out = [];
    for (const t of rows) {
      const places: string[] = t.personal ? ["Personal"] : [];
      for (const id of t.workspaceIds) {
        const w = await ctx.db.get(id);
        if (w && w.status !== "deleting") places.push(w.name);
      }
      out.push({
        id: t._id as string,
        name: t.name,
        hint: t.hint,
        scopes: t.scopes,
        places,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt ?? null,
        expiresAt: t.expiresAt ?? null,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Revokes a token: it stops working at once (and the answers kept for its retries go too). */
export const revoke = mutation({
  args: { tokenId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const id = ctx.db.normalizeId("apiTokens", args.tokenId);
    const token = id ? await ctx.db.get(id) : null;
    if (!token || token.profileId !== profile._id) fail("not_found", "That token isn't there.");
    const kept = await ctx.db
      .query("apiRequests")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .take(1000);
    for (const r of kept) await ctx.db.delete(r._id);
    await ctx.db.delete(token._id);
    return null;
  },
});
