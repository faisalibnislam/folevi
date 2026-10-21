// What the server reads of a Standard (not sealed) note for a purpose (docs/E2EE_DESIGN.md §5.6
// `readableFor`): the same text the server has always used, gathered in one place so search, Foli AI and
// apps read Standard notes and readable copies (`e2eeMirrors`) of sealed notes in the same shape.
//
//   search: the title and the note's search text plus the text found in its files (PDFs, images, handwriting).
//   ai, apps: the title, the note as Markdown (the shape of mcp.ts noteDetail), its folder path, tags and to-dos.
//
// Nothing here is written anywhere. Links carry only titles everyone who can read the note may see
// (sharedLabels), since no particular reader is known. A sealed note never comes here: `readableFor`
// checks `isSealed` first, and this refuses one anyway (an empty result) so no caller can read placeholders
// as if they were text.
import { blocksToMarkdown, folderPath } from "@folevi/editor-schema";
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { scopeOfRow } from "../scope";
import { sharedLabels } from "../linkLabels";
import { withSyncedShared } from "../synced";
import { liveBlocks, toWireBlock } from "../documents";
import type { MirrorPurpose, MirrorTask } from "./validators";

/** How much found text a search copy carries per note (the same cap as a mirror's text, §5.8). */
const MAX_TEXT = 1024 * 1024;
/** Folders read to build a folder path (as mcp.ts scopeFolders). */
const MAX_FOLDERS = 500;
const MAX_TAGS = 50;
const MAX_TASKS = 500;

export interface PlainReadable {
  title: string;
  text: string;
  tasks?: MirrorTask[];
  folderPath?: string;
  tags?: string[];
}

/** A Standard note as the server reads it for `purpose`. */
export async function plainReadable(ctx: QueryCtx, doc: Doc<"documents">, purpose: MirrorPurpose): Promise<PlainReadable> {
  if (doc.sealedAt !== undefined) return { title: "", text: "" };
  const title = doc.title;
  if (purpose === "search") return { title, text: await searchTextOf(ctx, doc) };
  const own = (await liveBlocks(ctx, doc._id)).map(toWireBlock);
  const blocks = await sharedLabels(ctx, doc, (await withSyncedShared(ctx, doc, own)).blocks);
  const out: PlainReadable = { title, text: blocksToMarkdown(blocks).slice(0, MAX_TEXT) };
  const path = await folderPathOf(ctx, doc);
  if (path !== null) out.folderPath = path;
  out.tags = await tagNamesOf(ctx, doc);
  out.tasks = await tasksOf(ctx, doc);
  return out;
}

/** The note's search text and the text found in its files, as one string. */
async function searchTextOf(ctx: QueryCtx, doc: Doc<"documents">): Promise<string> {
  const parts = [doc.searchText];
  let size = doc.searchText.length;
  const found = await ctx.db
    .query("fileTexts")
    .withIndex("by_document_block", (q) => q.eq("documentId", doc._id))
    .take(200);
  for (const f of found) {
    if (size >= MAX_TEXT) break;
    parts.push(f.text);
    size += f.text.length + 1;
  }
  return parts.join("\n").slice(0, MAX_TEXT);
}

/** "Projects / Clients" for a note in a folder (its own folder, not an ancestor page's), else null. */
async function folderPathOf(ctx: QueryCtx, doc: Doc<"documents">): Promise<string | null> {
  if (!doc.folderId) return null;
  const folder = await ctx.db.get(doc.folderId);
  if (!folder || folder.deletedAt) return null;
  const scope = scopeOfRow(doc);
  const folders = await (
    scope.kind === "personal"
      ? ctx.db.query("folders").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("folders").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  ).take(MAX_FOLDERS);
  const live = folders.filter((f) => !f.deletedAt);
  return folderPath(
    live.map((f) => ({ id: f._id as string, name: f.name, parentFolderId: f.parentFolderId ?? null })),
    folder._id,
  ) || folder.name;
}

async function tagNamesOf(ctx: QueryCtx, doc: Doc<"documents">): Promise<string[]> {
  const links = await ctx.db
    .query("documentTags")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .take(MAX_TAGS);
  const names: string[] = [];
  for (const l of links) {
    const tag = await ctx.db.get(l.tagId);
    // A sealed tag's name is "" on the server: it isn't readable, so it isn't listed.
    if (tag && tag.sealedName === undefined && tag.name) names.push(tag.name);
  }
  return names;
}

async function tasksOf(ctx: QueryCtx, doc: Doc<"documents">): Promise<MirrorTask[]> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .take(MAX_TASKS);
  return rows
    .filter((t) => t.status !== "canceled")
    .map((t) => {
      const task: MirrorTask = { blockId: t.blockId, text: t.title, done: t.status === "done" };
      if (t.dueDate !== undefined) task.due = t.dueDate;
      if (t.dueTime !== undefined) task.dueTime = t.dueTime;
      return task;
    });
}
