// Removing the plaintext the server derived from a note once the note is sealed (docs/E2EE_DESIGN.md §5.5).
//
// Two parts, because some copies are found by the note and some only by the people who saw it:
//
//   purgeDerivedPlaintext(ctx, doc)   everything indexed by the note: its own derived columns (placeholders),
//                                      search and AI rows, tasks, study cards, backlinks it makes, found text,
//                                      collections it hosts or is a row of, pending proposals and webhook
//                                      events. Run by e2ee.migrate.finishDocument in the same mutation that
//                                      sets `sealedAt`, so the note is never sealed and readable at once.
//   purgeCopiesInScope(ctx, scope, …)  copies kept per person: notifications, webhook deliveries, MCP and REST
//                                      results, Foli AI chats' references. Paged per person of the space; the
//                                      seal migration's cleanup phase runs it once for the whole space, a lock
//                                      of one note runs it for that note's people right away.
//
// Both only ever delete rows or blank fields, never write content. Standard notes never come here.
import type { Doc, Id, TableNames } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE } from "@folevi/editor-schema";
import type { Scope } from "../scope";

/** Rows deleted per table per call; a note with more is finished by the next call (the caller loops). */
const PER_TABLE = 2000;

/** The plaintext columns of a sealed note: what the server keeps in place of its title and derived text. */
export const SEALED_DOCUMENT_PLACEHOLDERS = {
  title: "",
  icon: undefined,
  cover: DEFAULT_COVER,
  style: DEFAULT_DOCUMENT_STYLE,
  searchText: "",
  excerpt: "",
  preview: undefined,
  wordCount: 0,
  charCount: 0,
  templateKey: undefined,
  collectionId: undefined,
} satisfies Partial<Doc<"documents">>;

/** The generic text a notification about a sealed note shows (§7.7, "without previews"). */
export function genericNotificationTitle(kind: Doc<"notifications">["kind"], actorName: string | null): string {
  const who = actorName || "Someone";
  switch (kind) {
    case "mention":
      return `${who} mentioned you in a note`;
    case "comment":
      return `${who} commented on a note`;
    case "reply":
      return `${who} replied to your comment`;
    case "share":
    case "share_change":
      return `${who} shared a note with you`;
    case "invite":
      return `${who} invited you`;
    case "system":
      return "A reminder is due";
  }
}

export interface PurgeResult {
  /** True when every table was emptied of the note's rows; false: call again (more than PER_TABLE rows). */
  done: boolean;
  deleted: number;
}

/**
 * Removes what the server derived from `doc`'s plaintext (§5.5). Call it in the mutation that seals the note,
 * after the device's sealed records (collections, found text) are written. Idempotent.
 */
export async function purgeDerivedPlaintext(ctx: MutationCtx, doc: Doc<"documents">): Promise<PurgeResult> {
  let deleted = 0;
  let done = true;
  const drop = async (rows: { _id: Id<TableNames> }[]) => {
    if (rows.length >= PER_TABLE) done = false;
    for (const r of rows) await ctx.db.delete(r._id);
    deleted += rows.length;
  };
  const id = doc._id;

  // The note's own columns: placeholders. `blockCount` stays (the server enforces the limit on blocks per
  // note, and the number of blocks is visible metadata, §3.2).
  await ctx.db.patch(id, SEALED_DOCUMENT_PLACEHOLDERS);

  // Search and Foli AI.
  await drop(await ctx.db.query("aiChunks").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("aiIndexState").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("aiMentions").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("aiRelations").withIndex("by_source", (q) => q.eq("sourceDocumentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("aiRelations").withIndex("by_to_document", (q) => q.eq("toDocumentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("aiGraphState").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("documentEdits").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));

  // Projections devices now make themselves.
  await drop(await ctx.db.query("tasks").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("studyCards").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE));
  await drop(await ctx.db.query("documentLinks").withIndex("by_source", (q) => q.eq("sourceDocumentId", id)).take(PER_TABLE));
  // Found text: its sealed copies are `fileText` records.
  await drop(await ctx.db.query("fileTexts").withIndex("by_document_block", (q) => q.eq("documentId", id)).take(PER_TABLE));

  // Collections it hosts (their definitions are now `collection` records) and the row it is of (its values
  // are now in its sealed meta).
  for (const c of await ctx.db.query("collections").withIndex("by_document", (q) => q.eq("documentId", id)).take(50)) {
    if (!(await dropCollection(ctx, c._id))) done = false;
    deleted++;
  }
  for (const row of await ctx.db.query("collectionRows").withIndex("by_document", (q) => q.eq("documentId", id)).take(50)) {
    await drop(await ctx.db.query("collectionValues").withIndex("by_row", (q) => q.eq("rowId", row._id)).take(PER_TABLE));
    await ctx.db.delete(row._id);
    deleted++;
  }

  // Changes an app proposed for it (their blocks are plaintext): they expire.
  for (const p of await ctx.db.query("proposals").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE)) {
    if (p.status !== "pending") continue;
    await ctx.db.patch(p._id, { status: "expired", blocks: [], summary: "", decidedAt: Date.now() });
  }

  // Its notifications (everyone's bell): the generic text of their kind, no body (§5.5, §7.7).
  const actors = new Map<Id<"profiles">, string | null>();
  for (const n of await ctx.db.query("notifications").withIndex("by_document", (q) => q.eq("documentId", id)).take(PER_TABLE)) {
    if (n.sealedDocument) continue;
    if (n.actorId && !actors.has(n.actorId)) actors.set(n.actorId, (await ctx.db.get(n.actorId))?.displayName ?? null);
    await ctx.db.patch(n._id, { title: genericNotificationTitle(n.kind, n.actorId ? (actors.get(n.actorId) ?? null) : null), body: undefined, sealedDocument: true });
  }

  // Webhook events still waiting to fan out (the outbox is small; webhooks.fanout empties it).
  for (const e of await ctx.db.query("webhookEvents").take(PER_TABLE)) {
    if (e.documentId === id) {
      await ctx.db.delete(e._id);
      deleted++;
    }
  }
  return { done, deleted };
}

