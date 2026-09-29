import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeInline, plainText, ulid, validateInline, type InlineNode } from "@folevi/editor-schema";
import { assertWritable, getDocumentByPublicId, requireDocument, requireProfile, documentAccess, accessAtLeast, type Access } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { identityImageUrl } from "./lib/identityImages";
import { mentionedIds, notify } from "./lib/notify";

function cleanBody(body: unknown): InlineNode[] {
  const issues = validateInline(body, "body");
  if (issues.length) fail("invalid_argument", "Comment is malformed.");
  const normalized = normalizeInline(body as InlineNode[]);
  const text = plainText(normalized).trim();
  if (!text) fail("invalid_argument", "Write something first.");
  if (text.length > 5000) fail("invalid_argument", "Comment is too long.");
  return normalized;
}

/** The live (not deleted) block `blockId` of `doc`, if any. */
async function liveBlock(ctx: QueryCtx, doc: Doc<"documents">, blockId: string): Promise<Doc<"blocks"> | null> {
  const block = await ctx.db
    .query("blocks")
    .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
    .unique();
  return block && block.documentId === doc._id && !block.deletedAt ? block : null;
}

/**
 * Every comment thread on a document, newest activity first, plus a per-block summary of the open ones
 * (for the "2 comments · 8:18 AM" line under a block). Readers see comments; commenters and above may
 * add them; authors edit their own; authors and people who manage the page delete them.
 */
export const threads = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    // A page that hasn't reached the server yet simply has no comments (no error for the panel).
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    const access = doc ? await documentAccess(ctx, profile, doc) : "none";
    if (!doc || !accessAtLeast(access, "read")) return { threads: [], blocks: [], canComment: false, canManage: false };
    const canManage = accessAtLeast(access, "manage");
    const rows = await ctx.db
      .query("commentThreads")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .order("desc")
      .take(200);
    const people = new Map<string, { name: string; avatarUrl: string | null }>();
    const person = async (id: Id<"profiles">) => {
      if (!people.has(id)) {
        const p = await ctx.db.get(id);
        people.set(id, p && p.status !== "deleted" ? { name: p.displayName, avatarUrl: await identityImageUrl(ctx, p.avatarFileId) } : { name: "Former member", avatarUrl: null });
      }
      return people.get(id)!;
    };
    const blocks = new Map<string, Doc<"blocks"> | null>();
    const blockOf = async (id: string) => {
      if (!blocks.has(id)) blocks.set(id, await liveBlock(ctx, doc, id));
      return blocks.get(id)!;
    };
    const out = [];
    const byBlock = new Map<string, { blockId: string; threads: number; comments: number; lastActivityAt: number; unread: boolean; authors: { name: string; avatarUrl: string | null }[]; authorIds: Set<string> }>();
    for (const t of rows) {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_thread", (q) => q.eq("threadId", t._id))
        .take(200);
      const read = await ctx.db
        .query("readStates")
        .withIndex("by_profile_thread", (q) => q.eq("profileId", profile._id).eq("threadId", t._id))
        .unique();
      const visible = [];
      for (const c of comments) {
        const author = await person(c.authorId);
        const mine = c.authorId === profile._id;
        visible.push({
          id: c.publicId,
          authorId: c.authorId as string,
          authorName: author.name,
          authorAvatarUrl: author.avatarUrl,
          body: c.deletedAt ? [] : (c.body as InlineNode[]),
          deleted: c.deletedAt !== undefined,
          createdAt: c.createdAt,
          editedAt: c.editedAt ?? null,
          mine,
          canEdit: mine && !c.deletedAt && accessAtLeast(access, "comment"),
          canDelete: !c.deletedAt && ((mine && accessAtLeast(access, "comment")) || canManage),
        });
      }
      const block = t.blockId ? await blockOf(t.blockId) : null;
      const unread = !read || read.lastReadAt < t.lastActivityAt;
      out.push({
        id: t.publicId,
        blockId: t.blockId ?? null,
        /** False when the block this thread was on has been deleted (the thread stays readable). */
        blockExists: t.blockId ? block !== null : null,
        blockText: block ? plainText(block.text as InlineNode[]).trim().slice(0, 140) : null,
        status: t.status,
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
        resolvedBy: t.resolvedBy ? (await person(t.resolvedBy)).name : null,
        resolvedAt: t.resolvedAt ?? null,
        unread,
        canResolve: accessAtLeast(access, "comment"),
        canDelete: (t.createdBy === profile._id && accessAtLeast(access, "comment")) || canManage,
        comments: visible,
      });
      if (t.status === "open" && t.blockId && block) {
        const live = comments.filter((c) => !c.deletedAt);
        const entry = byBlock.get(t.blockId) ?? { blockId: t.blockId, threads: 0, comments: 0, lastActivityAt: 0, unread: false, authors: [], authorIds: new Set<string>() };
        entry.threads++;
        entry.comments += live.length;
        entry.lastActivityAt = Math.max(entry.lastActivityAt, t.lastActivityAt);
        entry.unread ||= unread;
        for (const c of [...live].reverse()) {
          if (entry.authorIds.has(c.authorId) || entry.authors.length >= 3) continue;
          entry.authorIds.add(c.authorId);
          entry.authors.push(await person(c.authorId));
        }
        byBlock.set(t.blockId, entry);
      }
    }
    return {
      threads: out,
      blocks: [...byBlock.values()].map(({ authorIds: _ids, ...b }) => b),
      canComment: accessAtLeast(access, "comment"),
      canManage,
    };
  },
});

