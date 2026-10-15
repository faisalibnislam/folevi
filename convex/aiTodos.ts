// Notes that schedule themselves (docs/AI_ASSISTANT.md, "Find to-dos"): Foli AI lists a note's action items
// (or the selected text's) with the owner and the date as written, the owner matched to someone here, for
// the person to check before anything is added. The browser resolves the dates (lib/ai/actionItems.ts in
// the web app) and inserts the accepted ones as to-do blocks through the editor, so they sync like typed
// to-dos and become tasks (Calendar, Tasks, the calendar feed and reminders follow from that).
//
// Credits: one call, held up front and settled from what it really cost (ai.begin, ai.metered), as writing
// help. Same gates as every AI request; nothing from a Core scope is sent.
import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { blocksToMarkdown, matchOwner, type AssignablePerson } from "@folevi/editor-schema";
import { requireDocument, requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { ReaderLabels } from "./lib/linkLabels";
import { vScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { FIND_TODOS_MAX_OUTPUT, findTodosInputChars, findTodosRequest, parseActionItems } from "./lib/ai/actionItems";
import { gemini, metered } from "./ai";

/** The selected text sent is at most this long, and the whole note at most this much Markdown. */
const MAX_TEXT = 24_000;
const NOTE_CHARS = 30_000;

/**
 * What finding to-dos in a note needs, if this person can edit it (the to-dos go into it): the note as
 * Markdown (unless only selected text is read), and who its to-dos can be assigned to (assignablePeople).
 */
export const source = internalQuery({
  args: { documentId: v.string(), withNote: v.boolean() },
  handler: async (ctx, args): Promise<{ note: { title: string; text: string } | null; people: (AssignablePerson & { isYou: boolean })[] }> => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (doc.inTrash) fail("not_found", "Document not found.");
    let note: { title: string; text: string } | null = null;
    if (args.withNote) {
      // Link labels as this person may see them (lib/linkLabels.ts), as for every AI read of a note.
      const blocks = await new ReaderLabels(ctx, profile).blocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
      // A note with nothing written in it (only its title) has no to-dos to find.
      const body = blocksToMarkdown(blocks).slice(0, NOTE_CHARS);
      note = { title: doc.title || "Untitled", text: body.trim() ? body : "" };
    }
    return { note, people: await assignablePeople(ctx, profile, doc) };
  },
});

/**
 * Who a note's to-dos can be assigned to: in a workspace the person belongs to, its members; anywhere else
 * (Personal, or a workspace they're a guest in) only them. The person comes first, then by name.
 */
async function assignablePeople(ctx: QueryCtx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<(AssignablePerson & { isYou: boolean })[]> {
  const people: (AssignablePerson & { isYou: boolean })[] = [{ profileId: profile._id, displayName: profile.displayName, isYou: true }];
  const workspaceId = doc.workspaceId;
  const member = workspaceId
    ? await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", profile._id))
        .unique()
    : null;
  if (workspaceId && member) {
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(300);
    for (const m of members) {
      if (m.profileId === profile._id) continue;
      const p = await ctx.db.get(m.profileId);
      if (p && p.status !== "deleted") people.push({ profileId: p._id, displayName: p.displayName, isYou: false });
    }
  }
  people.sort((a, b) => (a.isYou !== b.isYou ? (a.isYou ? -1 : 1) : a.displayName.localeCompare(b.displayName)));
  return people;
}

/**
 * The people a note's to-dos can go to, for "Add dates and people" on a meeting summary: its action items
 * already name an owner and a date, so no model call is needed, only who's here. Editors only.
 */
export const people = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (doc.inTrash) fail("not_found", "Document not found.");
    return (await assignablePeople(ctx, profile, doc)).map((p) => ({ profileId: p.profileId as string, displayName: p.displayName, isYou: p.isYou }));
  },
});

/** A proposed to-do: the action item, and who it goes to when the owner's name matched one person. */
export interface ProposedTodo {
  text: string;
  owner: string | null;
  when: string | null;
  quote: string | null;
  assigneeId: string | null;
  /** How the owner's name matched (see matchOwner): an "ambiguous" or "unknown" name stays unassigned. */
  match: "matched" | "ambiguous" | "unknown" | "none";
}

/**
 * Finds the to-dos in a note: in `text` (the selection) when given, otherwise the whole note. Returns them
 * with owners matched to `people` (who they can be assigned to, for the picker). Nothing here changes the
 * note: the person picks which to add, and the editor adds them.
 */
export const find = action({
  args: { scope: vScopeArg, documentId: v.string(), text: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ items: ProposedTodo[]; people: { profileId: string; displayName: string; isYou: boolean }[] }> => {
    await requireIdentity(ctx);
    const text = (args.text ?? "").slice(0, MAX_TEXT);
    const withNote = !text.trim();
    const plan: PlannedCall[] = [{ fast: false, inputChars: findTodosInputChars(withNote ? NOTE_CHARS : text.length), maxOutputTokens: FIND_TODOS_MAX_OUTPUT }];
    // The note's own scope decides (and pays), as for all writing help on a note.
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: true, plan, feature: "writing" });
    return await metered(ctx, holdId, async (meter) => {
      const { note, people } = await ctx.runQuery(internal.aiTodos.source, { documentId: args.documentId, withNote });
      if (withNote && !note?.text.trim()) fail("invalid_argument", "There's nothing in this note to find to-dos in yet.");
      const raw = await gemini(findTodosRequest({ note, text: withNote ? undefined : text }), meter);
      const items = parseActionItems(raw, withNote ? note!.text : text).map((item): ProposedTodo => {
        const { assigneeId, status } = matchOwner(item.owner, people);
        return { ...item, assigneeId, match: status };
      });
      return { items, people };
    });
  },
});
