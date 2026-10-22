// Sealed variants of the content mutations that take plaintext today (docs/E2EE_DESIGN.md §5.3
// e2ee.content). Each mirrors the original's permission checks and limits, takes client-chosen public ids
// (ULIDs), stamps `seq` from the scope counter and bumps the note's `seq` when it changes note-level data.
// Names, bodies and records arrive sealed (FLV1 0x03); the server checks their headers, sizes and key
// versions and never opens them. WP3.
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { MAX_FOLDER_DEPTH, canNestFolderIn, isValidId, rankBetween } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, documentAccessInfo, getDocumentByPublicId, requireDocument, requireProfile, requireRowScope, resolveScope } from "../lib/auth";
import { fail } from "../lib/errors";
import { consume } from "../lib/rateLimit";
import { nextSeq } from "../lib/seq";
import { inScope, insertScoped, sameScopeRows, scopeKey, scopeOfRow, vScopeArg, type Scope } from "../lib/scope";
import { isFolderColor, randomFolderColor } from "../lib/folderColors";
import { notify } from "../lib/notify";
import { requireAccount, requireTwoMethods } from "../lib/e2ee/keyStore";
import { failE2ee, spaceE2ee, switchesOf } from "../lib/e2ee/state";
import { E2EE_LIMITS, vRecordKind, type RecordKind } from "../lib/e2ee/validators";
import { NoteKeyVersions, checkRecord, lockOfFolder, recordHeaderVersion } from "../lib/e2ee/sealedRows";
import { PERSONAL_KINDS, SEALED_VERSION_NAME, checkSealedVersion, findRecord, startLockMigration, vSealedVersionContent, writeRecord, writeSnapshotChunks } from "../lib/e2ee/sealedWrites";

const TAG_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"];
/** Kinds of records that belong to a note (sealed with its note key, §4.5). */
const NOTE_KINDS: ReadonlySet<RecordKind> = new Set(["collection", "fileText", "studyReview"]);
const MAX_SEALED_COMMENT = 64 * 1024;
const MAX_MENTIONS = 50;

// ---------------------------------------------------------------- shared checks

/** The space of a scope; sealed writes need one with a key (e2ee_not_set_up). */
async function requireSpaceRow(ctx: MutationCtx, scope: Scope): Promise<Doc<"e2eeSpaces">> {
  const space = await spaceE2ee(ctx, scope);
  if (!space || space.currentKeyVersion < 1) failE2ee("e2ee_not_set_up");
  return space;
}

/** A name sealed with the space key (folders, tags): a keyed record with a space key version that exists. */
async function spaceSealed(ctx: MutationCtx, scope: Scope, bytes: ArrayBuffer, what: string): Promise<{ c: ArrayBuffer; k: number }> {
  const c = checkRecord(bytes, E2EE_LIMITS.fieldBytes, what);
  const k = recordHeaderVersion(c)!;
  const key = await ctx.db
    .query("e2eeSpaceKeys")
    .withIndex("by_scope_version", (q) => q.eq("scopeKey", scopeKey(scope)).eq("version", k))
    .unique();
  if (!key) failE2ee("e2ee_not_set_up", `${what}: this space has no key with that version.`);
  return { c, k };
}

/** A field sealed with one of a note's keys (comments, version names, metas). */
async function noteSealed(ctx: MutationCtx, doc: Doc<"documents">, bytes: ArrayBuffer, what: string, max: number = E2EE_LIMITS.fieldBytes): Promise<{ c: ArrayBuffer; k: number }> {
  const c = checkRecord(bytes, max, what);
  const k = recordHeaderVersion(c)!;
  if (!(await new NoteKeyVersions(ctx).has(doc._id, k))) failE2ee("e2ee_plaintext", `${what}: this note has no key with that version.`);
  return { c, k };
}

function requireSealedDoc(doc: Doc<"documents">) {
  if (doc.sealedAt === undefined) fail("invalid_argument", "This note isn't encrypted.");
}

function checkId(id: string, what: string): string {
  if (!isValidId(id)) fail("invalid_argument", `Invalid ${what} id.`);
  return id;
}

/** Whether previews may be stored for this note (the switch is on, and the note isn't locked, §7.7). */
async function previewsAllowed(ctx: MutationCtx, doc: Doc<"documents">): Promise<boolean> {
  if (doc.locked || doc.lockedVia !== undefined) return false;
  return switchesOf(await spaceE2ee(ctx, scopeOfRow(doc))).notificationPreviews;
}

// ---------------------------------------------------------------- folders