/**
 * People who can be @mentioned on a document: everyone who can read it — workspace members and
 * people it (or a parent page) was shared with. Guests only see the people the page is shared with
 * plus its author, never the whole member list. No emails are returned.
 */
export const mentionable = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    // Never throws for a page that isn't on the server yet (created offline / still syncing).
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return [];
    const isMember = Boolean(
      await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", doc.workspaceId).eq("profileId", profile._id))
        .unique(),
    );
    const candidates = new Map<string, { guest: boolean }>();
    if (isMember) {
      const members = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", doc.workspaceId))
        .take(300);
      for (const m of members) candidates.set(m.profileId, { guest: false });
    } else {
      candidates.set(doc.createdBy, { guest: false });
    }
    // Explicit grants on the page and its ancestors.
    let cursor: Doc<"documents"> | null = doc;
    for (let depth = 0; cursor && depth < 12; depth++) {
      const current: Doc<"documents"> = cursor;
      const grants = await ctx.db
        .query("documentPermissions")
        .withIndex("by_document", (q) => q.eq("documentId", current._id))
        .take(200);
      for (const g of grants) if (!candidates.has(g.profileId)) candidates.set(g.profileId, { guest: true });
      cursor = current.parentDocumentId ? await ctx.db.get(current.parentDocumentId) : null;
    }
    const out: { profileId: string; displayName: string; isYou: boolean; guest: boolean }[] = [];
    for (const [id, info] of candidates) {
      const p = await ctx.db.get(id as Id<"profiles">);
      if (!p || p.status === "deleted") continue;
      if (p._id !== profile._id && !accessAtLeast(await documentAccess(ctx, p, doc), "read")) continue;
      out.push({ profileId: p._id as string, displayName: p.displayName, isYou: p._id === profile._id, guest: info.guest });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  },
});

/** Mentions only notify people who can actually open the document. */
async function canRead(ctx: MutationCtx, profileId: Id<"profiles">, doc: Doc<"documents">): Promise<boolean> {
  const p = await ctx.db.get(profileId);
  return Boolean(p && p.status !== "deleted" && accessAtLeast(await documentAccess(ctx, p, doc), "read"));
}

