// Synced blocks: one piece of content shown in several notes (docs/SYNCED_BLOCKS.md).
//
// The content is a synced source: a document of kind "synced" in a Personal or a workspace, holding ordinary
// blocks and edited through the sync protocol like any note. It is never listed as a page (lists filter by
// kind, its search text is empty, it's never indexed for Foli AI). Each note shows it through a `synced`
// block (`props.sourceId` = the source's public id), which the backlink index records as a link to the source
// (syncLinks), so the notes showing a source are found from it (lib/syncedRefs.ts).
//
// Who sees it (lib/auth.ts documentAccessInfo): whoever can read or edit a note in the same place showing it
// can read or edit it there; the place's owner and admins (and Personal's owner) manage it; nobody else. A note
// in another place shows it only to people who can open it that way; everyone else sees "You don't have access".
//
// Public share pages and the search text, which everyone who can read a note sees, include the content only
// when the source is in the note's own place (exactly the people who can read that note can read it). A
// source from another place is left out of them.
//
// When no note in a live state shows it any more (the last synced block deleted, or its notes moved to
// Trash), the source goes to Trash with nothing removed: a reference coming back (undo, a version restored, a
// note restored from Trash) brings it back. Trash retention or emptying Trash deletes it for good, like a page.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { expandSyncedBlocks, syncedSourceIds, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, getDocumentByPublicId } from "./auth";
import { insertScoped, sameScopeRows, scopeOfRow } from "./scope";
import { nextSeq } from "./seq";
import { syncedReferences } from "./syncedRefs";

type Ctx = QueryCtx | MutationCtx;

/** A source's live blocks as wire blocks (the same as lib/documents.ts liveBlocks + toWireBlock, which import this file). */
export async function sourceBlocks(ctx: Ctx, sourceId: Id<"documents">): Promise<WireBlock[]> {
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_document_deleted", (q) => q.eq("documentId", sourceId).eq("deletedAt", undefined))
    .collect();
  return rows.map((row) => ({
    id: row.blockId,
    type: row.type,
    parentId: row.parentId,
    rank: row.rank,
    schemaVersion: row.schemaVersion,
    text: row.text as WireBlock["text"],
    props: row.props as Record<string, unknown>,
    revision: row.revision,
  }));
}

/** Sources read at most per note (each one costs reading its blocks). */
const MAX_SOURCES_PER_NOTE = 40;

/**
 * A note's blocks with the content of its synced blocks in place, as `reader` may see it: a source they can
 * read (directly, or through a note in its place) is shown; anything else is left out. For exports, MCP and
 * Foli AI, which act for one person.
 */
export async function withSyncedForReader(ctx: Ctx, reader: Doc<"profiles">, blocks: WireBlock[]): Promise<WireBlock[]> {
  const ids = syncedSourceIds(blocks).slice(0, MAX_SOURCES_PER_NOTE);
  if (!ids.length) return blocks;
  const content = new Map<string, WireBlock[] | null>();
  for (const id of ids) {
    const source = await getDocumentByPublicId(ctx, id);
    const ok = source && source.kind === "synced" && source.deletedAt === undefined && !source.inTrash && accessAtLeast(await documentAccess(ctx, reader, source), "read");
    content.set(id, ok ? await sourceBlocks(ctx, source._id) : null);
  }
  return expandSyncedBlocks(blocks, (id) => content.get(id) ?? null);
}

/**
 * A note's blocks with the content of its synced blocks in place, as everyone who can read the note sees it:
 * only sources in the note's own place (a source from another place stays out). For public share pages and the
 * note's search text.
 */
export async function withSyncedShared(ctx: Ctx, note: Doc<"documents">, blocks: WireBlock[]): Promise<{ blocks: WireBlock[]; sources: Id<"documents">[] }> {
  const ids = syncedSourceIds(blocks).slice(0, MAX_SOURCES_PER_NOTE);
  if (!ids.length || note.kind === "synced") return { blocks, sources: [] };
  const content = new Map<string, WireBlock[] | null>();
  const sources: Id<"documents">[] = [];
  for (const id of ids) {
    const source = await getDocumentByPublicId(ctx, id);
    const ok = source && source.kind === "synced" && !source.inTrash && source.deletedAt === undefined && sameScopeRows(source, note);
    if (ok) sources.push(source._id);
    content.set(id, ok ? await sourceBlocks(ctx, source._id) : null);
  }
  return { blocks: expandSyncedBlocks(blocks, (id) => content.get(id) ?? null), sources };
}

