// Folders (one level of nesting in v1) and tags.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { normalizeForSearch, rankBetween, ulid } from "@folevi/editor-schema";
import { assertWritable, documentAccessInfo, PageReader, requireDocument, requireProfile, requireRowScope, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { nextSeq } from "./lib/seq";
import { inScope, insertScoped, sameScopeRows, scopeOfRow, vScopeArg, type Scope } from "./lib/scope";
import { isFolderColor, randomFolderColor } from "./lib/folderColors";

const TAG_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"];

/** A scope's folders (Personal: by owner; a workspace: by workspace). */
async function scopeFolders(ctx: QueryCtx, scope: Scope): Promise<Doc<"folders">[]> {
  const base = ctx.db.query("folders");
  return await (scope.kind === "personal" ? base.withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))).collect();
}

/** A scope's tags. */
async function scopeTags(ctx: QueryCtx, scope: Scope): Promise<Doc<"tags">[]> {
  const base = ctx.db.query("tags");
  return await (scope.kind === "personal" ? base.withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))).collect();
}

/** A tag of a scope by its normalized name. */
async function tagNamed(ctx: QueryCtx, scope: Scope, normalizedName: string): Promise<Doc<"tags"> | null> {
  const base = ctx.db.query("tags");
  return await (
    scope.kind === "personal"
      ? base.withIndex("by_owner_name", (q) => q.eq("ownerProfileId", scope.profileId).eq("normalizedName", normalizedName))
      : base.withIndex("by_workspace_name", (q) => q.eq("workspaceId", scope.workspaceId).eq("normalizedName", normalizedName))
  ).first();
}

function cleanName(name: string, max = 80): string {
  const n = name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
  if (!n) fail("invalid_argument", "Name can't be empty.");
  return n;
}

export const sidebar = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const folders = (await scopeFolders(ctx, scope)).filter((f) => !f.deletedAt);
    const idToPublic = new Map(folders.map((f) => [f._id, f.publicId]));
    const tags = await scopeTags(ctx, scope);
    return {
      folders: folders
        .sort((a, b) => (a.rank < b.rank ? -1 : 1))
        .map((f) => ({
          id: f.publicId,
          name: f.name,
          color: f.color ?? null,
          parentFolderId: f.parentFolderId ? (idToPublic.get(f.parentFolderId) ?? null) : null,
          rank: f.rank,
        })),
      tags: tags.sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.publicId, name: t.name, color: t.color })),
    };
  },
});

/**
 * Every folder and tag with its page count and dates, for the All folders / All tags views (the
 * sidebar shows only the first few). Counts are pages the person can see in lists: not trashed, not
 * archived, top-level in the folder, and only pages they can open (a restricted page they can't open
 * is neither counted nor previewed).
 */
export const index = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const reader = new PageReader(ctx, profile, standing);
    const folders = (await scopeFolders(ctx, scope)).filter((f) => !f.deletedAt);
    const idToPublic = new Map(folders.map((f) => [f._id, f.publicId]));
    const folderRows = [];
    for (const f of folders) {
      const docs = await reader.filter(
        (
          await ctx.db
            .query("documents")
            .withIndex("by_folder", (q) => q.eq("folderId", f._id))
            .take(2000)
        ).filter((d) => !d.inTrash && !d.archivedAt && !d.parentDocumentId && d.kind !== "template"),
      );
      folderRows.push({
        id: f.publicId,
        name: f.name,
        color: f.color ?? null,
        parentFolderId: f.parentFolderId ? (idToPublic.get(f.parentFolderId) ?? null) : null,
        rank: f.rank,
        createdAt: f.createdAt,
        updatedAt: Math.max(f.updatedAt, ...docs.map((d) => d.updatedAt)),
        documentCount: docs.length,
        // The most recently edited notes inside that this person can read: style, title and opening text,
        // shown as small pages peeking out of the folder.
        previews: [...docs]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 3)
          .map((d) => ({ cover: d.cover, title: d.title, excerpt: d.excerpt.slice(0, 280) })),
      });
    }
    const tags = await scopeTags(ctx, scope);
    const tagRows = [];
    for (const t of tags) {
      const links = await ctx.db
        .query("documentTags")
        .withIndex("by_tag", (q) => q.eq("tagId", t._id))
        .take(2000);
      // Someone who opens everything here counts every tagged page; a member only the ones they can open.
      let documentCount = links.length;
      if (!reader.opensEverything) {
        documentCount = 0;
        for (const l of links) if (await reader.canOpenId(l.documentId)) documentCount++;
      }
      tagRows.push({ id: t.publicId, name: t.name, color: t.color, createdAt: t.createdAt, documentCount });
    }
    return { folders: folderRows, tags: tagRows };
  },
});