export const unreadCount = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const rows = await ctx.db
      .query("commentThreads")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(200);
    let unread = 0;
    for (const t of rows) {
      if (t.status !== "open") continue;
      const read = await ctx.db
        .query("readStates")
        .withIndex("by_profile_thread", (q) => q.eq("profileId", profile._id).eq("threadId", t._id))
        .unique();
      if (!read || read.lastReadAt < t.lastActivityAt) unread++;
    }
    return { unread, open: rows.filter((t) => t.status === "open").length };
  },
});

async function setThreadRead(ctx: MutationCtx, profileId: Id<"profiles">, thread: Doc<"commentThreads">, lastReadAt = Date.now()) {
  const read = await ctx.db
    .query("readStates")
    .withIndex("by_profile_thread", (q) => q.eq("profileId", profileId).eq("threadId", thread._id))
    .unique();
  if (read) await ctx.db.patch(read._id, { lastReadAt });
  else await ctx.db.insert("readStates", { profileId, threadId: thread._id, documentId: thread.documentId, lastReadAt });
}

/** Most people a single comment can notify (mentions, thread participants, the author and followers). */
const MAX_RECIPIENTS = 100;

/**
 * Tells the right people about a new comment:
 * - everyone @mentioned in it who can read the page ("mentioned you");
 * - on a reply, the people who took part in the thread ("replied");
 * - the page's creator and its followers ("commented on"), unless they muted it.
 * Each person hears once per comment; never the author; never anyone who can't read the page
 * (checked again in notify()). Bursts fold into one notification there.
 */
async function notifyActivity(
  ctx: MutationCtx,
  input: { actor: Doc<"profiles">; doc: Doc<"documents">; thread: Doc<"commentThreads">; commentId: string; body: InlineNode[]; reply: boolean },
): Promise<void> {
  const { actor, doc, thread } = input;
  const title = doc.title || "Untitled";
  const excerpt = plainText(input.body);
  const base = { actor, doc, threadId: thread._id, blockId: thread.blockId, commentId: input.commentId, excerpt };
  const done = new Set<string>([actor._id]);
  for (const id of mentionedIds(input.body)) {
    if (done.size > MAX_RECIPIENTS) return;
    const pid = ctx.db.normalizeId("profiles", id);
    if (!pid || done.has(pid)) continue;
    done.add(pid);
    if (await canRead(ctx, pid, doc)) await notify(ctx, { ...base, recipientId: pid, kind: "mention", title: `${actor.displayName} mentioned you in ${title}`, email: { key: "mention_notification" } });
  }
  if (input.reply) {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .take(200);
    const participants = [thread.createdBy, ...comments.filter((c) => !c.deletedAt).map((c) => c.authorId)];
    for (const pid of participants) {
      if (done.size > MAX_RECIPIENTS) return;
      if (done.has(pid)) continue;
      done.add(pid);
      await notify(ctx, { ...base, recipientId: pid, kind: "reply", title: `${actor.displayName} replied in ${title}`, email: { key: "comment_notification" } });
    }
  }
  const followers = await ctx.db
    .query("noteSubscriptions")
    .withIndex("by_document_mode", (q) => q.eq("documentId", doc._id).eq("mode", "follow"))
    .take(MAX_RECIPIENTS);
  for (const pid of [doc.createdBy, ...followers.map((f) => f.profileId)]) {
    if (done.size > MAX_RECIPIENTS) return;
    if (done.has(pid)) continue;
    done.add(pid);
    await notify(ctx, { ...base, recipientId: pid, kind: "comment", title: `${actor.displayName} commented on ${title}`, email: { key: "comment_notification" } });
  }
}

