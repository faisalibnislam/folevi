// Proactive suggestions (docs/AI_ASSISTANT.md, "Memory, suggestions, digests"): quiet chips on a note,
// computed without any model call.
//
//   connection: a note that mentions the same people, projects or topics but isn't linked either way
//               (the knowledge graph, convex/aiGraph.ts). Plans with the graph only.
//   duplicate:  a note with nearly the same content and a similar title (the graph's "similar" relations).
//               Plans with the graph only.
//   question:   an open question in the note (lib/ai/suggestions.ts). Any plan with AI.
//   action:     a line that reads like an action item but isn't a to-do yet. Any plan with AI.
//
// Every note shown is one the person can open (their own access, whatever the graph's rows say). A
// dismissed suggestion stays dismissed for that person on that note (`aiSuggestionDismissals`). Settings >
// AI "Suggestions" off, AI off, or a Core scope: nothing is computed or shown.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { accessAtLeast, documentAccess, getDocumentByPublicId, requireDocument, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { aiBlockedIn } from "./lib/credits";
import { hasValidScope, insertScoped, scopeOfRow } from "./lib/scope";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { ReaderLabels } from "./lib/linkLabels";
import { aiPrefsOf } from "./lib/ai/prefs";
import { DUPLICATE_MIN, likelyDuplicate, sharedReason } from "./lib/ai/graph";
import { patternItems, patternSuggestions, suggestionKey, suggestionLines, validSuggestionKey } from "./lib/ai/suggestions";
import { linkedNotes, noteFor, noteRelations, openable, sharedEntityNotes } from "./aiGraph";

/** Shown at most, of each graph kind. */
const CONNECTIONS_SHOWN = 3;
const DUPLICATES_SHOWN = 2;
/** Dismissals kept per person and note (the oldest goes past this). */
const MAX_DISMISSALS = 300;

export interface Suggestion {
  key: string;
  kind: "connection" | "duplicate" | "question" | "action";
  /** What the chip says: the other note's title, or the line. */
  label: string;
  /** The other note (connection, duplicate). */
  noteId?: string;
  /** Why it's suggested (a connection's shared names). */
  reason?: string;
  /** The line in this note (question, action). */
  blockId?: string;
  /** Characters of a leading "TODO:" a to-do made from the line leaves out (action). */
  strip?: number;
}

/**
 * The suggestions for a note, for the person looking at it. `on` is false while suggestions (or AI) are
 * off or the scope has no AI, and then nothing is computed. `canEdit`: they can act on the note (link,
 * turn into a task); otherwise only open and dismiss.
 */
export const forNote = query({
  // `lines: false`: the caller finds questions and action items in its own copy of the note
  // (patternSuggestions), so this reads only the graph, not the note's blocks, and doesn't re-run on every
  // save. Its `dismissed` keys apply to those too.
  args: { documentId: v.string(), lines: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ on: boolean; canEdit: boolean; items: Suggestion[]; dismissed: string[] }> => {
    const profile = await requireProfile(ctx);
    const off = { on: false, canEdit: false, items: [], dismissed: [] };
    if (!aiPrefsOf(profile).suggestions || profile.aiEnabled === false) return off;
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !hasValidScope(doc) || doc.inTrash || doc.deletedAt !== undefined || doc.kind === "template") return off;
    const access = await documentAccess(ctx, profile, doc);
    if (!accessAtLeast(access, "read")) return off;
    if (await aiBlockedIn(ctx, profile._id, scopeOfRow(doc))) return off;

    const dismissed = new Set(
      (
        await ctx.db
          .query("aiSuggestionDismissals")
          .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
          .take(MAX_DISMISSALS)
      ).map((d) => d.key),
    );
    const items: Suggestion[] = [];
    const add = (s: Suggestion) => {
      if (!dismissed.has(s.key)) items.push(s);
    };

    // From the graph, where the plan includes it (and the person's AI is on).
    const at = await noteFor(ctx, profile, args.documentId);
    if (at?.full) {
      const linked = await linkedNotes(ctx, doc);
      const shared = [...(await sharedEntityNotes(ctx, doc)).entries()]
        .filter(([id]) => !linked.has(id) && id !== doc._id)
        .map(([id, names]) => [id, [...new Set(names)]] as const)
        .sort(([, a], [, b]) => b.length - a.length);
      let connections = 0;
      for (const [id, names] of shared) {
        if (connections >= CONNECTIONS_SHOWN) break;
        const other = await ctx.db.get(id);
        if (!other || !(await openable(at.reader, other))) continue;
        const key = suggestionKey("connection", other.publicId);
        if (dismissed.has(key)) continue;
        add({ key, kind: "connection", label: other.title || "Untitled", noteId: other.publicId, reason: sharedReason(names) });
        connections++;
      }
      const seen = new Set<Id<"documents">>();
      let duplicates = 0;
      for (const r of (await noteRelations(ctx, doc)).filter((r) => r.kind === "similar" && (r.score ?? 0) >= DUPLICATE_MIN).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
        if (duplicates >= DUPLICATES_SHOWN) break;
        const otherId = r.sourceDocumentId === doc._id ? r.toDocumentId! : r.sourceDocumentId;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        const other = await ctx.db.get(otherId);
        if (!other || !(await openable(at.reader, other)) || !likelyDuplicate(r.score ?? 0, doc.title, other.title)) continue;
        const key = suggestionKey("duplicate", other.publicId);
        if (dismissed.has(key)) continue;
        add({ key, kind: "duplicate", label: other.title || "Untitled", noteId: other.publicId });
        duplicates++;
      }
    }

    // From the note's own lines (link labels as this person may see them), unless the caller reads them.
    if (args.lines !== false) {
      const blocks = await new ReaderLabels(ctx, profile).blocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
      items.push(...patternItems(patternSuggestions(suggestionLines(blocks)), dismissed));
    }
    return { on: true, canEdit: accessAtLeast(access, "write"), items, dismissed: [...dismissed] };
  },
});

/** Dismisses a suggestion on a note, for this person only. It doesn't come back. */
export const dismiss = mutation({
  args: { documentId: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!validSuggestionKey(args.key)) fail("invalid_argument", "That suggestion isn't valid.");
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const mine = await ctx.db
      .query("aiSuggestionDismissals")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .take(MAX_DISMISSALS + 1);
    if (mine.some((d) => d.key === args.key)) return null;
    if (mine.length >= MAX_DISMISSALS) {
      const oldest = mine.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      await ctx.db.delete(oldest._id);
    }
    await insertScoped(ctx, "aiSuggestionDismissals", scopeOfRow(doc), { profileId: profile._id, documentId: doc._id, key: args.key, createdAt: Date.now() });
    return null;
  },
});