async function scopeFolders(ctx: MutationCtx, scope: Scope): Promise<Doc<"folders">[]> {
  const base = ctx.db.query("folders");
  return await (scope.kind === "personal" ? base.withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))).collect();
}

/** organization.createFolder with a sealed name. Sending the same create again returns the folder it made. */
export const createFolder = mutation({
  args: {
    scope: vScopeArg,
    folderId: v.string(),
    parentFolderId: v.optional(v.union(v.string(), v.null())),
    sealedName: v.bytes(),
    color: v.optional(v.string()),
    rank: v.optional(v.string()),
    locked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    const space = await requireSpaceRow(ctx, scope);
    checkId(args.folderId, "folder");
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId))
      .unique();
    if (existing) {
      if (existing.createdBy !== profile._id || !inScope(existing, scope)) fail("invalid_argument", "That folder id is taken.");
      return { id: existing.publicId };
    }
    let parentFolderId: Id<"folders"> | undefined;
    if (args.parentFolderId) {
      const parent = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.parentFolderId!))
        .unique();
      if (!parent || !inScope(parent, scope) || parent.deletedAt) fail("not_found", "Folder not found.");
      parentFolderId = parent._id;
    }
    const all = await scopeFolders(ctx, scope);
    // The same nesting limit as organization.createFolder (packages/editor-schema folders.ts).
    const links = all.filter((f) => !f.deletedAt).map((f) => ({ id: f._id as string, parentFolderId: (f.parentFolderId as string | undefined) ?? null }));
    if (parentFolderId && !canNestFolderIn(links, parentFolderId)) fail("invalid_argument", `Folders can be nested up to ${MAX_FOLDER_DEPTH} levels deep.`);
    if (args.color !== undefined && !isFolderColor(args.color)) fail("invalid_argument", "Unknown folder colour.");
    if (args.rank !== undefined && (args.rank.length < 1 || args.rank.length > 200)) fail("invalid_argument", "Invalid rank.");
    const sealedName = await spaceSealed(ctx, scope, args.sealedName, "The folder name");
    const now = Date.now();
    const seq = await nextSeq(ctx, scope);
    await insertScoped(ctx, "folders", scope, {
      publicId: args.folderId,
      parentFolderId,
      name: "",
      sealedName,
      color: args.color ?? randomFolderColor(),
      rank: args.rank ?? rankBetween(all.map((f) => f.rank).sort().pop() ?? null, null),
      createdBy: profile._id,
      createdAt: now,
      updatedAt: now,
      seq,
      ...(args.locked ? { locked: true } : {}),
    });
    if (args.locked) await ctx.db.patch(space._id, { lockedCount: space.lockedCount + 1, seq });
    return { id: args.folderId };
  },
});

async function folderFor(ctx: MutationCtx, folderPublicId: string) {
  const profile = await requireProfile(ctx);
  await assertWritable(ctx, profile);
  const folder = await ctx.db
    .query("folders")
    .withIndex("by_public_id", (q) => q.eq("publicId", folderPublicId))
    .unique();
  if (!folder || folder.deletedAt) fail("not_found", "Folder not found.");
  const { scope } = await requireRowScope(ctx, profile, folder, "edit", "Folder not found.");
  return { profile, folder, scope };
}

/** organization.renameFolder with a sealed name (also how the migration seals existing folder names). */
export const renameFolder = mutation({
  args: { folderId: v.string(), sealedName: v.bytes() },
  handler: async (ctx, args) => {
    const { folder, scope } = await folderFor(ctx, args.folderId);
    await requireSpaceRow(ctx, scope);
    const sealedName = await spaceSealed(ctx, scope, args.sealedName, "The folder name");
    await ctx.db.patch(folder._id, { name: "", icon: undefined, sealedName, updatedAt: Date.now(), seq: await nextSeq(ctx, scope) });
    return null;
  },
});

// ---------------------------------------------------------------- tags

async function tagByMac(ctx: MutationCtx, scope: Scope, nameMac: string): Promise<Doc<"tags"> | null> {
  const base = ctx.db.query("tags");
  return await (
    scope.kind === "personal"
      ? base.withIndex("by_owner_name_mac", (q) => q.eq("ownerProfileId", scope.profileId).eq("nameMac", nameMac))
      : base.withIndex("by_workspace_name_mac", (q) => q.eq("workspaceId", scope.workspaceId).eq("nameMac", nameMac))
  ).first();
}

function checkNameMac(mac: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/.test(mac)) fail("invalid_argument", "Invalid tag check value.");
  return mac;
}

