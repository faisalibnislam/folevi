// organization.* in local mode (convex/organization.ts): the library's folders (nested up to
// MAX_FOLDER_DEPTH levels) and tags. They live in the library index (the store's folders and tags), one
// person owns them all, so every check the server makes for access is "yes" here; the rules, the errors and
// the shapes are the server's.
import { MAX_FOLDER_DEPTH, canNestFolderIn, folderMoveProblem, isValidId, normalizeForSearch, rankBetween, ulid, type FolderLink } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { FOLDER_COLORS } from "@/lib/folderColors";
import { fail } from "../errors";
import { defineLocal, type LocalMutationCtx, type LocalReader } from "../registry";
import type { LocalDocument, LocalFolder, LocalTag } from "../store";
import { checkScope, requireProfile } from "./shared";

const TAG_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"];
const TOO_DEEP = `Folders can be nested up to ${MAX_FOLDER_DEPTH} levels deep.`;
const FOLDER_ORDINAL_KEY = "folderOrdinal";
const TAG_ORDINAL_KEY = "tagOrdinal";

const isFolderColor = (c: string) => FOLDER_COLORS.some((f) => f.id === c);
const randomFolderColor = () => FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]!.id;

/** By rank (the sidebar's order). */
const byRank = (a: LocalFolder, b: LocalFolder) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1);

/**
 * In the order they were made (the server reads folders and tags by creation). Rows made in the same
 * millisecond go by the library's count (a library from before it had one: by rank, then id).
 */
const byCreation = <R extends { createdAt: number; ordinal?: number; id: string; rank?: string }>(a: R, b: R) =>
  a.createdAt - b.createdAt || (a.ordinal ?? 0) - (b.ordinal ?? 0) || ((a.rank ?? "") < (b.rank ?? "") ? -1 : (a.rank ?? "") > (b.rank ?? "") ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every folder, deleted ones too (they keep their rank, as on the server). */
const allFolders = (db: LocalReader) => db.list("folders");

const liveFolders = async (db: LocalReader) => (await allFolders(db)).filter((f) => f.deletedAt === null);

/** The live folders as a tree the shared folder helpers walk. */
const folderLinks = (folders: LocalFolder[]): FolderLink[] => folders.filter((f) => f.deletedAt === null).map((f) => ({ id: f.id, parentFolderId: f.parentFolderId }));

function cleanName(name: string, max = 80): string {
  const n = name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
  if (!n) fail("invalid_argument", "Name can't be empty.");
  return n;
}

async function nextOrdinal(ctx: LocalMutationCtx, key: string): Promise<number> {
  const n = (((await ctx.db.get("meta", key)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", key, n);
  return n;
}

/** The next folder's place in creation order (setup.ts numbers the welcome folders with it too). */
export const nextFolderOrdinal = (ctx: LocalMutationCtx) => nextOrdinal(ctx, FOLDER_ORDINAL_KEY);
/** The next tag's place in creation order. */
export const nextTagOrdinal = (ctx: LocalMutationCtx) => nextOrdinal(ctx, TAG_ORDINAL_KEY);

/** A live folder, or the server's "not found". */
async function folderFor(ctx: LocalMutationCtx, folderId: string): Promise<LocalFolder> {
  await requireProfile(ctx);
  const folder = await ctx.db.get("folders", folderId);
  if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
  return folder;
}

async function tagFor(ctx: LocalMutationCtx, tagId: string): Promise<LocalTag> {
  await requireProfile(ctx);
  const tag = await ctx.db.get("tags", tagId);
  if (!tag) fail("not_found", "Tag not found.");
  return tag;
}

const tagNamed = async (db: LocalReader, normalizedName: string) => (await db.list("tags")).find((t) => t.normalizedName === normalizedName) ?? null;

/** A folder's listed notes: top level, not in Trash or the Archive, not templates. */
const listedIn = (folderId: string) => (d: LocalDocument) => d.folderId === folderId && d.parentDocumentId === null && !d.inTrash && d.archivedAt === null && d.kind !== "template";

/** A live folder's parent as the server shows it: null when the parent was deleted. */
const shownParent = (f: LocalFolder, live: Set<string>) => (f.parentFolderId && live.has(f.parentFolderId) ? f.parentFolderId : null);

/** One folder of the All folders view / Home (organization.ts folderRow). */
function folderRow(f: LocalFolder, docs: LocalDocument[], live: Set<string>) {
  const inside = docs.filter(listedIn(f.id));
  return {
    id: f.id,
    name: f.name,
    color: f.color,
    parentFolderId: shownParent(f, live),
    rank: f.rank,
    createdAt: f.createdAt,
    updatedAt: Math.max(f.updatedAt, ...inside.map((d) => d.updatedAt)),
    documentCount: inside.length,
    previews: [...inside]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.createdAt - b.createdAt || a.ordinal - b.ordinal)
      .slice(0, 3)
      .map((d) => ({ cover: d.cover, title: d.title, excerpt: d.excerpt.slice(0, 280) })),
  };
}

defineLocal(api.organization.sidebar, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const folders = await liveFolders(ctx.db);
  const live = new Set(folders.map((f) => f.id));
  const tags = await ctx.db.list("tags");
  return {
    // An encrypted space's replica knows which folders are Always fully encrypted (as the server's sidebar says).
    folders: folders.sort(byRank).map((f) => ({ id: f.id, name: f.name, color: f.color, parentFolderId: shownParent(f, live), rank: f.rank, ...((f as { locked?: boolean }).locked ? { locked: true as const } : {}) })),
    tags: tags.sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
});

defineLocal(api.organization.index, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const docs = await ctx.db.list("documents");
  const folderRows = [];
  if (args.only !== "tags") {
    const folders = (await liveFolders(ctx.db)).sort(byCreation);
    const live = new Set(folders.map((f) => f.id));
    for (const f of folders) folderRows.push(folderRow(f, docs, live));
  }
  const tagRows = [];
  if (args.only !== "folders") {
    for (const t of (await ctx.db.list("tags")).sort(byCreation)) {
      tagRows.push({ id: t.id, name: t.name, color: t.color, createdAt: t.createdAt, documentCount: docs.filter((d) => d.tagIds.includes(t.id)).length });
    }
  }
  return { folders: folderRows, tags: tagRows };
});

defineLocal(api.organization.recentFolders, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const folders = (await liveFolders(ctx.db)).sort(byCreation);
  const live = new Set(folders.map((f) => f.id));
  const byId = new Map(folders.map((f) => [f.id, f]));
  const docs = await ctx.db.list("documents");
  // A folder's last change: its own, or its most recently edited listed note.
  const latest = new Map<string, number>();
  for (const f of folders) latest.set(f.id, Math.max(f.updatedAt, ...docs.filter(listedIn(f.id)).map((d) => d.updatedAt)));
  const limit = Math.max(0, Math.min(Math.floor(args.limit), 100));
  const recent = [...folders].sort((a, b) => latest.get(b.id)! - latest.get(a.id)!).slice(0, limit);
  return {
    total: folders.length,
    folders: recent.map((f) => {
      const parent = f.parentFolderId ? byId.get(f.parentFolderId) : undefined;
      return { ...folderRow(f, docs, live), parentName: parent?.name ?? null };
    }),
  };
});

/** Notes in Drafts: in no folder, top level, not archived or in Trash, pages and daily notes only. */
defineLocal(api.organization.draftCount, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const docs = await ctx.db.list("documents");
  return Math.min(5000, docs.filter((d) => d.parentDocumentId === null && !d.inTrash && d.archivedAt === null && d.folderId === null && (d.kind === "document" || d.kind === "daily")).length);
});

