// Reading the Vault's log, the events only a device can see, export, the integrity check, the daily signed
// anchors and the 3-year expiry (docs/VAULT_PLAN.md §7). Entries are written only by lib/vault/log.ts. This module
// never edits an entry; its one delete is the expiry (tests/convex/static/invariants.test.ts holds both).
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { keyedHash } from "./lib/crypto";
import { requireVault, vaultRoleAtLeast } from "./lib/vault/access";
import { appendLog, entryHash, genesisHash, LOG_RETENTION_MS } from "./lib/vault/log";
import { vVaultClient } from "./lib/vault/validators";

type Ctx = QueryCtx | MutationCtx;

/**
 * What a device reports (docs/VAULT_PLAN.md §7.2, §7.3): things the server never sees happen. Each says whether it
 * names an item. Anything else is refused, so the log's vocabulary stays fixed.
 */
export const DEVICE_EVENTS = {
  "vault.open": false,
  "section.open": false,
  "folder.open": false,
  "item.reveal": true,
  "item.copy": true,
  "totp.show": true,
  "totp.copy": true,
  "file.preview": true,
  "file.print": true,
  "note.print": true,
  "history.view": true,
} as const;
export type DeviceEvent = keyof typeof DEVICE_EVENTS;

const PAGE = 200;
const EXPORT_PAGE = 1000;

/** The fields a reader sees (everything kept, ids as public ids). */
function shape(e: Doc<"vaultLog">) {
  return {
    seq: e.seq,
    at: e.at,
    timeZone: e.timeZone ?? null,
    actorId: (e.actorId as string | undefined) ?? null,
    actorName: e.actorName,
    actorEmail: e.actorEmail ?? null,
    actorRole: e.actorRole,
    event: e.event,
    outcome: e.outcome,
    reason: e.reason ?? null,
    itemId: e.itemPublicId ?? null,
    itemKind: e.itemKind ?? null,
    sealedDetail: e.sealedDetail ?? null,
    detail: e.detail ?? null,
    device: e.device ?? null,
    ip: e.ip ?? null,
    location: e.location ?? null,
    sessionId: e.sessionId ?? null,
    source: e.source,
    prevHash: e.prevHash,
    hash: e.hash,
  };
}

/** The log as the caller may read it: everything for the owner and custodians, their own entries for members. */
async function readable(ctx: Ctx, profile: Doc<"profiles">, vaultId: string) {
  const { vault, role } = await requireVault(ctx, profile, vaultId);
  return { profile, vault, role, all: vaultRoleAtLeast(role, "custodian") };
}

/**
 * A page of the log, newest first, with filters: a person (custodians only), an item, an event or its prefix
 * ("item." for every item event), failures only, a time range. `before` continues from a previous page's last seq.
 */
export const list = query({
  args: {
    vaultId: v.string(),
    before: v.optional(v.number()),
    personId: v.optional(v.string()),
    itemId: v.optional(v.string()),
    event: v.optional(v.string()),
    failedOnly: v.optional(v.boolean()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { profile, vault, all } = await readable(ctx, await requireProfile(ctx), args.vaultId);
    const actor = all ? (args.personId ? ctx.db.normalizeId("profiles", args.personId) : null) : profile._id;
    if (all && args.personId && !actor) return { entries: [], next: null, everything: all };
    const before = args.before ?? Number.MAX_SAFE_INTEGER;
    const base = actor
      ? ctx.db.query("vaultLog").withIndex("by_vault_actor", (q) => q.eq("vaultPublicId", vault.publicId).eq("actorId", actor).lt("seq", before))
      : args.itemId
        ? ctx.db.query("vaultLog").withIndex("by_vault_item", (q) => q.eq("vaultPublicId", vault.publicId).eq("itemPublicId", args.itemId).lt("seq", before))
        : ctx.db.query("vaultLog").withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId).lt("seq", before));
    const entries = [];
    let next: number | null = null;
    // Filters run over the index's order; a page stops at PAGE matches or after reading 5 pages' worth.
    for await (const e of base.order("desc")) {
      next = e.seq;
      if (args.itemId && e.itemPublicId !== args.itemId) continue;
      if (args.event && !(args.event.endsWith(".") ? e.event.startsWith(args.event) : e.event === args.event)) continue;
      if (args.failedOnly && e.outcome !== "failed") continue;
      if (args.from !== undefined && e.at < args.from) continue;
      if (args.to !== undefined && e.at > args.to) continue;
      entries.push(shape(e));
      if (entries.length >= PAGE) break;
    }
    return { entries, next: entries.length >= PAGE ? next : null, everything: all };
  },
});

/** Something only the device saw (a password revealed, copied, a file previewed, printed). */
export const record = mutation({
  args: {
    vaultId: v.string(),
    event: v.string(),
    itemId: v.optional(v.string()),
    itemKind: v.optional(v.string()),
    sealedDetail: v.optional(v.bytes()),
    detail: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    client: v.optional(vVaultClient),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (!(args.event in DEVICE_EVENTS)) fail("invalid_argument", "Unknown Vault event.");
    const needsItem = DEVICE_EVENTS[args.event as DeviceEvent];
    if (needsItem && !args.itemId) fail("invalid_argument", "This event names an item.");
    let itemKind = args.itemKind;
    if (args.itemId) {
      const item = await ctx.db
        .query("vaultItems")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.itemId!))
        .unique();
      if (!item || item.vaultId !== vault._id) fail("not_found", "Item not found.");
      itemKind = item.kind;
    }
    if (args.sealedDetail && args.sealedDetail.byteLength > 4096) fail("invalid_argument", "Too much detail.");
    if (args.detail && Object.keys(args.detail).length > 12) fail("invalid_argument", "Too much detail.");
    await appendLog(ctx, vault, {
      event: args.event,
      actor: { profile, role },
      ...(args.itemId ? { item: { publicId: args.itemId, kind: itemKind ?? "unknown" } } : {}),
      ...(args.sealedDetail ? { sealedDetail: args.sealedDetail } : {}),
      ...(args.detail ? { detail: args.detail } : {}),
      client: args.client,
      source: "device",
    });
    return null;
  },
});