/** organization.createTag with a sealed name; the duplicate check is blind, by `nameMac` (§4.5). */
export const createTag = mutation({
  args: { scope: vScopeArg, tagId: v.string(), sealedName: v.bytes(), nameMac: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    await requireSpaceRow(ctx, scope);
    checkId(args.tagId, "tag");
    const nameMac = checkNameMac(args.nameMac);
    const same = await tagByMac(ctx, scope, nameMac);
    if (same) return { id: same.publicId };
    const taken = await ctx.db
      .query("tags")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.tagId))
      .unique();
    if (taken) fail("invalid_argument", "That tag id is taken.");
    const sealedName = await spaceSealed(ctx, scope, args.sealedName, "The tag name");
    await insertScoped(ctx, "tags", scope, {
      publicId: args.tagId,
      name: "",
      // The existing duplicate check by normalizedName keeps working blind.
      normalizedName: nameMac,
      nameMac,
      sealedName,
      color: TAG_COLORS.includes(args.color ?? "") ? args.color! : TAG_COLORS[Math.floor(Math.random() * 5)]!,
      createdAt: Date.now(),
      seq: await nextSeq(ctx, scope),
    });
    return { id: args.tagId };
  },
});

/** organization.updateTag with a sealed name. A new name needs its `nameMac` (refused if another tag has it). */
export const updateTag = mutation({
  args: { tagId: v.string(), sealedName: v.optional(v.bytes()), nameMac: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.tagId))
      .unique();
    if (!tag) fail("not_found", "Tag not found.");
    const { scope } = await requireRowScope(ctx, profile, tag, "edit", "Tag not found.");
    await requireSpaceRow(ctx, scope);
    if ((args.sealedName === undefined) !== (args.nameMac === undefined)) fail("invalid_argument", "A new tag name needs its check value.");
    const patch: Partial<Doc<"tags">> = {};
    if (args.sealedName !== undefined && args.nameMac !== undefined) {
      const nameMac = checkNameMac(args.nameMac);
      const clash = await tagByMac(ctx, scope, nameMac);
      if (clash && clash._id !== tag._id) fail("invalid_argument", "There's already a tag with that name.");
      patch.sealedName = await spaceSealed(ctx, scope, args.sealedName, "The tag name");
      patch.nameMac = nameMac;
      patch.normalizedName = nameMac;
      patch.name = "";
    }
    if (args.color !== undefined) {
      if (!TAG_COLORS.includes(args.color)) fail("invalid_argument", "Unknown tag color.");
      patch.color = args.color;
    }
    await ctx.db.patch(tag._id, { ...patch, seq: await nextSeq(ctx, scope) });
    return null;
  },
});

/**
 * organization.setDocumentTags for a sealed note: the same rules, and every link it keeps or adds is stamped
 * with the change's `seq` (the note's too), so replicas see tag changes (§5.2 documentTags.seq).
 */
export const setDocumentTags = mutation({
  args: { documentId: v.string(), tagIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (!(await documentAccessInfo(ctx, profile, doc)).inScope) fail("forbidden", "Only members can tag pages.");
    await applyDocumentTags(ctx, doc, args.tagIds);
    return null;
  },
});

/** Replaces a note's tags, stamping `seq` on the note and its tag links. Shared with organization.setDocumentTags. */
export async function applyDocumentTags(ctx: MutationCtx, doc: Doc<"documents">, tagIds: string[]): Promise<void> {
  const wanted = new Map<string, Id<"tags">>();
  for (const id of tagIds.slice(0, 20)) {
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_public_id", (q) => q.eq("publicId", id))
      .unique();
    if (!tag || !sameScopeRows(tag, doc)) fail("not_found", "Tag not found.");
    wanted.set(tag._id, tag._id);
  }
  const seq = await nextSeq(ctx, scopeOfRow(doc));
  const existing = await ctx.db
    .query("documentTags")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  for (const e of existing) {
    if (!wanted.has(e.tagId)) await ctx.db.delete(e._id);
    else await ctx.db.patch(e._id, { seq });
  }
  const have = new Set(existing.map((e) => e.tagId as string));
  for (const t of wanted.keys()) if (!have.has(t)) await insertScoped(ctx, "documentTags", scopeOfRow(doc), { documentId: doc._id, tagId: wanted.get(t)!, seq });
  await ctx.db.patch(doc._id, { seq, updatedAt: Date.now() });
}

// ---------------------------------------------------------------- records