/** `id` is the client's (a folder made offline); sending the same create again returns it, once. */
defineLocal(api.organization.createFolder, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  if (args.id !== undefined) {
    if (!isValidId(args.id)) fail("invalid_argument", "Invalid folder id.");
    const existing = await ctx.db.get("folders", args.id);
    if (existing) return { id: existing.id };
  }
  let parentFolderId: string | null = null;
  if (args.parentFolderId) {
    const parent = await ctx.db.get("folders", args.parentFolderId);
    if (!parent || parent.deletedAt !== null) fail("not_found", "Folder not found.");
    parentFolderId = parent.id;
  }
  const siblings = await allFolders(ctx.db);
  if (parentFolderId && !canNestFolderIn(folderLinks(siblings), parentFolderId)) fail("invalid_argument", TOO_DEEP);
  const last = siblings.map((f) => f.rank).sort().pop() ?? null;
  const id = args.id ?? ulid();
  const now = ctx.now();
  const folder: LocalFolder = {
    id,
    name: cleanName(args.name),
    // Every folder gets a colour; people can change it from the folder menu.
    color: randomFolderColor(),
    parentFolderId,
    rank: rankBetween(last, null),
    createdAt: now,
    ordinal: await nextFolderOrdinal(ctx),
    updatedAt: now,
    deletedAt: null,
  };
  await ctx.nextSeq();
  ctx.db.put("folders", id, folder);
  return { id };
});

defineLocal(api.organization.renameFolder, "mutation", async (ctx, args) => {
  const folder = await folderFor(ctx, args.folderId);
  await ctx.nextSeq();
  ctx.db.put("folders", folder.id, { ...folder, name: cleanName(args.name), updatedAt: ctx.now() });
  return null;
});

/** One of FOLDER_COLORS, or back to the default with null. */
defineLocal(api.organization.setFolderColor, "mutation", async (ctx, args) => {
  const folder = await folderFor(ctx, args.folderId);
  if (args.color !== null && !isFolderColor(args.color)) fail("invalid_argument", "Unknown folder colour.");
  await ctx.nextSeq();
  ctx.db.put("folders", folder.id, { ...folder, color: args.color, updatedAt: ctx.now() });
  return null;
});