/** Deletes a server collection and everything in it. True when it was emptied in this call. */
async function dropCollection(ctx: MutationCtx, collectionId: Id<"collections">): Promise<boolean> {
  let budget = PER_TABLE;
  const rows = await ctx.db.query("collectionRows").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).take(PER_TABLE);
  for (const row of rows) {
    const values = await ctx.db.query("collectionValues").withIndex("by_row", (q) => q.eq("rowId", row._id)).take(PER_TABLE);
    for (const value of values) await ctx.db.delete(value._id);
    budget -= values.length;
    // The row note itself stays: it is a note of its own; only its membership in this collection goes.
    await ctx.db.delete(row._id);
    if (budget <= 0) return false;
  }
  if (rows.length >= PER_TABLE) return false;
  for (const p of await ctx.db.query("collectionProperties").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).collect()) await ctx.db.delete(p._id);
  for (const v of await ctx.db.query("collectionViews").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).collect()) await ctx.db.delete(v._id);
  await ctx.db.delete(collectionId);
  return true;
}

export interface CopiesCursor {
  /** Index into the person list (`peopleOf`) the sweep has reached. */
  person: number;
}

/**
 * Blanks per-person copies that mention sealed notes of `scope` (§5.5 rows for notifications, webhook
 * deliveries, MCP events, API requests and Foli AI chats). `sealed` is the set of the notes' ids to clean
 * for; when omitted every note of the scope that is sealed now counts. Pass `people` to limit the sweep (a
 * lock of one note: its owner and the people it is shared with). Returns the next cursor, or null when done.
 */