/** Where a record lives and who may write it. */
async function recordTarget(ctx: MutationCtx, profile: Doc<"profiles">, scopeArg: Parameters<typeof resolveScope>[2], kind: RecordKind, documentId: string | undefined) {
  if (NOTE_KINDS.has(kind) && kind !== "studyReview" && !documentId) fail("invalid_argument", "This record belongs to a note.");
  if (documentId) {
    // A record under a note: its readers may keep their own (a study schedule); its writers the shared ones.
    const { doc } = await requireDocument(ctx, profile, documentId, PERSONAL_KINDS.has(kind) ? "read" : "write");
    requireSealedDoc(doc);
    await requireSpaceRow(ctx, scopeOfRow(doc));
    return { scope: scopeOfRow(doc), doc };
  }
  const { scope } = await resolveScope(ctx, profile, scopeArg, PERSONAL_KINDS.has(kind) ? "view" : "edit");
  await requireSpaceRow(ctx, scope);
  return { scope, doc: null };
}

/** A sealed record (collections on a host note, found text, study schedules, Foli AI chats, settings). `baseRev` 0 creates. */
export const putRecord = mutation({
  args: { scope: vScopeArg, kind: vRecordKind, recordId: v.string(), documentId: v.optional(v.string()), sealed: v.bytes(), keyVersion: v.number(), baseRev: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "syncBatch", profile._id);
    const at = await recordTarget(ctx, profile, args.scope, args.kind, args.documentId);
    return await writeRecord(ctx, profile, at, { kind: args.kind, recordId: args.recordId, sealed: args.sealed, keyVersion: args.keyVersion, baseRev: args.baseRev });
  },
});

/** Deletes a sealed record (a tombstone, so replicas learn of it): compare-and-set on `rev`. */
export const deleteRecord = mutation({
  args: { scope: vScopeArg, kind: vRecordKind, recordId: v.string(), documentId: v.optional(v.string()), baseRev: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const at = await recordTarget(ctx, profile, args.scope, args.kind, args.documentId);
    const existing = await findRecord(ctx, at.scope, args.kind, args.recordId, PERSONAL_KINDS.has(args.kind) ? profile._id : undefined);
    if (!existing || existing.deletedAt !== undefined) return { rev: existing?.rev ?? 0 };
    if (existing.rev !== args.baseRev) failE2ee("e2ee_conflict");
    const rev = existing.rev + 1;
    await ctx.db.patch(existing._id, { sealed: new ArrayBuffer(0), size: 0, rev, deletedAt: Date.now(), updatedBy: profile._id, updatedAt: Date.now(), seq: await nextSeq(ctx, at.scope) });
    return { rev };
  },
});

// ---------------------------------------------------------------- comments

const vPreview = v.optional(v.object({ title: v.string(), excerpt: v.string() }));

/** Mentioned people who can read the note, as ids (anything else dropped), at most MAX_MENTIONS. */
async function mentionTargets(ctx: MutationCtx, doc: Doc<"documents">, ids: string[], actor: Id<"profiles">): Promise<Id<"profiles">[]> {
  const out: Id<"profiles">[] = [];
  for (const id of ids.slice(0, MAX_MENTIONS)) {
    const pid = ctx.db.normalizeId("profiles", id);
    if (!pid || pid === actor || out.includes(pid)) continue;
    const p = await ctx.db.get(pid);
    if (p && p.status !== "deleted" && accessAtLeast(await documentAccess(ctx, p, doc), "read")) out.push(pid);
  }
  return out;
}

/**
 * Tells people about a sealed comment with generic text (§7.7), or the preview the device sent when the
 * space has notification previews on. Mentions, thread participants on a reply, the note's creator and followers.
 */
async function notifySealed(
  ctx: MutationCtx,
  input: { actor: Doc<"profiles">; doc: Doc<"documents">; thread: Doc<"commentThreads">; commentId: string; mentions: Id<"profiles">[]; reply: boolean; preview?: { title: string; excerpt: string } },
) {
  const { actor, doc, thread } = input;
  const preview = input.preview && (await previewsAllowed(ctx, doc)) ? { title: input.preview.title.slice(0, 140), excerpt: input.preview.excerpt.slice(0, 140) } : null;
  // notify() writes the generic text for a sealed note unless `preview` is given (and allowed there too).
  const base = { actor, doc, threadId: thread._id, blockId: thread.blockId, commentId: input.commentId, excerpt: preview?.excerpt, ...(preview ? { preview } : {}) };
  const where = preview ? preview.title || "a note" : "a note";
  const done = new Set<string>([actor._id]);
  for (const pid of input.mentions) {
    if (done.has(pid)) continue;
    done.add(pid);
    await notify(ctx, { ...base, recipientId: pid, kind: "mention", title: `${actor.displayName} mentioned you in ${where}`, email: { key: "mention_notification" } });
  }
  if (input.reply) {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .take(200);
    for (const pid of [thread.createdBy, ...comments.filter((c) => !c.deletedAt).map((c) => c.authorId)]) {
      if (done.has(pid) || done.size > 100) continue;
      done.add(pid);
      await notify(ctx, { ...base, recipientId: pid, kind: "reply", title: preview ? `${actor.displayName} replied in ${where}` : `${actor.displayName} replied to your comment`, email: { key: "comment_notification" } });
    }
  }
  const followers = await ctx.db
    .query("noteSubscriptions")
    .withIndex("by_document_mode", (q) => q.eq("documentId", doc._id).eq("mode", "follow"))
    .take(100);
  for (const pid of [doc.createdBy, ...followers.map((f) => f.profileId)]) {
    if (done.has(pid) || done.size > 100) continue;
    done.add(pid);
    await notify(ctx, { ...base, recipientId: pid, kind: "comment", title: `${actor.displayName} commented on ${where}`, email: { key: "comment_notification" } });
  }
}