export const create = mutation({
  args: { documentId: v.string(), blockId: v.optional(v.string()), body: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "comment");
    await consume(ctx, "comment", profile._id);
    const body = cleanBody(args.body);
    if (args.blockId && !(await liveBlock(ctx, doc, args.blockId))) fail("not_found", "Block not found.");
    const now = Date.now();
    const threadPublic = ulid();
    const commentPublic = ulid();
    const threadId = await ctx.db.insert("commentThreads", {
      publicId: threadPublic,
      workspaceId: doc.workspaceId,
      documentId: doc._id,
      blockId: args.blockId,
      status: "open",
      createdBy: profile._id,
      createdAt: now,
      lastActivityAt: now,
      commentCount: 1,
    });
    await ctx.db.insert("comments", { publicId: commentPublic, threadId, workspaceId: doc.workspaceId, documentId: doc._id, authorId: profile._id, body, createdAt: now });
    const thread = (await ctx.db.get(threadId))!;
    await setThreadRead(ctx, profile._id, thread);
    await notifyActivity(ctx, { actor: profile, doc, thread, commentId: commentPublic, body, reply: false });
    return { threadId: threadPublic, commentId: commentPublic };
  },
});

async function threadFor(ctx: MutationCtx, threadPublicId: string, need: Access) {
  const profile = await requireProfile(ctx);
  const thread = await ctx.db
    .query("commentThreads")
    .withIndex("by_public_id", (q) => q.eq("publicId", threadPublicId))
    .unique();
  if (!thread) fail("not_found", "Comment not found.");
  const doc = (await ctx.db.get(thread.documentId))!;
  const access = await documentAccess(ctx, profile, doc);
  // Same error for "missing" and "not yours to see".
  if (access === "none") fail("not_found", "Comment not found.");
  if (!accessAtLeast(access, need)) fail("forbidden", "You can't comment on this document.");
  return { profile, thread, doc, access };
}

export const reply = mutation({
  args: { threadId: v.string(), body: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { profile, thread, doc } = await threadFor(ctx, args.threadId, "comment");
    await assertWritable(ctx, profile);
    await consume(ctx, "comment", profile._id);
    const body = cleanBody(args.body);
    const now = Date.now();
    const commentPublic = ulid();
    await ctx.db.insert("comments", { publicId: commentPublic, threadId: thread._id, workspaceId: thread.workspaceId, documentId: thread.documentId, authorId: profile._id, body, createdAt: now });
    await ctx.db.patch(thread._id, { lastActivityAt: now, commentCount: thread.commentCount + 1, status: "open", resolvedAt: undefined, resolvedBy: undefined });
    await setThreadRead(ctx, profile._id, thread);
    await notifyActivity(ctx, { actor: profile, doc, thread, commentId: commentPublic, body, reply: true });
    return { commentId: commentPublic };
  },
});

export const setResolved = mutation({
  args: { threadId: v.string(), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const { profile, thread } = await threadFor(ctx, args.threadId, "comment");
    await assertWritable(ctx, profile);
    await ctx.db.patch(thread._id, args.resolved ? { status: "resolved", resolvedAt: Date.now(), resolvedBy: profile._id } : { status: "open", resolvedAt: undefined, resolvedBy: undefined, lastActivityAt: Date.now() });
    return null;
  },
});

/** A comment the caller may act on, with its document and the caller's access (not found for outsiders). */
async function commentFor(ctx: MutationCtx, commentPublicId: string) {
  const profile = await requireProfile(ctx);
  const comment = await ctx.db
    .query("comments")
    .withIndex("by_public_id", (q) => q.eq("publicId", commentPublicId))
    .unique();
  if (!comment || comment.deletedAt) fail("not_found", "Comment not found.");
  const doc = (await ctx.db.get(comment.documentId))!;
  const access = await documentAccess(ctx, profile, doc);
  if (access === "none") fail("not_found", "Comment not found.");
  return { profile, comment, doc, access };
}

