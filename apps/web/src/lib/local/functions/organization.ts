// organization.* in local mode (convex/organization.ts): the library's folders and tags.
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";
import type { LocalDocument, LocalFolder } from "../store";
import { checkScope, requireProfile } from "./shared";

const byRank = (a: LocalFolder, b: LocalFolder) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1);

defineLocal(api.organization.sidebar, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const folders = (await ctx.db.list("folders")).filter((f) => f.deletedAt === null);
  const live = new Set(folders.map((f) => f.id));
  const tags = await ctx.db.list("tags");
  return {
    folders: folders.sort(byRank).map((f) => ({ id: f.id, name: f.name, color: f.color, parentFolderId: f.parentFolderId && live.has(f.parentFolderId) ? f.parentFolderId : null, rank: f.rank })),
    tags: tags.sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
});

/** A folder's listed notes: top level, not in Trash or the Archive, not templates. */
const listedIn = (folderId: string) => (d: LocalDocument) => d.folderId === folderId && d.parentDocumentId === null && !d.inTrash && d.archivedAt === null && d.kind !== "template";

defineLocal(api.organization.index, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const docs = await ctx.db.list("documents");
  const folderRows = [];
  if (args.only !== "tags") {
    const folders = (await ctx.db.list("folders")).filter((f) => f.deletedAt === null);
    const live = new Set(folders.map((f) => f.id));
    for (const f of folders) {
      const inside = docs.filter(listedIn(f.id));
      folderRows.push({
        id: f.id,
        name: f.name,
        color: f.color,
        parentFolderId: f.parentFolderId && live.has(f.parentFolderId) ? f.parentFolderId : null,
        rank: f.rank,
        createdAt: f.createdAt,
        updatedAt: Math.max(f.updatedAt, ...inside.map((d) => d.updatedAt)),
        documentCount: inside.length,
        previews: [...inside]
          .sort((a, b) => b.updatedAt - a.updatedAt || a.createdAt - b.createdAt)
          .slice(0, 3)
          .map((d) => ({ cover: d.cover, title: d.title, excerpt: d.excerpt.slice(0, 280) })),
      });
    }
  }
  const tagRows = [];
  if (args.only !== "folders") {
    for (const t of await ctx.db.list("tags")) {
      tagRows.push({ id: t.id, name: t.name, color: t.color, createdAt: t.createdAt, documentCount: docs.filter((d) => d.tagIds.includes(t.id)).length });
    }
  }
  return { folders: folderRows, tags: tagRows };
});