async function readThread(ctx: MutationCtx, profileId: Id<"profiles">, thread: Doc<"commentThreads">) {
  const read = await ctx.db
    .query("readStates")
    .withIndex("by_profile_thread", (q) => q.eq("profileId", profileId).eq("threadId", thread._id))
    .unique();
  const at = Date.now();
  if (read) await ctx.db.patch(read._id, { lastReadAt: at });
  else await ctx.db.insert("readStates", { profileId, threadId: thread._id, documentId: thread.documentId, lastReadAt: at });
}

/** comments.create for a sealed note: the body is sealed with the note key (context comment/<doc>/<comment>). */
export const createComment = mutation({
  args: { documentId: v.string(), blockId: v.optional(v.string()), threadId: v.string(), commentId: v.string(), sealedBody: v.bytes(), mentions: v.array(v.string()), preview: vPreview },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "comment");
    requireSealedDoc(doc);
    checkId(args.threadId, "comment");
    checkId(args.commentId, "comment");
    const existing = await ctx.db
      .query("commentThreads")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.threadId))
      .unique();
    if (existing) {
      if (existing.createdBy !== profile._id || existing.documentId !== doc._id) fail("invalid_argument", "That comment id is taken.");
      return { threadId: existing.publicId, commentId: args.commentId };
    }
    if (await commentByPublicId(ctx, args.commentId)) fail("invalid_argument", "That comment id is taken.");
    await consume(ctx, "comment", profile._id);
    if (args.blockId) {
      const block = await ctx.db
        .query("blocks")
        .withIndex("by_block_id", (q) => q.eq("blockId", args.blockId!))
        .unique();
      if (!block || block.documentId !== doc._id || block.deletedAt) fail("not_found", "Block not found.");
    }
    const sealedBody = await noteSealed(ctx, doc, args.sealedBody, "The comment", MAX_SEALED_COMMENT);
    const now = Date.now();
    const threadId = await insertScoped(ctx, "commentThreads", scopeOfRow(doc), {
      publicId: args.threadId,
      documentId: doc._id,
      blockId: args.blockId,
      status: "open",
      createdBy: profile._id,
      createdAt: now,
      lastActivityAt: now,
      commentCount: 1,
    });
    await insertScoped(ctx, "comments", scopeOfRow(doc), { publicId: args.commentId, threadId, documentId: doc._id, authorId: profile._id, body: [], sealedBody, createdAt: now });
    const thread = (await ctx.db.get(threadId))!;
    await readThread(ctx, profile._id, thread);
    await notifySealed(ctx, { actor: profile, doc, thread, commentId: args.commentId, mentions: await mentionTargets(ctx, doc, args.mentions, profile._id), reply: false, preview: args.preview });
    return { threadId: args.threadId, commentId: args.commentId };
  },
});

async function commentByPublicId(ctx: MutationCtx, publicId: string): Promise<Doc<"comments"> | null> {
  return await ctx.db
    .query("comments")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
}

