// Things that arrived for an encrypted space, sealed to its inbox key (docs/E2EE_DESIGN.md §7.4, §7.5). WP5.
//
// The server seals an email, a web clip or a connected app's write (lib/e2ee/inboxSeal.ts) and keeps only
// the sealed box. A member's unlocked device (apps/web features/inbox.ts) lists what's waiting, opens each
// item with the space key, makes the change through the sync engine (sealed), and marks it applied.
//
//   waiting:     what's waiting in a space for the caller (metadata only);
//   open:        one item's sealed bytes, for the device to open;
//   markApplied: done (the sealed bytes are dropped; the row stays until it expires, so a retried app call
//                can still be answered);
//   markFailed:  the device couldn't apply it (the reason is logged as a short code, never stored);
//   expire:      daily: deletes items past their 30 days.
//
// Who applies an item: an email or an app's write belongs to the person it came for (`appliedBy` holds that
// person while the item waits, and keeps them once applied), so in a workspace only their devices see it.
import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { assertWritable, requireProfile, resolveScope } from "../lib/auth";
import { fail } from "../lib/errors";
import { scopeKey, scopeOfRow, vScopeArg, type Scope } from "../lib/scope";
import { e2eeScopeId } from "../lib/e2ee/state";

const GONE = "That item isn't waiting anymore.";
/** Items listed at once (a device applies them oldest first, then asks again). */
const WAITING_PAGE = 50;
const EXPIRE_BATCH = 200;

/** Whether the caller may see and apply an item: in a scope they can add pages to, and meant for them (or anyone there). */
async function itemFor(ctx: QueryCtx, profile: Doc<"profiles">, inboxId: string): Promise<{ item: Doc<"e2eeInbox">; scope: Scope }> {
  const item = await ctx.db
    .query("e2eeInbox")
    .withIndex("by_public_id", (q) => q.eq("publicId", inboxId))
    .unique();
  if (!item) fail("not_found", GONE);
  const scope = scopeOfRow(item);
  await scopeArgFor(ctx, profile, scope);
  if (item.appliedBy !== undefined && item.appliedBy !== profile._id) fail("not_found", GONE);
  return { item, scope };
}

/** Checks the caller can add pages in a scope (the inbox's notes go there). */
async function scopeArgFor(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope): Promise<void> {
  if (scope.kind === "personal") {
    if (scope.profileId !== profile._id) fail("not_found", GONE);
    return;
  }
  const ws = await ctx.db.get(scope.workspaceId);
  if (!ws) fail("not_found", GONE);
  await resolveScope(ctx, profile, { kind: "workspace", workspaceId: ws.publicId }, "edit");
}

/** What's waiting in a space for the caller, oldest first (no bytes: `open` fetches them one by one). */
export const waiting = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    const rows = await ctx.db
      .query("e2eeInbox")
      .withIndex("by_scope_status", (q) => q.eq("scopeKey", scopeKey(scope)).eq("status", "waiting"))
      .take(WAITING_PAGE * 4);
    return rows
      .filter((r) => r.appliedBy === undefined || r.appliedBy === profile._id)
      .slice(0, WAITING_PAGE)
      .map((r) => ({
        id: r.publicId,
        kind: r.kind,
        keyVersion: r.keyVersion,
        size: r.size,
        targetDocumentId: r.targetDocumentId ?? null,
        receivedAt: r.receivedAt,
        expiresAt: r.expiresAt,
      }));
  },
});

/** One waiting item's sealed bytes and the scope id its context names (`inbox/<scope>/<id>`). */
export const open = query({
  args: { inboxId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { item, scope } = await itemFor(ctx, profile, args.inboxId);
    if (item.status !== "waiting") fail("not_found", GONE);
    return { id: item.publicId, kind: item.kind, keyVersion: item.keyVersion, scopeId: await e2eeScopeId(ctx, scope), sealed: item.sealed, targetDocumentId: item.targetDocumentId ?? null };
  },
});

/** The device made the change: the sealed bytes go; the row stays (applied) until it expires. */
export const markApplied = mutation({
  args: { inboxId: v.string(), createdDocumentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { item } = await itemFor(ctx, profile, args.inboxId);
    if (item.status === "applied") return { applied: false };
    if (args.createdDocumentId !== undefined && item.targetDocumentId !== undefined && args.createdDocumentId !== item.targetDocumentId) {
      fail("invalid_argument", "That isn't the note this item was for.");
    }
    await ctx.db.patch(item._id, { status: "applied", sealed: new ArrayBuffer(0), size: 0, appliedBy: profile._id });
    return { applied: true };
  },
});

/** The device couldn't apply an item (it can't be opened, or the note it changes is gone). */
export const markFailed = mutation({
  args: { inboxId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { item } = await itemFor(ctx, profile, args.inboxId);
    if (item.status !== "waiting") return null;
    await ctx.db.patch(item._id, { status: "failed", sealed: new ArrayBuffer(0), size: 0 });
    // A short code only (the reason may describe content); never stored.
    console.warn(JSON.stringify({ event: "e2ee.inbox_failed", kind: item.kind, reason: args.reason.replace(/[^a-z0-9_]/gi, "").slice(0, 40) }));
    return null;
  },
});

/** Daily: deletes items past their expiry (waiting ones too: 30 days with no device). */
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("e2eeInbox")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(EXPIRE_BATCH);
    for (const r of rows) await ctx.db.delete(r._id);
    if (rows.length === EXPIRE_BATCH) await ctx.scheduler.runAfter(0, internal.e2ee.inbox.expire, {});
    return rows.length;
  },
});

/** An item's state, for a connected app asking about something it queued (`status: "queued"`). */
export async function inboxStatus(ctx: QueryCtx, publicId: string): Promise<"waiting" | "applied" | "failed" | null> {
  const item = await ctx.db
    .query("e2eeInbox")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  return item?.status ?? null;
}