/** Whether a source is shown by a note that isn't in Trash. */
async function hasLiveReference(ctx: Ctx, source: Doc<"documents">): Promise<boolean> {
  return (await syncedReferences(ctx, source)).some((r) => !r.note.inTrash);
}

/** Moves a source to Trash or out of it (with its to-dos' task rows). Nothing is deleted. */
async function setSourceTrash(ctx: MutationCtx, source: Doc<"documents">, actor: Id<"profiles">, inTrash: boolean): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(source._id, {
    inTrash,
    deletedAt: inTrash ? now : undefined,
    deletedBy: inTrash ? actor : undefined,
    seq: await nextSeq(ctx, scopeOfRow(source)),
    revision: source.revision + 1,
    updatedAt: now,
  });
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_document", (q) => q.eq("documentId", source._id))
    .collect();
  for (const t of tasks) await ctx.db.patch(t._id, { documentInTrash: inTrash });
}

/**
 * After the notes showing `publicId` may have changed (a synced block written, moved or deleted; a note moved to
 * or out of Trash): a source no live note shows goes to Trash, and one shown again comes back.
 */
export async function refreshSyncedSource(ctx: MutationCtx, publicId: string, actor: Id<"profiles">): Promise<void> {
  const source = await getDocumentByPublicId(ctx, publicId);
  if (!source || source.kind !== "synced") return;
  const live = await hasLiveReference(ctx, source);
  if (live && source.inTrash) await setSourceTrash(ctx, source, actor, false);
  else if (!live && !source.inTrash) await setSourceTrash(ctx, source, actor, true);
}

/** refreshSyncedSource for every source the given notes show (they just went to Trash or came back). */
export async function refreshSourcesShownBy(ctx: MutationCtx, noteIds: Id<"documents">[], actor: Id<"profiles">): Promise<void> {
  const seen = new Set<string>();
  for (const noteId of noteIds) {
    const links = await ctx.db
      .query("documentLinks")
      .withIndex("by_source", (q) => q.eq("sourceDocumentId", noteId))
      .take(500);
    for (const l of links) {
      if (seen.has(l.targetPublicId)) continue;
      seen.add(l.targetPublicId);
      await refreshSyncedSource(ctx, l.targetPublicId, actor);
    }
  }
}

/**
 * The notes in the same place that show `source` and whose search text includes it: refreshed when the source's
 * own text is (lib/documents.ts refreshDerived).
 */
export async function notesShowingInPlace(ctx: Ctx, source: Doc<"documents">): Promise<Doc<"documents">[]> {
  const out = new Map<string, Doc<"documents">>();
  for (const { note } of await syncedReferences(ctx, source)) if (!note.inTrash && sameScopeRows(note, source)) out.set(note._id, note);
  return [...out.values()].slice(0, 50);
}

/**
 * Whether `profile` may put a synced block showing `sourceId` into a note: the source must exist (Trash is fine:
 * showing it again brings it back) and they must be able to read it. A note in a source is refused elsewhere.
 */
export async function canReferenceSource(ctx: Ctx, profile: Doc<"profiles">, sourceId: string): Promise<boolean> {
  const source = await getDocumentByPublicId(ctx, sourceId);
  if (!source || source.kind !== "synced") return false;
  return accessAtLeast(await documentAccess(ctx, profile, source), "read");
}

/**
 * The synced blocks of a note made in one go (a duplicate, a copy to another place, a note from a template):
 * recorded as links to their content like any synced block written through sync (syncLinks), so the content
 * knows the new note shows it (and comes back from Trash if it was there).
 */
export async function indexSyncedBlocks(ctx: MutationCtx, note: Doc<"documents">, rows: Doc<"blocks">[]): Promise<void> {
  for (const row of rows) {
    const sourceId = (row.props as { sourceId?: unknown }).sourceId;
    if (row.type !== "synced" || row.deletedAt !== undefined || typeof sourceId !== "string") continue;
    const existing = await ctx.db
      .query("documentLinks")
      .withIndex("by_source_block", (q) => q.eq("sourceDocumentId", note._id).eq("blockId", row.blockId))
      .collect();
    if (!existing.some((l) => l.targetPublicId === sourceId)) await insertScoped(ctx, "documentLinks", scopeOfRow(note), { sourceDocumentId: note._id, targetPublicId: sourceId, blockId: row.blockId });
    await refreshSyncedSource(ctx, sourceId, row.updatedBy);
  }
}