/** comments.reply for a sealed note. */
export const replyComment = mutation({
  args: { threadId: v.string(), commentId: v.string(), sealedBody: v.bytes(), mentions: v.array(v.string()), preview: vPreview },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const thread = await ctx.db
      .query("commentThreads")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.threadId))
      .unique();
    if (!thread) fail("not_found", "Comment not found.");
    const doc = (await ctx.db.get(thread.documentId))!;
    const access = await documentAccess(ctx, profile, doc);
    if (access === "none") fail("not_found", "Comment not found.");
    if (!accessAtLeast(access, "comment")) fail("forbidden", "You can't comment on this document.");
    requireSealedDoc(doc);
    checkId(args.commentId, "comment");
    const existing = await commentByPublicId(ctx, args.commentId);
    if (existing) {
      if (existing.authorId !== profile._id || existing.threadId !== thread._id) fail("invalid_argument", "That comment id is taken.");
      return { commentId: existing.publicId };
    }
    await consume(ctx, "comment", profile._id);
    const sealedBody = await noteSealed(ctx, doc, args.sealedBody, "The comment", MAX_SEALED_COMMENT);
    const now = Date.now();
    await insertScoped(ctx, "comments", scopeOfRow(thread), { publicId: args.commentId, threadId: thread._id, documentId: doc._id, authorId: profile._id, body: [], sealedBody, createdAt: now });
    await ctx.db.patch(thread._id, { lastActivityAt: now, commentCount: thread.commentCount + 1, status: "open", resolvedAt: undefined, resolvedBy: undefined });
    await readThread(ctx, profile._id, thread);
    await notifySealed(ctx, { actor: profile, doc, thread, commentId: args.commentId, mentions: await mentionTargets(ctx, doc, args.mentions, profile._id), reply: true, preview: args.preview });
    return { commentId: args.commentId };
  },
});

/**
 * comments.edit for a sealed note. `mentions` are the people the edit newly mentions (the device knows the
 * old body; the server can't compare sealed bodies).
 */
