import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { normalizeInline, plainText, ulid, validateInline, type InlineNode } from "@folevi/editor-schema";
import { assertWritable, getDocumentByPublicId, requireDocument, requireProfile, documentAccess, accessAtLeast } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
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

export const threads = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    // A page that hasn't reached the server yet simply has no comments (no error for the panel).
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    const access = doc ? await documentAccess(ctx, profile, doc) : "none";
    if (!doc || !accessAtLeast(access, "read")) return { threads: [], canComment: false };
    const rows = await ctx.db
      .query("commentThreads")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .order("desc")
      .take(200);
    const names = new Map<string, string>();
    const name = async (id: Id<"profiles">) => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.displayName ?? "Former member");
      return names.get(id)!;
    };
    const out = [];
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
        visible.push({
          id: c.publicId,
          authorId: c.authorId as string,
          authorName: await name(c.authorId),
          body: c.deletedAt ? [] : (c.body as InlineNode[]),
          deleted: c.deletedAt !== undefined,
          createdAt: c.createdAt,
          editedAt: c.editedAt ?? null,
          mine: c.authorId === profile._id,
        });
      }
      out.push({
        id: t.publicId,
        blockId: t.blockId ?? null,
        status: t.status,
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
        resolvedBy: t.resolvedBy ? await name(t.resolvedBy) : null,
        unread: !read || read.lastReadAt < t.lastActivityAt,
        comments: visible,
      });
    }
    return { threads: out, canComment: accessAtLeast(access, "comment") };
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

async function markThreadRead(ctx: MutationCtx, profileId: Id<"profiles">, thread: Doc<"commentThreads">) {
  const read = await ctx.db
    .query("readStates")
    .withIndex("by_profile_thread", (q) => q.eq("profileId", profileId).eq("threadId", thread._id))
    .unique();
  const now = Date.now();
  if (read) await ctx.db.patch(read._id, { lastReadAt: now });
  else await ctx.db.insert("readStates", { profileId, threadId: thread._id, documentId: thread.documentId, lastReadAt: now });
}

export const create = mutation({
  args: { documentId: v.string(), blockId: v.optional(v.string()), body: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "comment");
    await consume(ctx, "comment", profile._id);
    const body = cleanBody(args.body);
    if (args.blockId) {
      const block = await ctx.db
        .query("blocks")
        .withIndex("by_block_id", (q) => q.eq("blockId", args.blockId!))
        .unique();
      if (!block || block.documentId !== doc._id) fail("not_found", "Block not found.");
    }
    const now = Date.now();
    const threadPublic = ulid();
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
    await ctx.db.insert("comments", { publicId: ulid(), threadId, workspaceId: doc.workspaceId, documentId: doc._id, authorId: profile._id, body, createdAt: now });
    await markThreadRead(ctx, profile._id, (await ctx.db.get(threadId))!);
    const excerpt = plainText(body);
    const mentioned = new Set(mentionedIds(body));
    for (const id of mentioned) {
      const pid = ctx.db.normalizeId("profiles", id);
      if (pid && pid !== profile._id && (await canRead(ctx, pid, doc))) await notify(ctx, { recipientId: pid, actor: profile, kind: "mention", doc, threadId, title: `${profile.displayName} mentioned you in ${doc.title || "Untitled"}`, excerpt, email: { key: "mention_notification" } });
    }
    if (doc.createdBy !== profile._id && !mentioned.has(doc.createdBy)) {
      await notify(ctx, { recipientId: doc.createdBy, actor: profile, kind: "comment", doc, threadId, title: `${profile.displayName} commented on ${doc.title || "Untitled"}`, excerpt, email: { key: "comment_notification" } });
    }
    return { threadId: threadPublic };
  },
});

async function threadFor(ctx: MutationCtx, threadPublicId: string, need: "comment" | "read") {
  const profile = await requireProfile(ctx);
  const thread = await ctx.db
    .query("commentThreads")
    .withIndex("by_public_id", (q) => q.eq("publicId", threadPublicId))
    .unique();
  if (!thread) fail("not_found", "Comment not found.");
  const doc = (await ctx.db.get(thread.documentId))!;
  const access = await documentAccess(ctx, profile, doc);
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
    await ctx.db.insert("comments", { publicId: ulid(), threadId: thread._id, workspaceId: thread.workspaceId, documentId: thread.documentId, authorId: profile._id, body, createdAt: now });
    await ctx.db.patch(thread._id, { lastActivityAt: now, commentCount: thread.commentCount + 1, status: "open" });
    await markThreadRead(ctx, profile._id, thread);
    const excerpt = plainText(body);
    const mentioned = new Set(mentionedIds(body));
    for (const id of mentioned) {
      const pid = ctx.db.normalizeId("profiles", id);
      if (pid && pid !== profile._id && (await canRead(ctx, pid, doc))) await notify(ctx, { recipientId: pid, actor: profile, kind: "mention", doc, threadId: thread._id, title: `${profile.displayName} mentioned you in ${doc.title || "Untitled"}`, excerpt, email: { key: "mention_notification" } });
    }
    const participants = new Set<string>();
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .take(200);
    for (const c of comments) participants.add(c.authorId);
    for (const p of participants) {
      if (p === profile._id || mentioned.has(p)) continue;
      await notify(ctx, { recipientId: p as Id<"profiles">, actor: profile, kind: "reply", doc, threadId: thread._id, title: `${profile.displayName} replied in ${doc.title || "Untitled"}`, excerpt, email: { key: "comment_notification" } });
    }
    return null;
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

export const edit = mutation({
  args: { commentId: v.string(), body: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const comment = await ctx.db
      .query("comments")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.commentId))
      .unique();
    if (!comment || comment.deletedAt) fail("not_found", "Comment not found.");
    if (comment.authorId !== profile._id) fail("forbidden", "You can only edit your own comments.");
    const doc = (await ctx.db.get(comment.documentId))!;
    if (!accessAtLeast(await documentAccess(ctx, profile, doc), "comment")) fail("forbidden", "You can't comment on this document.");
    const body = cleanBody(args.body);
    await ctx.db.patch(comment._id, { body, editedAt: Date.now() });
    // People newly mentioned by the edit are notified once, like in a new comment.
    const before = new Set(mentionedIds(comment.body));
    const excerpt = plainText(body);
    for (const id of new Set(mentionedIds(body))) {
      if (before.has(id)) continue;
      const pid = ctx.db.normalizeId("profiles", id);
      if (pid && pid !== profile._id && (await canRead(ctx, pid, doc))) {
        await notify(ctx, { recipientId: pid, actor: profile, kind: "mention", doc, threadId: comment.threadId, title: `${profile.displayName} mentioned you in ${doc.title || "Untitled"}`, excerpt, email: { key: "mention_notification" } });
      }
    }
    return null;
  },
});

export const remove = mutation({
  args: { commentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const comment = await ctx.db
      .query("comments")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.commentId))
      .unique();
    if (!comment || comment.deletedAt) fail("not_found", "Comment not found.");
    const doc = (await ctx.db.get(comment.documentId))!;
    const access = await documentAccess(ctx, profile, doc);
    if (comment.authorId !== profile._id && !accessAtLeast(access, "manage")) fail("forbidden", "You can't delete this comment.");
    await ctx.db.patch(comment._id, { deletedAt: Date.now(), body: [] });
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
    for (const t of rows) await markThreadRead(ctx, profile._id, t);
    return null;
  },
});
