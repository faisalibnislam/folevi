// Changes: one place to see what other people, connected apps and Foli AI changed in the notes you've opened,
// since you last looked (docs/research/2026-10-14-competitive-analysis.md 9.1).
//
// Nothing extra is recorded per change. A person's row in `recents` says how far they've seen each note
// (`seenSeq`, the newest block change then, moved on when they open or leave it or mark it seen, and for people
// who can edit it, `seenVersionId`, the version holding it as it was). The note's blocks changed after that
// (`by_document_seq`) by someone else, or by a connected app or Foli AI acting for them (`blocks.updatedVia`),
// are its changes; the version is what they're compared with, and what "Undo this change" puts those lines
// back to. Lists stay bounded: the most recently opened notes, and a cap on the lines read per note.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireDocument, requireProfile } from "./lib/auth";
import { People, type PersonView } from "./lib/authors";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { ReaderLabels } from "./lib/linkLabels";
import { fail } from "./lib/errors";
import { rewritePage, seenMark, versionBlocks } from "./documents";

/** Notes looked at per list: the most recently opened ones. */
const CANDIDATES = 60;
/** Notes listed at most. */
const MAX_NOTES = 30;
/** Changed lines read per note for the list (more are counted as "and more"). */
const LINES_PER_NOTE = 100;
/** Changed lines read for one note's details, and the most "Undo this change" takes back at once. */
const LINES_PER_DETAIL = 500;

/** Who made changes that weren't the person's own: someone else, or something acting for them. */
const APP: PersonView = { key: "app", name: "A connected app", color: "accent", avatarUrl: null };
const AI: PersonView = { key: "ai", name: "Foli AI", color: "accent", avatarUrl: null };

const byOthers = (profileId: Id<"profiles">) => (b: Doc<"blocks">) => b.updatedBy !== profileId || b.updatedVia !== undefined;

async function actorKey(people: People, me: Id<"profiles">, b: Doc<"blocks">): Promise<string> {
  if (b.updatedBy === me) return b.updatedVia === "ai" ? AI.key : APP.key;
  return (await people.get(b.updatedBy)).key;
}

/** A line's change since the person last looked. A line added and removed since then is no change. */
function kindOf(b: Doc<"blocks">, seenAt: number): "added" | "edited" | "removed" | null {
  const added = b.createdAt > seenAt;
  if (b.deletedAt !== undefined) return added ? null : "removed";
  return added ? "added" : "edited";
}

/** A note's lines changed by others since `seenSeq`, oldest change first. */
async function changedLines(ctx: QueryCtx | MutationCtx, doc: Doc<"documents">, me: Id<"profiles">, seenSeq: number, limit: number) {
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_document_seq", (q) => q.eq("documentId", doc._id).gt("seq", seenSeq))
    .take(limit);
  return { lines: rows.filter(byOthers(me)), more: rows.length === limit };
}

async function seenRow(ctx: QueryCtx | MutationCtx, profileId: Id<"profiles">, documentId: Id<"documents">) {
  return await ctx.db
    .query("recents")
    .withIndex("by_profile_document", (q) => q.eq("profileId", profileId).eq("documentId", documentId))
    .unique();
}

/**
 * Notes with changes the person hasn't seen, newest change first: who made them and how many lines were added,
 * edited or removed. `exclude` is the note open in front of them (it's being seen as it changes).
 */
