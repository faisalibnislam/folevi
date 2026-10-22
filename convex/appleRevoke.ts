// Revoking Sign in with Apple tokens (App Store guideline 5.1.1(v)): when someone deletes their account, or
// removes Apple in Settings > Security, Folevi tells Apple to revoke the token it holds for them
// (https://appleid.apple.com/auth/revoke, with the client secret made from the key), so Folevi drops out of
// their Apple ID's "Sign in with Apple" list.
//
// Neither deletion nor removal waits for Apple: the token goes into appleRevocations, and a background action
// tries it at once and again later (1 minute, 10 minutes, an hour, 6 hours, then daily for 3 days) until Apple
// answers. Logs say what happened (Apple's error code, the HTTP status, the attempt), never the token or secret.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { appleClientSecret, appleSignInConfig, asAppleClient, revokeAppleToken, type AppleRevokeResult } from "./lib/appleSignIn";

/** Waits before each try after the first. After the last, the row is dropped and the failure logged. */
export const APPLE_REVOKE_BACKOFF_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000, 24 * 60 * 60_000, 24 * 60 * 60_000];

const vItem = v.object({ token: v.string(), hint: v.union(v.literal("refresh_token"), v.literal("access_token")), clientId: v.string() });

const log = (event: string, fields: Record<string, string | number | boolean>) => console.log(JSON.stringify({ event, ...fields }));

/** Queues tokens for revocation and starts on each right away. */
export const queue = internalMutation({
  args: { items: v.array(vItem) },
  handler: async (ctx, { items }) => {
    for (const item of items.slice(0, 20)) {
      if (!item.token || item.token.length > 4096) continue;
      const id = await ctx.db.insert("appleRevocations", { ...item, attempts: 0, createdAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.appleRevoke.run, { id });
    }
  },
});

export const get = internalQuery({
  args: { id: v.id("appleRevocations") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

/** One try: asks Apple, then records the answer (settle). */
export const run = internalAction({
  args: { id: v.id("appleRevocations") },
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.appleRevoke.get, { id });
    if (!row) return;
    const result = await attempt(row);
    await ctx.runMutation(internal.appleRevoke.settle, { id, ok: result.ok, error: result.ok ? undefined : result.error, status: result.ok ? undefined : result.status, retry: result.ok ? false : result.retry });
  },
});

async function attempt(row: { token: string; hint: "refresh_token" | "access_token"; clientId: string }): Promise<AppleRevokeResult> {
  const config = appleSignInConfig();
  // Apple was switched off after this was queued: keep it until it's back (or the tries run out).
  if (!config) return { ok: false, status: 0, error: "not_configured", retry: true };
  const client = asAppleClient(config, row.clientId);
  let clientSecret: string;
  try {
    clientSecret = await appleClientSecret(client);
  } catch {
    return { ok: false, status: 0, error: "bad_key", retry: true };
  }
  return await revokeAppleToken({ clientId: client.clientId, clientSecret, token: row.token, hint: row.hint });
}

/** Done: the row goes. Not done: tried again later while tries are left, else dropped. */
export const settle = internalMutation({
  args: { id: v.id("appleRevocations"), ok: v.boolean(), error: v.optional(v.string()), status: v.optional(v.number()), retry: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    const attempts = row.attempts + 1;
    if (args.ok) {
      await ctx.db.delete(args.id);
      log("apple.revoke", { ok: true, attempts, client: clientLabel(row.clientId) });
      return;
    }
    const wait = APPLE_REVOKE_BACKOFF_MS[attempts - 1];
    const fields = { ok: false, attempts, status: args.status ?? 0, error: args.error ?? "unknown", client: clientLabel(row.clientId) };
    if (!args.retry || wait === undefined) {
      await ctx.db.delete(args.id);
      log("apple.revoke.gave_up", fields);
      return;
    }
    await ctx.db.patch(args.id, { attempts, lastError: args.error ?? "unknown" });
    await ctx.scheduler.runAfter(wait, internal.appleRevoke.run, { id: args.id as Id<"appleRevocations"> });
    log("apple.revoke.retry", { ...fields, retryInMs: wait });
  },
});

/** Which of Folevi's Apple clients a token belongs to, for the logs (the ids aren't secret, but "web"/"ios" read better). */
function clientLabel(clientId: string): string {
  const config = appleSignInConfig();
  if (config && clientId === config.bundleId) return "ios";
  if (config && clientId === config.clientId) return "web";
  return "other";
}
