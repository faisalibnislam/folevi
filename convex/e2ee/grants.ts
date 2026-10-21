// End-to-end encryption: handing keys to people (docs/E2EE_DESIGN.md §4.9, §8.2 to §8.4, §5.3). A
// workspace's space key goes to each member's account key; a shared page's note key goes to each guest's.
// Devices seal the keys; the server checks who may receive them and stores the sealed boxes. WP2.
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertWritable, documentAccess, documentAccessInfo, getDocumentByPublicId, requireDocument, requireProfile, resolveScope, accessAtLeast } from "../lib/auth";
import { fail } from "../lib/errors";
import { canShareDocument, MANAGER_ONLY } from "../lib/permissions";
import { insertScoped, scopeKey, scopeOfRow, vScopeArg, type Scope } from "../lib/scope";
import { nextSeq } from "../lib/seq";
import { activeAccount, b64u, checkBytes, expectStatement, profileIdOf, requireSpace, storeGrants } from "../lib/e2ee/keyStore";
import { E2EE_LIMITS, vNoteGrantStatement, vNoteKeyWrapInput, vSpaceGrantInput, type NoteKeyWrapInput } from "../lib/e2ee/validators";

/** Ancestors walked for inherited page grants (as lib/auth.ts inheritedGrant). */
const MAX_DEPTH = 12;

/** Fulfils pending grants (or adds versions for history): the space key, sealed to members. Owners and admins only. */
export const grantSpace = mutation({
  args: { scope: vScopeArg, grants: v.array(vSpaceGrantInput) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const access = await resolveScope(ctx, profile, args.scope);
    if (access.role !== "owner" && access.role !== "admin") fail("forbidden", MANAGER_ONLY);
    const granted = await storeGrants(ctx, access.scope, profile._id, args.grants);
    const space = await requireSpace(ctx, access.scope);
    await ctx.db.patch(space._id, { seq: await nextSeq(ctx, access.scope) });
    return { granted: granted.size };
  },
});

/** People waiting for a key in this space, with whether they have keys yet (owners and admins; §8.2). */
export const pending = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const access = await resolveScope(ctx, profile, args.scope);
    if (access.role !== "owner" && access.role !== "admin") fail("forbidden", MANAGER_ONLY);
    const rows = await ctx.db
      .query("e2eePendingGrants")
      .withIndex("by_scope", (q) => q.eq("scopeKey", scopeKey(access.scope)))
      .take(1000);
    const out = [];
    for (const p of rows) {
      const person = await ctx.db.get(p.profileId);
      const account = await activeAccount(ctx, p.profileId);
      const doc = p.documentId ? await ctx.db.get(p.documentId) : null;
      out.push({
        profileId: p.profileId as string,
        displayName: person?.displayName ?? "",
        reason: p.reason,
        documentId: doc?.publicId ?? null,
        hasKeys: account !== null,
        epoch: account?.epoch ?? null,
        createdAt: p.createdAt,
      });
    }
    return out;
  },
});

/** The note key versions that exist for a note (any wrapping). */
async function noteKeyRows(ctx: QueryCtx, documentId: Id<"documents">): Promise<Doc<"e2eeNoteKeys">[]> {
  return await ctx.db
    .query("e2eeNoteKeys")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(2000);
}

/** The people holding a page grant on `doc` or one of its ancestors, with the page that grants it. */
async function pageGrantees(ctx: QueryCtx, doc: Doc<"documents">): Promise<Map<Id<"profiles">, { role: Doc<"documentPermissions">["role"]; via: Doc<"documents"> }>> {
  const out = new Map<Id<"profiles">, { role: Doc<"documentPermissions">["role"]; via: Doc<"documents"> }>();
  let cursor: Doc<"documents"> | null = doc;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
    const current: Doc<"documents"> = cursor;
    const grants = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document", (q) => q.eq("documentId", current._id))
      .take(500);
    for (const g of grants) if (!out.has(g.profileId)) out.set(g.profileId, { role: g.role, via: current });
    cursor = current.parentDocumentId ? await ctx.db.get(current.parentDocumentId) : null;
  }
  return out;
}

/** Checks one grant-wrapped note key (a guest's) and returns the guest. */
async function checkGuestWrap(
  ctx: QueryCtx,
  doc: Doc<"documents">,
  granter: Id<"profiles">,
  w: { profileId: string; version: number; wrapped: ArrayBuffer; statement?: { kind: "note-grant"; body: string; sig: string } },
  grantees: Map<Id<"profiles">, unknown>,
): Promise<Id<"profiles">> {
  const profileId = profileIdOf(ctx, w.profileId);
  if (!grantees.has(profileId)) fail("forbidden", "Share the page with them first.");
  const account = await activeAccount(ctx, profileId);
  if (!account) fail("conflict", "They haven't set up encryption yet.");
  if (!w.statement) fail("invalid_argument", "A note key for a person is signed by the person sharing it.");
  checkBytes(w.wrapped, "A note key", 49 + 16, E2EE_LIMITS.keyWrapBytes);
  expectStatement(w.statement, { documentId: doc.publicId, version: w.version, profileId: w.profileId, granteeX25519Pub: b64u(account.x25519Pub), grantedBy: granter });
  return profileId;
}

