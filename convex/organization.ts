// Folders (one level of nesting in v1) and tags.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { normalizeForSearch, rankBetween, ulid } from "@folevi/editor-schema";
import { assertWritable, requireDocument, requireProfile, requireWorkspace } from "./lib/auth";
import { fail } from "./lib/errors";
import { nextSeq } from "./lib/seq";

const TAG_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"];

function cleanName(name: string, max = 80): string {
  const n = name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
  if (!n) fail("invalid_argument", "Name can't be empty.");
  return n;
}

export const sidebar = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const folders = (
      await ctx.db
        .query("folders")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect()
    ).filter((f) => !f.deletedAt);
    const idToPublic = new Map(folders.map((f) => [f._id, f.publicId]));
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return {
      folders: folders
        .sort((a, b) => (a.rank < b.rank ? -1 : 1))
        .map((f) => ({
          id: f.publicId,
          name: f.name,
          icon: f.icon ?? null,
          parentFolderId: f.parentFolderId ? (idToPublic.get(f.parentFolderId) ?? null) : null,
          rank: f.rank,
        })),
      tags: tags.sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.publicId, name: t.name, color: t.color })),
    };
  },
});

export const createFolder = mutation({
  args: { workspaceId: v.string(), name: v.string(), parentFolderId: v.optional(v.string()), icon: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    let parentFolderId: Id<"folders"> | undefined;
    if (args.parentFolderId) {
      const parent = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.parentFolderId!))
        .unique();
      if (!parent || parent.workspaceId !== workspace._id || parent.deletedAt) fail("not_found", "Folder not found.");
      if (parent.parentFolderId) fail("invalid_argument", "Folders can be nested one level deep.");
      parentFolderId = parent._id;
    }
    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const last = siblings.map((f) => f.rank).sort().pop() ?? null;
    const publicId = ulid();
    const now = Date.now();
    await ctx.db.insert("folders", {
      publicId,
      workspaceId: workspace._id,
      parentFolderId,
      name: cleanName(args.name),
      icon: args.icon?.slice(0, 16),
      rank: rankBetween(last, null),
      createdBy: profile._id,
      createdAt: now,
      updatedAt: now,
      seq: await nextSeq(ctx, workspace._id),
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
  const workspace = (await ctx.db.get(folder.workspaceId))!;
  await requireWorkspace(ctx, profile, workspace.publicId, "editor");
  return { profile, folder, workspace };
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
      seq: await nextSeq(ctx, folder.workspaceId),
    });
    return null;
  },
});

export const moveFolder = mutation({
  args: { folderId: v.string(), parentFolderId: v.union(v.string(), v.null()), afterFolderId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const { profile, folder, workspace } = await folderFor(ctx, args.folderId);
    await assertWritable(ctx, profile);
    let parentFolderId: Id<"folders"> | undefined;
    if (args.parentFolderId) {
      const parent = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.parentFolderId!))
        .unique();
      if (!parent || parent.workspaceId !== workspace._id) fail("not_found", "Folder not found.");
      if (parent._id === folder._id || parent.parentFolderId) fail("invalid_argument", "Folders can be nested one level deep.");
      const hasChildren = await ctx.db
        .query("folders")
        .withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id))
        .first();
      if (hasChildren && !hasChildren.deletedAt) fail("invalid_argument", "Move this folder's subfolders out first.");
      parentFolderId = parent._id;
    }
    const all = await ctx.db
      .query("folders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const siblings = all.filter((f) => f._id !== folder._id && (f.parentFolderId ?? null) === (parentFolderId ?? null) && !f.deletedAt).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    let rank = folder.rank;
    if (args.afterFolderId !== undefined) {
      const idx = args.afterFolderId === null ? -1 : siblings.findIndex((s) => s.publicId === args.afterFolderId);
      const prev = idx >= 0 ? siblings[idx]!.rank : null;
      const next = siblings[idx + 1]?.rank ?? null;
      rank = rankBetween(prev, next);
    }
    await ctx.db.patch(folder._id, { parentFolderId, rank, updatedAt: Date.now(), seq: await nextSeq(ctx, workspace._id) });
    return null;
  },
});

/** Deleting a folder never deletes documents: they become unsorted. */
export const deleteFolder = mutation({
  args: { folderId: v.string() },
  handler: async (ctx, args) => {
    const { profile, folder } = await folderFor(ctx, args.folderId);
    await assertWritable(ctx, profile);
    const seq = await nextSeq(ctx, folder.workspaceId);
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
  args: { workspaceId: v.string(), name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    const name = cleanName(args.name.replace(/^#/, ""), 40);
    const normalizedName = normalizeForSearch(name);
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_workspace_name", (q) => q.eq("workspaceId", workspace._id).eq("normalizedName", normalizedName))
      .unique();
    if (existing) return { id: existing.publicId };
    const publicId = ulid();
    await ctx.db.insert("tags", {
      publicId,
      workspaceId: workspace._id,
      name,
      normalizedName,
      color: TAG_COLORS.includes(args.color ?? "") ? args.color! : TAG_COLORS[Math.floor(Math.random() * 5)]!,
      createdAt: Date.now(),
      seq: await nextSeq(ctx, workspace._id),
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
  const workspace = (await ctx.db.get(tag.workspaceId))!;
  await requireWorkspace(ctx, profile, workspace.publicId, "editor");
  return { profile, tag };
}

export const updateTag = mutation({
  args: { tagId: v.string(), name: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { profile, tag } = await tagFor(ctx, args.tagId);
    await assertWritable(ctx, profile);
    const name = args.name !== undefined ? cleanName(args.name.replace(/^#/, ""), 40) : tag.name;
    await ctx.db.patch(tag._id, {
      name,
      normalizedName: normalizeForSearch(name),
      color: args.color && TAG_COLORS.includes(args.color) ? args.color : tag.color,
      seq: await nextSeq(ctx, tag.workspaceId),
    });
    return null;
  },
});

export const deleteTag = mutation({
  args: { tagId: v.string() },
  handler: async (ctx, args) => {
    const { profile, tag } = await tagFor(ctx, args.tagId);
    await assertWritable(ctx, profile);
    const links = await ctx.db
      .query("documentTags")
      .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
      .collect();
    for (const l of links) await ctx.db.delete(l._id);
    await ctx.db.delete(tag._id);
    await nextSeq(ctx, tag.workspaceId);
    return null;
  },
});

export const setDocumentTags = mutation({
  args: { documentId: v.string(), tagIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const wanted = new Map<string, Id<"tags">>();
    for (const id of args.tagIds.slice(0, 20)) {
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_public_id", (q) => q.eq("publicId", id))
        .unique();
      if (!tag || tag.workspaceId !== doc.workspaceId) fail("not_found", "Tag not found.");
      wanted.set(tag._id, tag._id);
    }
    const existing = await ctx.db
      .query("documentTags")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect();
    for (const e of existing) if (!wanted.has(e.tagId)) await ctx.db.delete(e._id);
    const have = new Set(existing.map((e) => e.tagId as string));
    for (const t of wanted.keys()) if (!have.has(t)) await ctx.db.insert("documentTags", { workspaceId: doc.workspaceId, documentId: doc._id, tagId: wanted.get(t)! });
    await ctx.db.patch(doc._id, { seq: await nextSeq(ctx, doc.workspaceId), updatedAt: Date.now() });
    return null;
  },
});