export const edit = mutation({
  args: { commentId: v.string(), body: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { profile, comment, doc, access } = await commentFor(ctx, args.commentId);
    await assertWritable(ctx, profile);
    if (comment.authorId !== profile._id) fail("forbidden", "You can only edit your own comments.");
    if (!accessAtLeast(access, "comment")) fail("forbidden", "You can't comment on this document.");
    await consume(ctx, "comment", profile._id);
    const body = cleanBody(args.body);
    await ctx.db.patch(comment._id, { body, editedAt: Date.now() });
    // People newly mentioned by the edit are notified once, like in a new comment.
    const thread = (await ctx.db.get(comment.threadId))!;
    const before = new Set(mentionedIds(comment.body));
    const excerpt = plainText(body);
    for (const id of new Set(mentionedIds(body))) {
      if (before.has(id)) continue;
      const pid = ctx.db.normalizeId("profiles", id);
      if (pid && pid !== profile._id && (await canRead(ctx, pid, doc))) {
        await notify(ctx, { recipientId: pid, actor: profile, kind: "mention", doc, threadId: thread._id, blockId: thread.blockId, commentId: comment.publicId, title: `${profile.displayName} mentioned you in ${doc.title || "Untitled"}`, excerpt, email: { key: "mention_notification" } });
      }
    }
    return null;
  },
});

/** Deletes a thread with its comments, read marks and the notifications that quote it. */
async function purgeThread(ctx: MutationCtx, thread: Doc<"commentThreads">) {
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
    .take(500);
  for (const c of comments) await ctx.db.delete(c._id);
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
    .take(500);
  for (const n of notes) await ctx.db.delete(n._id);
  const reads = await ctx.db
    .query("readStates")
    .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
    .take(500);
  for (const r of reads) await ctx.db.delete(r._id);
  await ctx.db.delete(thread._id);
}

/**
 * Deletes a comment: its author, or someone who manages the page (workspace admins). The last comment
 * of a thread takes the thread with it; notifications stop quoting the deleted text.
 */
export const remove = mutation({
  args: { commentId: v.string() },
  handler: async (ctx, args) => {
    const { profile, comment, access } = await commentFor(ctx, args.commentId);
    await assertWritable(ctx, profile);
    const own = comment.authorId === profile._id && accessAtLeast(access, "comment");
    if (!own && !accessAtLeast(access, "manage")) fail("forbidden", "You can't delete this comment.");
    await ctx.db.patch(comment._id, { deletedAt: Date.now(), body: [] });
    const thread = (await ctx.db.get(comment.threadId))!;
    const rest = await ctx.db
      .query("comments")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .take(200);
    if (rest.every((c) => c.deletedAt)) {
      await purgeThread(ctx, thread);
      return { threadDeleted: true };
    }
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .take(500);
    for (const n of notes) if (n.commentId === comment.publicId && n.body !== undefined) await ctx.db.patch(n._id, { body: undefined });
    return { threadDeleted: false };
  },
});

/** Deletes a whole thread: whoever started it, or someone who manages the page. */
export const deleteThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const { profile, thread, access } = await threadFor(ctx, args.threadId, "read");
    await assertWritable(ctx, profile);
    const own = thread.createdBy === profile._id && accessAtLeast(access, "comment");
    if (!own && !accessAtLeast(access, "manage")) fail("forbidden", "You can't delete this thread.");
    await purgeThread(ctx, thread);
    return null;
  },
});

/** Marks one thread read (opening it), along with your notifications about it. */
export const markThreadRead = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const { profile, thread } = await threadFor(ctx, args.threadId, "read");
    await setThreadRead(ctx, profile._id, thread);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_profile_unread", (q) => q.eq("profileId", profile._id).eq("readAt", undefined))
      .take(200);
    const now = Date.now();
    for (const n of unread) if (n.threadId === thread._id) await ctx.db.patch(n._id, { readAt: now });
    return null;
  },
});

/** Marks a thread unread for you again ("Mark as unread" in its menu). */
export const markThreadUnread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const { profile, thread } = await threadFor(ctx, args.threadId, "read");
    await setThreadRead(ctx, profile._id, thread, 0);
    return null;
  },
});

export const markRead = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) return null;
    if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    const rows = await ctx.db
      .query("commentThreads")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(200);
    for (const t of rows) await setThreadRead(ctx, profile._id, t);
    return null;
  },
});