/**
 * Gives a page's note key to a person it's shared with (a guest, or a member on a restricted page; §8.4).
 * Replaces their grant of that version and clears their "page" pending grant.
 */
export const grantNote = mutation({
  args: { documentId: v.string(), version: v.number(), profileId: v.string(), wrapped: v.bytes(), statement: vNoteGrantStatement },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) fail("not_found", "Document not found.");
    const info = await documentAccessInfo(ctx, profile, doc);
    if (info.access === "none") fail("not_found", "Document not found.");
    if (!canShareDocument(info)) fail("forbidden", "You don't have permission to share this page.");
    if (!(await noteKeyRows(ctx, doc._id)).some((r) => r.version === args.version)) fail("invalid_argument", "That note key version doesn't exist.");
    const grantees = await pageGrantees(ctx, doc);
    const guest = await checkGuestWrap(ctx, doc, profile._id, args, grantees);
    const scope = scopeOfRow(doc);
    for (const r of await grantRowsOf(ctx, doc._id, guest)) if (r.version === args.version) await ctx.db.delete(r._id);
    await insertScoped(ctx, "e2eeNoteKeys", scope, {
      documentId: doc._id,
      version: args.version,
      wrappedBy: "grant",
      profileId: guest,
      wrapped: args.wrapped,
      statement: args.statement,
      createdBy: profile._id,
      createdAt: Date.now(),
      seq: await nextSeq(ctx, scope),
    });
    const waiting = await ctx.db
      .query("e2eePendingGrants")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(200);
    for (const p of waiting) if (p.profileId === guest && p.reason === "page") await ctx.db.delete(p._id);
    return null;
  },
});

async function grantRowsOf(ctx: QueryCtx, documentId: Id<"documents">, profileId: Id<"profiles">): Promise<Doc<"e2eeNoteKeys">[]> {
  return await ctx.db
    .query("e2eeNoteKeys")
    .withIndex("by_document_grantee", (q) => q.eq("documentId", documentId).eq("profileId", profileId))
    .take(500);
}

/**
 * The people with page grants on a note or its ancestors and their account keys, so a device creating a
 * sub-page (or rotating the note key) wraps its key for them too (§6.6 step 3). `keys` is null for someone
 * without encryption set up.
 */
export const noteAudience = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const out = [];
    for (const [profileId, { role, via }] of await pageGrantees(ctx, doc)) {
      const account = await activeAccount(ctx, profileId);
      out.push({
        profileId: profileId as string,
        role,
        viaDocumentId: via.publicId,
        keys: account ? { epoch: account.epoch, x25519Pub: account.x25519Pub, ed25519Pub: account.ed25519Pub, statement: account.statement } : null,
      });
    }
    return out;
  },
});

/**
 * Changes one note's key (a link revoked, a guest removed; §4.9): version n+1 wrapped by the current space key
 * and for each remaining guest and link. Grants and link wraps of older versions for people and links left
 * out are deleted; the space-wrapped old versions stay until the note's rows are re-sealed.
 */