/** The signature over an export or an anchor: HMAC with the server's own secret. */
const sign = (what: string) => keyedHash(what, "vault-log-signature");

/**
 * One page of the whole log for an export (owner and custodians), oldest first, with a signature over the page's
 * hashes. Starting an export (`after` 0) is logged, with the format.
 */
export const exportPage = mutation({
  args: { vaultId: v.string(), after: v.number(), format: v.union(v.literal("csv"), v.literal("json"), v.literal("pdf")), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const { profile, vault, role, all } = await readable(ctx, await requireProfile(ctx), args.vaultId);
    if (!all) fail("forbidden", "Only the Vault's custodians can export its log.");
    const rows = await ctx.db
      .query("vaultLog")
      .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId).gt("seq", args.after))
      .take(EXPORT_PAGE);
    if (args.after === 0) await appendLog(ctx, vault, { event: "log.exported", actor: { profile, role }, detail: { format: args.format, upToSeq: vault.logSeq }, client: args.client });
    const entries = rows.map(shape);
    const last = entries.at(-1);
    return {
      entries,
      next: rows.length === EXPORT_PAGE ? last!.seq : null,
      signature: last ? await sign(`${vault.publicId}:${entries[0]!.seq}:${last.seq}:${last.hash}`) : null,
    };
  },
});

/**
 * The integrity check (owner and custodians): every kept entry's hash recomputes, each chains to the one before,
 * the newest is the Vault's head, the oldest starts the chain (or follows entries that expired), and every
 * anchor's signature holds. Checks up to 5,000 entries per call; `after` continues.
 */
export const verify = query({
  args: { vaultId: v.string(), after: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { vault, all } = await readable(ctx, await requireProfile(ctx), args.vaultId);
    if (!all) fail("forbidden", "Only the Vault's custodians can check the log.");
    const after = args.after ?? 0;
    const rows = await ctx.db
      .query("vaultLog")
      .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId).gt("seq", after))
      .take(5000);
    let prev: Doc<"vaultLog"> | null = after
      ? await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId).eq("seq", after))
          .unique()
      : null;
    const genesis = await genesisHash(vault.publicId);
    for (const e of rows) {
      const { _id, _creationTime, hash, ...rest } = e;
      void _id;
      void _creationTime;
      if ((await entryHash(rest)) !== hash) return { ok: false as const, brokenAt: e.seq, why: "changed" as const, checked: e.seq };
      if (prev) {
        if (e.seq !== prev.seq + 1 || e.prevHash !== prev.hash) return { ok: false as const, brokenAt: e.seq, why: "gap" as const, checked: e.seq };
      } else if (e.seq === 1 && e.prevHash !== genesis) {
        return { ok: false as const, brokenAt: e.seq, why: "start" as const, checked: e.seq };
      }
      prev = e;
    }
    const done = rows.length < 5000;
    if (done && prev && (prev.seq !== vault.logSeq || prev.hash !== vault.logHead)) return { ok: false as const, brokenAt: prev.seq, why: "head" as const, checked: prev.seq };
    if (done) {
      for (const a of await ctx.db
        .query("vaultLogAnchors")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId))
        .collect()) {
        if (a.signature !== (await sign(`${a.vaultPublicId}:${a.seq}:${a.hash}`))) return { ok: false as const, brokenAt: a.seq, why: "anchor" as const, checked: prev?.seq ?? 0 };
        const at = await ctx.db
          .query("vaultLog")
          .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId).eq("seq", a.seq))
          .unique();
        if (at && at.hash !== a.hash) return { ok: false as const, brokenAt: a.seq, why: "anchor" as const, checked: prev?.seq ?? 0 };
      }
    }
    return { ok: true as const, checked: prev?.seq ?? after, next: done ? null : (prev?.seq ?? null), oldest: rows[0]?.seq ?? null };
  },
});

/** Daily: each Vault whose log moved gets an anchor, the server's signature over its newest entry's hash. */
export const anchor = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for await (const vault of ctx.db.query("vaults")) {
      if (!vault.logSeq) continue;
      const last = await ctx.db
        .query("vaultLogAnchors")
        .withIndex("by_vault_seq", (q) => q.eq("vaultPublicId", vault.publicId))
        .order("desc")
        .first();
      if (last && last.seq === vault.logSeq) continue;
      await ctx.db.insert("vaultLogAnchors", {
        vaultPublicId: vault.publicId,
        seq: vault.logSeq,
        hash: vault.logHead,
        signature: await sign(`${vault.publicId}:${vault.logSeq}:${vault.logHead}`),
        at: now,
        expiresAt: now + LOG_RETENTION_MS,
      });
    }
    return null;
  },
});

/**
 * Daily: entries and anchors 3 years old go, and nothing else, ever (the only delete of the log). Runs in batches
 * and calls itself again until none are left.
 */
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const old = await ctx.db
      .query("vaultLog")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(500);
    const oldAnchors = await ctx.db
      .query("vaultLogAnchors")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(500);
    for (const row of [...old, ...oldAnchors]) await ctx.db.delete(row._id);
    const more = old.length === 500 || oldAnchors.length === 500;
    if (more) await ctx.scheduler.runAfter(0, internal.vaultLog.expire, {});
    return { removed: old.length + oldAnchors.length, more };
  },
});