export const list = query({
  args: { exclude: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("recents")
      .withIndex("by_profile_viewed", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(CANDIDATES);
    const people = new People(ctx);
    const notes = [];
    for (const r of rows) {
      if (r.seenSeq === undefined || r.seenAt === undefined) continue;
      const doc = await ctx.db.get(r.documentId);
      if (!doc || doc.inTrash || doc.publicId === args.exclude) continue;
      const { lines, more } = await changedLines(ctx, doc, profile._id, r.seenSeq, LINES_PER_NOTE);
      const counts = { added: 0, edited: 0, removed: 0 };
      const actors = new Map<string, number>();
      let at = 0;
      for (const b of lines) {
        const kind = kindOf(b, r.seenAt);
        if (!kind) continue;
        counts[kind]++;
        const key = await actorKey(people, profile._id, b);
        actors.set(key, (actors.get(key) ?? 0) + 1);
        at = Math.max(at, b.deletedAt ?? b.updatedAt);
      }
      if (!actors.size) continue;
      // (Checked last: only notes that changed cost the access check.)
      if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
      notes.push({
        id: doc.publicId,
        title: doc.title,
        icon: doc.icon ?? null,
        at,
        since: r.seenAt,
        actors: [...actors.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key),
        ...counts,
        more,
      });
      if (notes.length >= MAX_NOTES) break;
    }
    notes.sort((a, b) => b.at - a.at);
    return { notes, people: { ...(await people.all()), [APP.key]: APP, [AI.key]: AI } };
  },
});

/**
 * One note's unseen changes, for its card in Changes: the changed lines as they are now and, for people who
 * can edit the note, as they were when they last looked (the version then), with who changed each one. People
 * who can only read it get the lines as they are and what kind of change each was, never removed text.
 */
export const note = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) return null;
    const access = await documentAccess(ctx, profile, doc);
    if (!accessAtLeast(access, "read")) return null;
    const row = await seenRow(ctx, profile._id, doc._id);
    if (row?.seenSeq === undefined || row.seenAt === undefined) return null;
    const seenAt = row.seenAt;
    const { lines, more } = await changedLines(ctx, doc, profile._id, row.seenSeq, LINES_PER_DETAIL);
    const canEdit = accessAtLeast(access, "write");
    const base = canEdit && row.seenVersionId ? await ctx.db.get(row.seenVersionId) : null;
    const before = base && base.documentId === doc._id ? await versionBlocks(ctx, base) : null;
    const people = new People(ctx);
    const labels = new ReaderLabels(ctx, profile);
    const authors: [string, string, number][] = [];
    const removed: [string, string, number][] = [];
    const kinds: [string, "added" | "edited" | "removed"][] = [];
    const now: WireBlock[] = [];
    const ids = new Set<string>();
    for (const b of lines) {
      const kind = kindOf(b, seenAt);
      if (!kind) continue;
      ids.add(b.blockId);
      kinds.push([b.blockId, kind]);
      const key = await actorKey(people, profile._id, b);
      if (kind === "removed") removed.push([b.blockId, key, b.deletedAt!]);
      else {
        authors.push([b.blockId, key, b.updatedAt]);
        now.push(toWireBlock(b));
      }
    }
    return {
      blocks: await labels.blocks(now),
      // The changed lines as they were (only from the version saved when they last looked).
      previous: before ? await labels.blocks(before.filter((b) => ids.has(b.id))) : null,
      authors,
      removed: canEdit ? removed : [],
      kinds,
      more,
      canUndo: Boolean(before) && ids.size > 0,
      people: { ...(await people.all()), [APP.key]: APP, [AI.key]: AI },
    };
  },
});

async function markOne(ctx: MutationCtx, profile: Doc<"profiles">, doc: Doc<"documents">, leaving: boolean) {
  const row = await seenRow(ctx, profile._id, doc._id);
  if (!row) return false;
  const access = await documentAccess(ctx, profile, doc);
  if (!accessAtLeast(access, "read")) return false;
  await ctx.db.patch(row._id, { ...(await seenMark(ctx, doc, accessAtLeast(access, "write"))), ...(leaving ? { leftAt: Date.now() } : {}) });
  return true;
}

const MAX_MARK = 50;

/**
 * Marks notes' changes as seen (Changes' "Mark as seen" and "Mark all as seen"). Leaving a note does too
 * (`leaving`), which also ends the visit: the next time it's opened, "Since you were away" starts from here.
 */
