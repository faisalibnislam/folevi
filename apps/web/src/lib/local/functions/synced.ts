// synced.* in local mode (convex/synced.ts; docs/SYNCED_BLOCKS.md). Synced content is a library note of kind
// "synced" (its own note file), shown in other notes by `synced` blocks; the notes showing it are found
// through their links (LocalDocument.links, kept by sync.push like the server's documentLinks), each checked
// against the block itself, so a page link that only names the content never counts.
//
// One person owns the library, so they can open every note showing it and edit it while it's out of Trash.
// Content no note shows goes to Trash and comes back when one shows it again (shared.ts refreshSyncedSource,
// run by sync.push and the Trash functions). A note's search text includes the content it shows
// (shared.ts refreshDerived); the trigger below keeps that true when the content itself is edited.
import { api } from "@/lib/convex/api";
import { defineLocal, defineTrigger, type LocalReader } from "../registry";
import type { LocalBlock, LocalDocument } from "../store";
import { refreshDerived, requireProfile } from "./shared";

/** References read at most (lib/syncedRefs.ts MAX_SYNCED_REFERENCES). */
const MAX_SYNCED_REFERENCES = 200;

export interface SyncedReference {
  /** The synced block in the note. */
  row: LocalBlock;
  /** The note it's in (possibly in Trash: callers decide). */
  note: LocalDocument;
}

/** The live synced blocks showing `source`, each with its note, in the order they were made (lib/syncedRefs.ts). */
export async function syncedReferences(db: LocalReader, source: LocalDocument): Promise<SyncedReference[]> {
  if (source.kind !== "synced") return [];
  const links: { note: LocalDocument; blockId: string; ordinal: number }[] = [];
  for (const note of await db.list("documents")) {
    // A synced block is never written inside synced content.
    if (note.kind === "synced") continue;
    for (const l of note.links ?? []) if (l.target === source.id) links.push({ note, blockId: l.blockId, ordinal: l.ordinal });
  }
  links.sort((a, b) => a.ordinal - b.ordinal);
  const out: SyncedReference[] = [];
  const seen = new Set<string>();
  for (const { note, blockId } of links.slice(0, MAX_SYNCED_REFERENCES)) {
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    const row = await db.get("blocks", blockId, note.id);
    if (!row || row.deletedAt !== null || row.type !== "synced" || (row.props as { sourceId?: unknown }).sourceId !== source.id) continue;
    out.push({ row, note });
  }
  return out;
}

defineLocal(api.synced.info, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const source = await ctx.db.get("documents", args.sourceId);
  if (!source || source.kind !== "synced") return { status: "missing" as const };
  const notes = new Map<string, LocalDocument>();
  for (const { note } of await syncedReferences(ctx.db, source)) if (!note.inTrash) notes.set(note.id, note);
  const open = [...notes.values()].slice(0, 50).map((note) => ({ id: note.id, title: note.title || "Untitled", icon: note.icon ?? null }));
  return { status: "ok" as const, canEdit: !source.inTrash, inTrash: source.inTrash, noteCount: notes.size, notes: open };
});

defineLocal(api.synced.home, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const source = await ctx.db.get("documents", args.sourceId);
  if (!source || source.kind !== "synced") return null;
  for (const { note, row } of await syncedReferences(ctx.db, source)) if (!note.inTrash) return { documentId: note.id, blockId: row.id };
  return null;
});

/**
 * Synced content edited (its blocks written): the notes showing it read again with the new content (the
 * server's refreshDerived of a source refreshes notesShowingInPlace), so search finds them by it.
 */
defineTrigger("synced:notes-showing-content", async (ctx, writes) => {
  const edited = new Set<string>();
  for (const w of writes) if (w.table === "blocks" && w.partition) edited.add(w.partition);
  if (!edited.size) return;
  for (const id of edited) {
    const source = await ctx.db.get("documents", id);
    if (!source || source.kind !== "synced") continue;
    const notes = new Map<string, LocalDocument>();
    for (const { note } of await syncedReferences(ctx.db, source)) if (!note.inTrash) notes.set(note.id, note);
    for (const note of [...notes.values()].slice(0, 50)) {
      const fresh = await refreshDerived(ctx.db, note);
      if (fresh.searchText !== note.searchText || fresh.excerpt !== note.excerpt || fresh.wordCount !== note.wordCount) ctx.db.put("documents", note.id, fresh);
    }
  }
});