export const editComment = mutation({
  args: { commentId: v.string(), sealedBody: v.bytes(), mentions: v.array(v.string()), preview: vPreview },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const comment = await commentByPublicId(ctx, args.commentId);
    if (!comment || comment.deletedAt) fail("not_found", "Comment not found.");
    const doc = (await ctx.db.get(comment.documentId))!;
    const access = await documentAccess(ctx, profile, doc);
    if (access === "none") fail("not_found", "Comment not found.");
    if (comment.authorId !== profile._id) fail("forbidden", "You can only edit your own comments.");
    if (!accessAtLeast(access, "comment")) fail("forbidden", "You can't comment on this document.");
    requireSealedDoc(doc);
    await consume(ctx, "comment", profile._id);
    const sealedBody = await noteSealed(ctx, doc, args.sealedBody, "The comment", MAX_SEALED_COMMENT);
    await ctx.db.patch(comment._id, { body: [], sealedBody, editedAt: Date.now() });
    const thread = (await ctx.db.get(comment.threadId))!;
    const mentions = await mentionTargets(ctx, doc, args.mentions, profile._id);
    const preview = args.preview && (await previewsAllowed(ctx, doc)) ? args.preview : null;
    for (const pid of mentions) {
      await notify(ctx, {
        recipientId: pid,
        actor: profile,
        kind: "mention",
        doc,
        threadId: thread._id,
        blockId: thread.blockId,
        commentId: comment.publicId,
        title: `${profile.displayName} mentioned you in ${preview?.title.slice(0, 140) || "a note"}`,
        excerpt: preview?.excerpt.slice(0, 140),
        ...(preview ? { preview: { title: preview.title.slice(0, 140), excerpt: preview.excerpt.slice(0, 140) } } : {}),
        email: { key: "mention_notification" },
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------- versions

/** documents.nameVersion for a sealed note: the name sealed with the note key (context version-name/<doc>/<snapshot>). */
export const nameVersion = mutation({
  args: { snapshotId: v.string(), sealedName: v.union(v.bytes(), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const snap = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.snapshotId))
      .unique();
    if (!snap) fail("not_found", "Version not found.");
    const doc = await ctx.db.get(snap.documentId);
    if (!doc) fail("not_found", "Version not found.");
    await requireDocument(ctx, profile, doc.publicId, "write");
    requireSealedDoc(doc);
    // A named version is kept as long as the page is; the name itself is unreadable, so `name` holds a marker.
    if (args.sealedName === null) {
      await ctx.db.patch(snap._id, { sealedName: undefined, name: undefined });
      return null;
    }
    const sealedName = await noteSealed(ctx, doc, args.sealedName, "The version name");
    await ctx.db.patch(snap._id, { sealedName, name: SEALED_VERSION_NAME });
    return null;
  },
});

/** documents.importSnapshot for a sealed note: a version brought from elsewhere, already sealed. */
export const importVersion = mutation({
  args: { documentId: v.string(), id: v.string(), content: vSealedVersionContent, createdAt: v.number(), sealedName: v.optional(v.bytes()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (doc.ownerProfileId !== profile._id) fail("forbidden", "Only the note's owner can bring in its history.");
    requireSealedDoc(doc);
    checkId(args.id, "version");
    const existing = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.id))
      .unique();
    if (existing) {
      if (existing.documentId !== doc._id) fail("invalid_argument", "That version id is taken.");
      return { id: existing.publicId, created: false };
    }
    await consume(ctx, "snapshotImport", profile._id);
    const json = await checkSealedVersion(ctx, doc, args.content);
    const sealedName = args.sealedName ? await noteSealed(ctx, doc, args.sealedName, "The version name") : undefined;
    const now = Date.now();
    await writeSnapshotChunks(ctx, doc, {
      publicId: args.id,
      reason: "import",
      json,
      blockCount: args.content.blocks.length,
      contentSeq: -1,
      createdBy: profile._id,
      createdAt: Number.isFinite(args.createdAt) ? Math.max(0, Math.min(args.createdAt, now)) : now,
      sealedName,
    });
    return { id: args.id, created: true };
  },
});

// ---------------------------------------------------------------- collection rows

/** collections.setValue / renameRow / moveRow for a sealed row note: its values live in its sealed meta. */
export const setDocumentRowMeta = mutation({
  args: { documentId: v.string(), sealedMeta: v.bytes() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    requireSealedDoc(doc);
    const sealedMeta = await noteSealed(ctx, doc, args.sealedMeta, "The meta");
    const seq = await nextSeq(ctx, scopeOfRow(doc));
    await ctx.db.patch(doc._id, { sealedMeta, revision: doc.revision + 1, seq, updatedAt: Date.now(), lastEditedBy: profile._id });
    return null;
  },
});

// ---------------------------------------------------------------- locks (Always fully encrypted)

/** Docs whose lock follows `folder`: notes in it or its subfolders, and their sub-pages (bounded). */
async function lockedSubtree(ctx: MutationCtx, folder: Doc<"folders">): Promise<{ folders: Doc<"folders">[]; docs: Doc<"documents">[] }> {
  const folders: Doc<"folders">[] = [folder];
  for (let i = 0; i < folders.length && folders.length < 500; i++) {
    const kids = await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", folders[i]!._id))
      .take(200);
    folders.push(...kids.filter((k) => !k.deletedAt));
  }
  const docs: Doc<"documents">[] = [];
  for (const f of folders) {
    docs.push(
      ...(await ctx.db
        .query("documents")
        .withIndex("by_folder", (q) => q.eq("folderId", f._id))
        .take(2000)),
    );
    if (docs.length >= 5000) break;
  }
  for (let i = 0; i < docs.length && docs.length < 5000; i++) {
    docs.push(
      ...(await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentDocumentId", docs[i]!._id))
        .take(200)),
    );
  }
  return { folders, docs };
}

/** Recomputes `lockedVia` for the notes under a folder after its lock changed (kept in step, §5.7). */
export async function relockFolder(ctx: MutationCtx, folder: Doc<"folders">): Promise<Doc<"documents">[]> {
  const { docs } = await lockedSubtree(ctx, folder);
  const lockCache = new Map<string, Id<"folders"> | undefined>();
  const lockOf = async (folderId: Id<"folders"> | undefined) => {
    if (!folderId) return undefined;
    if (!lockCache.has(folderId)) lockCache.set(folderId, await lockOfFolder(ctx, folderId));
    return lockCache.get(folderId);
  };
  const byId = new Map(docs.map((d) => [d._id as string, d]));
  const lockOfDoc = async (d: Doc<"documents">): Promise<Id<"folders"> | undefined> => {
    let cur: Doc<"documents"> | undefined = d;
    for (let i = 0; cur && i < 12; i++) {
      if (!cur.parentDocumentId) return await lockOf(cur.folderId);
      cur = byId.get(cur.parentDocumentId) ?? (await ctx.db.get(cur.parentDocumentId)) ?? undefined;
    }
    return undefined;
  };
  for (const d of docs) {
    const lock = await lockOfDoc(d);
    if (lock !== d.lockedVia) await ctx.db.patch(d._id, { lockedVia: lock });
  }
  return docs;
}

/** Locking needs encryption set up for the person, two recovery methods (§4.7.5) and the space's key. */
async function lockPreconditions(ctx: MutationCtx, profile: Doc<"profiles">, scope: Scope): Promise<Doc<"e2eeSpaces">> {
  const account = await requireAccount(ctx, profile._id);
  await requireTwoMethods(ctx, account);
  return await requireSpaceRow(ctx, scope);
}

/**
 * Marks a folder Always fully encrypted, or not (§6.9). In a Standard space this starts a folder-scoped seal
 * (or, unlocking, unseal) migration for its notes; in an encrypted space the notes are already sealed and the
 * lock only removes their readable copies.
 */
export const setFolderLocked = mutation({
  args: { folderId: v.string(), locked: v.boolean() },
  handler: async (ctx, args) => {
    const { profile, folder, scope } = await folderFor(ctx, args.folderId);
    const space = await lockPreconditions(ctx, profile, scope);
    if (Boolean(folder.locked) === args.locked) return { migrationId: null };
    const seq = await nextSeq(ctx, scope);
    await ctx.db.patch(folder._id, { locked: args.locked || undefined, updatedAt: Date.now(), seq });
    await ctx.db.patch(space._id, { lockedCount: Math.max(0, space.lockedCount + (args.locked ? 1 : -1)), seq, changedBy: profile._id, changedAt: Date.now() });
    const docs = await relockFolder(ctx, (await ctx.db.get(folder._id))!);
    if (args.locked) await dropMirrors(ctx, docs);
    // Only notes that are readable now need converting: in an encrypted space they're sealed already.
    if (space.level !== "standard") return { migrationId: null };
    const needWork = args.locked ? docs.some((d) => d.sealedAt === undefined) : docs.some((d) => d.sealedAt !== undefined);
    if (!needWork) return { migrationId: null };
    const migrationId = await startLockMigration(ctx, scope, profile._id, { direction: args.locked ? "seal" : "unseal", scopeOf: "folder", rootId: folder.publicId, total: docs.length });
    return { migrationId: migrationId as string };
  },
});

/** Marks one note Always fully encrypted, or not (§6.9). The same as a folder, for one note and its sub-pages. */
export const setDocumentLocked = mutation({
  args: { documentId: v.string(), locked: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const scope = scopeOfRow(doc);
    if (!(await documentAccessInfo(ctx, profile, doc)).inScope) fail("forbidden", "Only members can change how a note is encrypted.");
    const space = await lockPreconditions(ctx, profile, scope);
    if (Boolean(doc.locked) === args.locked) return { migrationId: null };
    const seq = await nextSeq(ctx, scope);
    await ctx.db.patch(doc._id, { locked: args.locked || undefined, revision: doc.revision + 1, seq });
    await ctx.db.patch(space._id, { lockedCount: Math.max(0, space.lockedCount + (args.locked ? 1 : -1)), seq, changedBy: profile._id, changedAt: Date.now() });
    if (args.locked) await dropMirrors(ctx, [doc]);
    if (space.level !== "standard") return { migrationId: null };
    if (args.locked ? doc.sealedAt !== undefined : doc.sealedAt === undefined || doc.lockedVia !== undefined) return { migrationId: null };
    const migrationId = await startLockMigration(ctx, scope, profile._id, { direction: args.locked ? "seal" : "unseal", scopeOf: "document", rootId: doc.publicId, total: 1 });
    return { migrationId: migrationId as string };
  },
});

/** A locked note never has a readable copy (§7.1): its mirrors go at once. */
async function dropMirrors(ctx: MutationCtx, docs: Doc<"documents">[]) {
  for (const d of docs) {
    for (const purpose of ["search", "ai", "apps"] as const) {
      const row = await ctx.db
        .query("e2eeMirrors")
        .withIndex("by_document_purpose", (q) => q.eq("documentId", d._id).eq("purpose", purpose))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }
  }
}

// ---------------------------------------------------------------- the Inbox

/**
 * Names the sealed Inbox of an encrypted Personal (docs/E2EE_DESIGN.md §5.7 tasks.ensureInbox), for a device
 * that had to make one itself because tasks.inbox / quickAdd answered `e2ee_device_only`. The first one
 * registered wins: if another live Inbox is already named, its id comes back and the device uses that one
 * (and may delete its own). A workspace has one Inbox per person at its deterministic id
 * (`inboxDocumentId(profileId, scopeIdKey(scope))` from @folevi/editor-schema), so it needs no registration.
 */
export const setInbox = mutation({
  args: { scope: vScopeArg, documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    if (scope.kind !== "personal") fail("invalid_argument", "A workspace's Inboxes are each person's own, at a fixed id: nothing to register.");
    const space = await requireSpaceRow(ctx, scope);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !inScope(doc, scope) || doc.deletedAt !== undefined || doc.kind !== "document" || doc.parentDocumentId !== undefined) fail("not_found", "Document not found.");
    requireSealedDoc(doc);
    const current = space.inboxDocumentId ? await ctx.db.get(space.inboxDocumentId) : null;
    if (current && current._id !== doc._id && current.deletedAt === undefined && inScope(current, scope)) return { documentId: current.publicId };
    if (current?._id !== doc._id) await ctx.db.patch(space._id, { inboxDocumentId: doc._id, changedBy: profile._id, changedAt: Date.now(), seq: await nextSeq(ctx, scope) });
    return { documentId: doc.publicId };
  },
});