export const createFolder = mutation({
  args: { scope: vScopeArg, name: v.string(), parentFolderId: v.optional(v.string()), icon: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    let parentFolderId: Id<"folders"> | undefined;
    if (args.parentFolderId) {
      const parent = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.parentFolderId!))
        .unique();
      if (!parent || !inScope(parent, scope) || parent.deletedAt) fail("not_found", "Folder not found.");
      if (parent.parentFolderId) fail("invalid_argument", "Folders can be nested one level deep.");
      parentFolderId = parent._id;
    }
    const siblings = await scopeFolders(ctx, scope);
    const last = siblings.map((f) => f.rank).sort().pop() ?? null;
    const publicId = ulid();
    const now = Date.now();
    await insertScoped(ctx, "folders", scope, {
      publicId,
      parentFolderId,
      name: cleanName(args.name),
      icon: args.icon?.slice(0, 16),
      // Every folder gets a colour; people can change it from the folder menu.
      color: randomFolderColor(),
      rank: rankBetween(last, null),
      createdBy: profile._id,
      createdAt: now,
      updatedAt: now,
      seq: await nextSeq(ctx, scope),
    });
    return { id: publicId };
  },
});

async function folderFor(ctx: Parameters<typeof requireProfile>[0], folderPublicId: string) {
  const profile = await requireProfile(ctx);
  const folder = await ctx.db
    .query("folders")
    .withIndex("by_public_id", (q) => q.eq("publicId", folderPublicId))
    .unique();
  if (!folder || folder.deletedAt) fail("not_found", "Folder not found.");
  // Your own Personal, or a workspace where you can edit; someone else's Personal reads as not found.
  const { scope } = await requireRowScope(ctx, profile, folder, "edit", "Folder not found.");
  return { profile, folder, scope };
}

export const renameFolder = mutation({
  args: { folderId: v.string(), name: v.string(), icon: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile, folder } = await folderFor(ctx, args.folderId);
    await assertWritable(ctx, profile);
    await ctx.db.patch(folder._id, {
      name: cleanName(args.name),
      icon: args.icon === undefined ? folder.icon : args.icon.slice(0, 16),
      updatedAt: Date.now(),
      seq: await nextSeq(ctx, scopeOfRow(folder)),
    });
    return null;
  },
});

/** Sets a folder's colour (one of FOLDER_COLORS), or back to the default with null. */
export const setFolderColor = mutation({
  args: { folderId: v.string(), color: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { profile, folder } = await folderFor(ctx, args.folderId);
    await assertWritable(ctx, profile);
    if (args.color !== null && !isFolderColor(args.color)) fail("invalid_argument", "Unknown folder colour.");
    await ctx.db.patch(folder._id, { color: args.color ?? undefined, updatedAt: Date.now(), seq: await nextSeq(ctx, scopeOfRow(folder)) });
    return null;
  },
});

/** How many pages are in Drafts (not in any folder, top level, not archived or trashed) that the person can open. */
export const draftCount = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const base = ctx.db.query("documents");
    const rows = await (
      scope.kind === "personal"
        ? base.withIndex("by_owner_folder", (q) => q.eq("ownerProfileId", scope.profileId).eq("folderId", undefined))
        : base.withIndex("by_workspace_folder", (q) => q.eq("workspaceId", scope.workspaceId).eq("folderId", undefined))
    ).take(5000);
    const drafts = rows.filter((d) => !d.inTrash && !d.archivedAt && !d.parentDocumentId && (d.kind === "document" || d.kind === "daily"));
    return (await new PageReader(ctx, profile, standing).filter(drafts)).length;
  },
});

export const moveFolder = mutation({
  args: { folderId: v.string(), parentFolderId: v.union(v.string(), v.null()), afterFolderId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const { profile, folder, scope } = await folderFor(ctx, args.folderId);
    await assertWritable(ctx, profile);
    let parentFolderId: Id<"folders"> | undefined;
    if (args.parentFolderId) {
      const parent = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.parentFolderId!))
        .unique();
      if (!parent || !inScope(parent, scope)) fail("not_found", "Folder not found.");
      if (parent._id === folder._id || parent.parentFolderId) fail("invalid_argument", "Folders can be nested one level deep.");
      const hasChildren = await ctx.db
        .query("folders")
        .withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id))
        .first();
      if (hasChildren && !hasChildren.deletedAt) fail("invalid_argument", "Move this folder's subfolders out first.");
      parentFolderId = parent._id;
    }
    const all = await scopeFolders(ctx, scope);
    const siblings = all.filter((f) => f._id !== folder._id && (f.parentFolderId ?? null) === (parentFolderId ?? null) && !f.deletedAt).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    let rank = folder.rank;
    if (args.afterFolderId !== undefined) {
      const idx = args.afterFolderId === null ? -1 : siblings.findIndex((s) => s.publicId === args.afterFolderId);
      const prev = idx >= 0 ? siblings[idx]!.rank : null;
      const next = siblings[idx + 1]?.rank ?? null;
      rank = rankBetween(prev, next);
    }
    await ctx.db.patch(folder._id, { parentFolderId, rank, updatedAt: Date.now(), seq: await nextSeq(ctx, scope) });
    return null;
  },
});