export const rotateNoteKey = mutation({
  args: { documentId: v.string(), version: v.number(), wraps: v.array(vNoteKeyWrapInput) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (args.wraps.length > E2EE_LIMITS.batch) fail("invalid_argument", "Too many wraps in one call.");
    const scope = scopeOfRow(doc);
    const space = await requireSpace(ctx, scope);
    const rows = await noteKeyRows(ctx, doc._id);
    const newest = rows.reduce((n, r) => Math.max(n, r.version), 0);
    if (newest < 1) fail("invalid_argument", "This note has no key yet.");
    if (args.version !== newest + 1) fail("conflict", "This note's key changed on another device. Reload and try again.");
    if (!args.wraps.some((w) => w.wrappedBy === "space" && w.spaceVersion === space.currentKeyVersion)) fail("invalid_argument", "Wrap the new note key with the current space key.");
    const grantees = await pageGrantees(ctx, doc);
    const keepPeople = new Set<Id<"profiles">>();
    const keepLinks = new Set<Id<"publicLinks">>();
    const seq = await nextSeq(ctx, scope);
    const now = Date.now();
    for (const w of args.wraps) {
      if (w.documentId !== doc.publicId || w.version !== args.version) fail("invalid_argument", "Every wrap is of the new version of this note's key.");
      const base = { documentId: doc._id, version: args.version, wrapped: w.wrapped, createdBy: profile._id, createdAt: now, seq };
      if (w.wrappedBy === "space") {
        if (w.spaceVersion !== space.currentKeyVersion) fail("invalid_argument", "Wrap the new note key with the current space key.");
        checkBytes(w.wrapped, "A note key", 22 + 16, E2EE_LIMITS.keyWrapBytes);
        await insertScoped(ctx, "e2eeNoteKeys", scope, { ...base, wrappedBy: "space", spaceVersion: w.spaceVersion });
      } else if (w.wrappedBy === "grant") {
        const guest = await checkGuestWrap(ctx, doc, profile._id, { profileId: w.profileId ?? "", version: w.version, wrapped: w.wrapped, statement: w.statement }, grantees);
        keepPeople.add(guest);
        await insertScoped(ctx, "e2eeNoteKeys", scope, { ...base, wrappedBy: "grant", profileId: guest, statement: w.statement });
      } else {
        const link = await linkOf(ctx, doc, w);
        keepLinks.add(link._id);
        checkBytes(w.wrapped, "A note key", 22 + 16, E2EE_LIMITS.keyWrapBytes);
        await insertScoped(ctx, "e2eeNoteKeys", scope, { ...base, wrappedBy: "link", linkId: link._id });
      }
    }
    // People and links left out lose every version of this note's key.
    for (const r of rows) {
      if (r.wrappedBy === "grant" && r.profileId && !keepPeople.has(r.profileId)) await ctx.db.delete(r._id);
      if (r.wrappedBy === "link" && r.linkId && !keepLinks.has(r.linkId)) await ctx.db.delete(r._id);
    }
    return { version: args.version };
  },
});

async function linkOf(ctx: QueryCtx, doc: Doc<"documents">, w: NoteKeyWrapInput): Promise<Doc<"publicLinks">> {
  if (!w.linkId) fail("invalid_argument", "A link wrap names its link.");
  const link = await ctx.db
    .query("publicLinks")
    .withIndex("by_public_id", (q) => q.eq("publicId", w.linkId!))
    .unique();
  if (!link || link.documentId !== doc._id || link.revokedAt !== undefined) fail("not_found", "Link not found.");
  return link;
}

/**
 * The caller's note keys for notes they open outside a replica (a guest; §8.4): their grant-wrapped keys,
 * and the space-wrapped ones when they belong to the note's space. Notes they can't read are left out.
 */
export const myNoteKeys = query({
  args: { documentIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.documentIds.length > 100) fail("invalid_argument", "Too many notes in one call.");
    const out = [];
    const memberOf = new Map<string, boolean>();
    for (const id of args.documentIds) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
      const scope = scopeOfRow(doc);
      const key = scopeKey(scope);
      if (!memberOf.has(key)) memberOf.set(key, await holdsSpace(ctx, scope, profile._id));
      const rows = [...(await grantRowsOf(ctx, doc._id, profile._id)), ...(memberOf.get(key) ? (await noteKeyRows(ctx, doc._id)).filter((r) => r.wrappedBy === "space") : [])];
      for (const r of rows) {
        out.push({
          documentId: doc.publicId,
          version: r.version,
          wrappedBy: r.wrappedBy,
          spaceVersion: r.spaceVersion ?? null,
          wrapped: r.wrapped,
          statement: r.statement ?? null,
          grantedBy: r.createdBy as string,
        });
      }
    }
    return out;
  },
});

/** Whether the person holds any grant of the scope's space key (so space-wrapped note keys are useful to them). */
async function holdsSpace(ctx: QueryCtx, scope: Scope, profileId: Id<"profiles">): Promise<boolean> {
  const g = await ctx.db
    .query("e2eeSpaceGrants")
    .withIndex("by_scope_profile", (q) => q.eq("scopeKey", scopeKey(scope)).eq("profileId", profileId))
    .first();
  return g !== null;
}

/** For WP4's sharing hooks: a page shared with someone who has no keys yet waits as a "page" pending grant. */
export async function addPagePending(ctx: MutationCtx, doc: Doc<"documents">, profileId: Id<"profiles">): Promise<void> {
  const scope = scopeOfRow(doc);
  const rows = await ctx.db
    .query("e2eePendingGrants")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .take(200);
  if (rows.some((r) => r.profileId === profileId && r.reason === "page")) return;
  await insertScoped(ctx, "e2eePendingGrants", scope, { scopeKey: scopeKey(scope), profileId, reason: "page", documentId: doc._id, createdAt: Date.now() });
}