defineLocal(api.organization.moveFolder, "mutation", async (ctx, args) => {
  const folder = await folderFor(ctx, args.folderId);
  let parentFolderId: string | null = null;
  if (args.parentFolderId) {
    const parent = await ctx.db.get("folders", args.parentFolderId);
    if (!parent || parent.deletedAt !== null) fail("not_found", "Folder not found.");
    parentFolderId = parent.id;
  }
  const all = await allFolders(ctx.db);
  // The folder moves with everything inside it: never into itself or a subfolder, never past the deepest level.
  const problem = folderMoveProblem(folderLinks(all), folder.id, parentFolderId);
  if (problem === "self" || problem === "descendant") fail("invalid_argument", "A folder can't go inside itself or one of its subfolders.");
  if (problem === "depth") fail("invalid_argument", TOO_DEEP);
  const siblings = all.filter((f) => f.id !== folder.id && f.parentFolderId === parentFolderId && f.deletedAt === null).sort(byRank);
  let rank = folder.rank;
  if (args.afterFolderId !== undefined) {
    const idx = args.afterFolderId === null ? -1 : siblings.findIndex((s) => s.id === args.afterFolderId);
    const prev = idx >= 0 ? siblings[idx]!.rank : null;
    const next = siblings[idx + 1]?.rank ?? null;
    rank = rankBetween(prev, next);
  }
  await ctx.nextSeq();
  ctx.db.put("folders", folder.id, { ...folder, parentFolderId, rank, updatedAt: ctx.now() });
  return null;
});

/**
 * Deleting a folder never deletes notes: they go to Drafts. Its subfolders move up a level, into the
 * deleted folder's parent (or to the top), with everything inside them as it was.
 */
defineLocal(api.organization.deleteFolder, "mutation", async (ctx, args) => {
  const folder = await folderFor(ctx, args.folderId);
  const seq = await ctx.nextSeq();
  const now = ctx.now();
  const all = await allFolders(ctx.db);
  const parent = folder.parentFolderId ? all.find((f) => f.id === folder.parentFolderId) : undefined;
  const newParent = parent && parent.deletedAt === null ? parent.id : null;
  for (const c of all) if (c.parentFolderId === folder.id && c.deletedAt === null) ctx.db.put("folders", c.id, { ...c, parentFolderId: newParent, updatedAt: now });
  for (const d of await ctx.db.list("documents")) if (d.folderId === folder.id) ctx.db.put("documents", d.id, { ...d, folderId: null, seq, revision: d.revision + 1 });
  ctx.db.put("folders", folder.id, { ...folder, deletedAt: now });
  return null;
});

defineLocal(api.organization.createTag, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  const name = cleanName(args.name.replace(/^#/, ""), 40);
  const normalizedName = normalizeForSearch(name);
  const existing = await tagNamed(ctx.db, normalizedName);
  if (existing) return { id: existing.id };
  const id = ulid();
  const tag: LocalTag = {
    id,
    name,
    normalizedName,
    color: TAG_COLORS.includes(args.color ?? "") ? args.color! : TAG_COLORS[Math.floor(Math.random() * 5)]!,
    createdAt: ctx.now(),
    ordinal: await nextTagOrdinal(ctx),
  };
  await ctx.nextSeq();
  ctx.db.put("tags", id, tag);
  return { id };
});

defineLocal(api.organization.updateTag, "mutation", async (ctx, args) => {
  const tag = await tagFor(ctx, args.tagId);
  const name = args.name !== undefined ? cleanName(args.name.replace(/^#/, ""), 40) : tag.name;
  const normalizedName = normalizeForSearch(name);
  if (normalizedName !== tag.normalizedName) {
    const clash = await tagNamed(ctx.db, normalizedName);
    if (clash && clash.id !== tag.id) fail("invalid_argument", `There's already a tag called #${clash.name}.`);
  }
  if (args.color !== undefined && !TAG_COLORS.includes(args.color)) fail("invalid_argument", "Unknown tag color.");
  await ctx.nextSeq();
  ctx.db.put("tags", tag.id, { ...tag, name, normalizedName, color: args.color ?? tag.color });
  return null;
});

/** The tag goes, and comes off every note that had it (their dates and revisions don't change). */
defineLocal(api.organization.deleteTag, "mutation", async (ctx, args) => {
  const tag = await tagFor(ctx, args.tagId);
  for (const d of await ctx.db.list("documents")) if (d.tagIds.includes(tag.id)) ctx.db.put("documents", d.id, { ...d, tagIds: d.tagIds.filter((t) => t !== tag.id) });
  ctx.db.remove("tags", tag.id);
  await ctx.nextSeq();
  return null;
});

/** Sets a note's tags (at most 20). Tags it keeps stay in place; new ones follow, in the order given. */
defineLocal(api.organization.setDocumentTags, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const wanted: string[] = [];
  for (const id of args.tagIds.slice(0, 20)) {
    const tag = await ctx.db.get("tags", id);
    if (!tag) fail("not_found", "Tag not found.");
    if (!wanted.includes(tag.id)) wanted.push(tag.id);
  }
  const kept = doc.tagIds.filter((t) => wanted.includes(t));
  const tagIds = [...kept, ...wanted.filter((t) => !kept.includes(t))];
  ctx.db.put("documents", doc.id, { ...doc, tagIds, seq: await ctx.nextSeq(), updatedAt: ctx.now() });
  return null;
});