/** Deleting a folder never deletes documents: they become unsorted. */
export const deleteFolder = mutation({
  args: { folderId: v.string() },
  handler: async (ctx, args) => {
    const { profile, folder } = await folderFor(ctx, args.folderId);
    await assertWritable(ctx, profile);
    const seq = await nextSeq(ctx, scopeOfRow(folder));
    const children = await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id))
      .collect();
    for (const c of children) await ctx.db.patch(c._id, { parentFolderId: undefined, seq });
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
      .collect();
    for (const d of docs) await ctx.db.patch(d._id, { folderId: undefined, seq, revision: d.revision + 1 });
    await ctx.db.patch(folder._id, { deletedAt: Date.now(), seq });
    return null;
  },
});

export const createTag = mutation({
  args: { scope: vScopeArg, name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    const name = cleanName(args.name.replace(/^#/, ""), 40);
    const normalizedName = normalizeForSearch(name);
    const existing = await tagNamed(ctx, scope, normalizedName);
    if (existing) return { id: existing.publicId };
    const publicId = ulid();
    await insertScoped(ctx, "tags", scope, {
      publicId,
      name,
      normalizedName,
      color: TAG_COLORS.includes(args.color ?? "") ? args.color! : TAG_COLORS[Math.floor(Math.random() * 5)]!,
      createdAt: Date.now(),
      seq: await nextSeq(ctx, scope),
    });
    return { id: publicId };
  },
});

async function tagFor(ctx: Parameters<typeof requireProfile>[0], tagPublicId: string) {
  const profile = await requireProfile(ctx);
  const tag = await ctx.db
    .query("tags")
    .withIndex("by_public_id", (q) => q.eq("publicId", tagPublicId))
    .unique();
  if (!tag) fail("not_found", "Tag not found.");
  const { scope } = await requireRowScope(ctx, profile, tag, "edit", "Tag not found.");
  return { profile, tag, scope };
}

export const updateTag = mutation({
  args: { tagId: v.string(), name: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile, tag, scope } = await tagFor(ctx, args.tagId);
    await assertWritable(ctx, profile);
    const name = args.name !== undefined ? cleanName(args.name.replace(/^#/, ""), 40) : tag.name;
    const normalizedName = normalizeForSearch(name);
    if (normalizedName !== tag.normalizedName) {
      const clash = await tagNamed(ctx, scope, normalizedName);
      if (clash && clash._id !== tag._id) fail("invalid_argument", `There's already a tag called #${clash.name}.`);
    }
    if (args.color !== undefined && !TAG_COLORS.includes(args.color)) fail("invalid_argument", "Unknown tag color.");
    await ctx.db.patch(tag._id, {
      name,
      normalizedName,
      color: args.color ?? tag.color,
      seq: await nextSeq(ctx, scope),
    });
    return null;
  },
});

export const deleteTag = mutation({
  args: { tagId: v.string() },
  handler: async (ctx, args) => {
    const { profile, tag, scope } = await tagFor(ctx, args.tagId);
    await assertWritable(ctx, profile);
    const links = await ctx.db
      .query("documentTags")
      .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
      .collect();
    for (const l of links) await ctx.db.delete(l._id);
    await ctx.db.delete(tag._id);
    await nextSeq(ctx, scope);
    return null;
  },
});

export const setDocumentTags = mutation({
  args: { documentId: v.string(), tagIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    // Tags belong to the page's Personal or workspace: guests (who can edit a shared page) don't see them
    // and can't change them.
    if (!(await documentAccessInfo(ctx, profile, doc)).inScope) fail("forbidden", "Only members can tag pages.");
    const wanted = new Map<string, Id<"tags">>();
    for (const id of args.tagIds.slice(0, 20)) {
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique();
      if (!tag || !sameScopeRows(tag, doc)) fail("not_found", "Tag not found.");
      wanted.set(tag._id, tag._id);
    }
    const existing = await ctx.db
      .query("documentTags")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect();
    for (const e of existing) if (!wanted.has(e.tagId)) await ctx.db.delete(e._id);
    const have = new Set(existing.map((e) => e.tagId as string));
    for (const t of wanted.keys()) if (!have.has(t)) await insertScoped(ctx, "documentTags", scopeOfRow(doc), { documentId: doc._id, tagId: wanted.get(t)! });
    await ctx.db.patch(doc._id, { seq: await nextSeq(ctx, scopeOfRow(doc)), updatedAt: Date.now() });
    return null;
  },
});