export async function purgeCopiesInScope(
  ctx: MutationCtx,
  scope: Scope,
  opts: { cursor?: CopiesCursor | null; sealed?: Set<Id<"documents">>; people?: Id<"profiles">[]; peoplePerCall?: number } = {},
): Promise<CopiesCursor | null> {
  const people = opts.people ?? (await peopleOf(ctx, scope));
  const start = opts.cursor?.person ?? 0;
  const end = Math.min(people.length, start + (opts.peoplePerCall ?? 10));
  const sealedDoc = new Map<Id<"documents">, boolean>();
  const isSealedId = async (docId: Id<"documents"> | undefined): Promise<boolean> => {
    if (!docId) return false;
    if (opts.sealed) return opts.sealed.has(docId);
    let s = sealedDoc.get(docId);
    if (s === undefined) {
      const d = await ctx.db.get(docId);
      s = d !== null && d.sealedAt !== undefined;
      sealedDoc.set(docId, s);
    }
    return s;
  };
  // Public ids of the sealed notes, to find them inside stored strings (results, bodies, payloads).
  const publicIds = new Set<string>();
  const sealedPublic = async (): Promise<Set<string>> => {
    if (publicIds.size || !opts.sealed) return publicIds;
    for (const id of opts.sealed) {
      const d = await ctx.db.get(id);
      if (d) publicIds.add(d.publicId);
    }
    return publicIds;
  };
  const mentionsSealed = async (text: string | undefined): Promise<boolean> => {
    if (!text) return false;
    if (opts.sealed) {
      for (const p of await sealedPublic()) if (text.includes(p)) return true;
      return false;
    }
    // Without a list: any 26-character id in the text that names a sealed note of this scope.
    for (const m of text.match(/[0-9A-HJKMNP-TV-Z]{26}/g) ?? []) {
      const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", m)).unique();
      if (d && d.sealedAt !== undefined) return true;
    }
    return false;
  };
  const actorNames = new Map<Id<"profiles">, string | null>();
  const actorName = async (id: Id<"profiles"> | undefined): Promise<string | null> => {
    if (!id) return null;
    if (!actorNames.has(id)) actorNames.set(id, (await ctx.db.get(id))?.displayName ?? null);
    return actorNames.get(id) ?? null;
  };

  await sealedPublic();
  for (let i = start; i < end; i++) {
    const profileId = people[i]!;
    for (const n of await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", profileId)).take(PER_TABLE)) {
      if (n.sealedDocument || !(await isSealedId(n.documentId))) continue;
      await ctx.db.patch(n._id, { title: genericNotificationTitle(n.kind, await actorName(n.actorId)), body: undefined, sealedDocument: true });
    }
    for (const e of await ctx.db.query("mcpEvents").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(PER_TABLE)) {
      if (e.result === undefined) continue;
      if (e.targets.some((t) => publicIds.has(t)) || (await mentionsSealed(e.result))) await ctx.db.patch(e._id, { result: undefined });
    }
    for (const r of await ctx.db.query("apiRequests").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(PER_TABLE)) {
      if (r.body && (await mentionsSealed(r.body))) await ctx.db.patch(r._id, { body: "" });
    }
    for (const d of await ctx.db.query("webhookDeliveries").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(PER_TABLE)) {
      if (d.status !== "pending" || !(await mentionsSealed(d.payload))) continue;
      await ctx.db.patch(d._id, { payload: "", status: "failed", updatedAt: Date.now() });
    }
  }
  // Foli AI chats in the scope that name sealed notes: the references go (titles in messages stay, §13).
  if (start === 0) {
    const chats = await (
      scope.kind === "personal"
        ? ctx.db.query("aiConversations").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
        : ctx.db.query("aiConversations").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
    ).take(PER_TABLE);
    for (const c of chats) {
      if (!c.noteRefs?.length) continue;
      const keep: string[] = [];
      for (const ref of c.noteRefs) {
        const d = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", ref)).unique();
        const sealedNow = d !== null && (opts.sealed ? opts.sealed.has(d._id) : d.sealedAt !== undefined);
        if (!sealedNow) keep.push(ref);
      }
      if (keep.length !== c.noteRefs.length) await ctx.db.patch(c._id, { noteRefs: keep });
    }
  }
  return end < people.length ? { person: end } : null;
}

/** The people who may hold per-person copies about a scope's notes: its owner or members, and its guests. */
export async function peopleOf(ctx: MutationCtx, scope: Scope): Promise<Id<"profiles">[]> {
  const out = new Set<Id<"profiles">>();
  if (scope.kind === "personal") out.add(scope.profileId);
  else for (const m of await ctx.db.query("workspaceMembers").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId)).take(5000)) out.add(m.profileId);
  const grants = await (
    scope.kind === "personal"
      ? ctx.db.query("documentPermissions").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
      : ctx.db.query("documentPermissions").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
  ).take(5000);
  for (const g of grants) out.add(g.profileId);
  return [...out].sort();
}

/** The people of one note: its scope's owner (Personal) or nobody else by default, plus its guests. */
export async function peopleOfDocument(ctx: MutationCtx, doc: Doc<"documents">): Promise<Id<"profiles">[]> {
  const out = new Set<Id<"profiles">>();
  if (doc.ownerProfileId) out.add(doc.ownerProfileId);
  out.add(doc.createdBy);
  out.add(doc.lastEditedBy);
  for (const g of await ctx.db.query("documentPermissions").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(500)) out.add(g.profileId);
  return [...out].sort();
}
