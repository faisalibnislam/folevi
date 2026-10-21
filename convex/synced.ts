import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { accessAtLeast, documentAccess, getDocumentByPublicId, requireProfile } from "./lib/auth";
import { syncedReferences } from "./lib/syncedRefs";
import { sealedFieldsOf } from "./lib/e2ee/sealedRows";

/**
 * What a synced block (lib/synced.ts) needs to draw itself: whether this person can see its content (and edit
 * it), and the notes showing it ("Synced, in 3 notes"): those they can open by name, the rest only counted.
 * `status`: "missing" (deleted for good, or never existed), "forbidden" (not theirs to see; the note shows
 * "You don't have access"), or "ok".
 */
export const info = query({
  args: { sourceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const source = await getDocumentByPublicId(ctx, args.sourceId);
    if (!source || source.kind !== "synced") return { status: "missing" as const };
    const access = await documentAccess(ctx, profile, source);
    if (!accessAtLeast(access, "read")) return { status: "forbidden" as const };
    const notes = new Map<string, Doc<"documents">>();
    for (const { note } of await syncedReferences(ctx, source)) if (!note.inTrash) notes.set(note._id, note);
    const open: { id: string; title: string; icon: string | null; sealed?: ReturnType<typeof sealedFieldsOf> }[] = [];
    for (const note of notes.values()) {
      if (open.length >= 50) break;
      if (!accessAtLeast(await documentAccess(ctx, profile, note), "read")) continue;
      // A sealed note's title is opened on the device (docs/E2EE_DESIGN.md §5.7).
      const sealed = sealedFieldsOf(note);
      open.push({ id: note.publicId, title: sealed ? "" : note.title || "Untitled", icon: note.icon ?? null, ...(sealed ? { sealed } : {}) });
    }
    return {
      status: "ok" as const,
      canEdit: accessAtLeast(access, "write") && !source.inTrash,
      inTrash: source.inTrash,
      noteCount: notes.size,
      notes: open,
    };
  },
});

/**
 * The first note showing this synced content that this person can open: where a link to the content itself
 * (a task, a mention, a search hit) takes them. Null when there's none.
 */
export const home = query({
  args: { sourceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const source = await getDocumentByPublicId(ctx, args.sourceId);
    if (!source || source.kind !== "synced") return null;
    for (const { note, row } of await syncedReferences(ctx, source)) {
      if (note.inTrash) continue;
      if (accessAtLeast(await documentAccess(ctx, profile, note), "read")) return { documentId: note.publicId, blockId: row.blockId };
    }
    return null;
  },
});