export const markSeen = mutation({
  args: { documentIds: v.array(v.string()), leaving: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.documentIds.length > MAX_MARK) fail("limit_exceeded", `At most ${MAX_MARK} notes at a time.`);
    let marked = 0;
    for (const id of new Set(args.documentIds)) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (doc && (await markOne(ctx, profile, doc, Boolean(args.leaving)))) marked++;
    }
    return { marked };
  },
});

/**
 * "Since you were away", for the note being opened: who else changed it between the visit before and this one,
 * and which of its lines they added or changed (people as keys into `people`), with how many they removed.
 * Null on a first visit, and when nobody else changed anything. Lines only as ids: the note is open already.
 */
export const away = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    const row = await seenRow(ctx, profile._id, doc._id);
    if (!row || row.awaySeq === undefined || row.awayAt === undefined || row.seenSeq === undefined || row.awaySeq >= row.seenSeq) return null;
    const { awaySeq, awayAt, seenSeq } = row;
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_document_seq", (q) => q.eq("documentId", doc._id).gt("seq", awaySeq).lte("seq", seenSeq))
      .take(LINES_PER_DETAIL);
    const people = new People(ctx);
    const tally = new Map<string, number>();
    const lines: [string, string, number, "added" | "edited"][] = [];
    let removed = 0;
    for (const b of rows.filter(byOthers(profile._id))) {
      const kind = kindOf(b, awayAt);
      if (!kind) continue;
      const key = await actorKey(people, profile._id, b);
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (kind === "removed") removed++;
      else lines.push([b.blockId, key, b.updatedAt, kind]);
    }
    if (!tally.size) return null;
    const all: Record<string, PersonView> = { ...(await people.all()), [APP.key]: APP, [AI.key]: AI };
    return {
      since: awayAt,
      people: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => all[key]!),
      lines,
      removed,
      more: rows.length === LINES_PER_DETAIL,
    };
  },
});

/** "Dismiss" on "Since you were away": nothing to catch up on in this note until the next visit. */
export const dismissAway = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) return null;
    const row = await seenRow(ctx, profile._id, doc._id);
    if (row && row.seenSeq !== undefined) await ctx.db.patch(row._id, { awaySeq: row.seenSeq, awayAt: row.seenAt });
    return null;
  },
});

/**
 * "Undo this change": the lines others changed since the person last looked go back to how they were then
 * (lines they added are removed, lines they removed come back), and nothing else on the page moves. The page
 * as it is now is saved as a version first, and its id comes back so this can be undone in turn.
 */
export const undo = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const row = await seenRow(ctx, profile._id, doc._id);
    const base = row?.seenVersionId ? await ctx.db.get(row.seenVersionId) : null;
    const before = base && base.documentId === doc._id ? await versionBlocks(ctx, base) : null;
    if (!row || row.seenSeq === undefined || !before) fail("not_found", "The version from when you last looked is gone. Open version history to go back further.");
    const { lines, more } = await changedLines(ctx, doc, profile._id, row.seenSeq, LINES_PER_DETAIL);
    if (more) fail("limit_exceeded", "That's too many changes to undo here. Open version history instead.");
    const was = new Map(before.map((b) => [b.id, b]));
    const page = new Map((await liveBlocks(ctx, doc._id)).map((b) => [b.blockId, toWireBlock(b)]));
    let reverted = 0;
    for (const b of lines) {
      if (!kindOf(b, row.seenAt ?? 0)) continue;
      const old = was.get(b.blockId);
      if (old) page.set(b.blockId, old);
      else page.delete(b.blockId);
      reverted++;
    }
    if (!reverted) return { undoVersionId: null, reverted };
    // A line whose parent is gone now sits at the top level, where it was ranked.
    const blocks = [...page.values()].map((b) => (b.parentId && !page.has(b.parentId) ? { ...b, parentId: null } : b));
    const { undoVersionId } = await rewritePage(ctx, doc, { title: doc.title, icon: doc.icon ?? null, blocks }, profile);
    const fresh = (await ctx.db.get(doc._id))!;
    await ctx.db.patch(row._id, await seenMark(ctx, fresh, true));
    return { undoVersionId, reverted };
  },
});
