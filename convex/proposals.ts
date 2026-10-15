// Proposed changes (Changes, "Proposed"; docs/research/2026-10-14-competitive-analysis.md 9.1): a person can ask
// to review what connected apps change in their existing notes before it happens (Settings > Connected apps,
// profiles.reviewAppEdits). With that on, an app's append to an existing note (MCP append_to_note, REST
// POST /notes/{id}/append) is stored here instead of made, the app is told it's waiting for review, and the
// person hears about it in the bell. Creating notes and tasks stays direct, and so do a task's own changes
// (complete_task, update_task: its checkbox, date, priority or repeat, never the note's text; a version is
// saved first and Changes can undo them).
//
//   list, count: the person's pending proposals (Changes, and its count in the sidebar).
//   accept:      makes the change as the app would have (the sync engine as its device, marked as the app's,
//                a version saved first), added at the end of the note as it is now. Only the person whose app
//                proposed it, while they can still edit the note.
//   reject:      leaves the note as it is.
//   sweep:       hourly, pending proposals past their 14 days expire; decided ones go after 30 days.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { LIMITS, plainText, rankSequence, ulid, type InlineNode, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks } from "./lib/documents";
import { ReaderLabels } from "./lib/linkLabels";
import { SyncEngine } from "./lib/syncEngine";
import { latestBlockSeq, seenMark, snapshot } from "./documents";

/** How long a proposal waits for the person before it expires. */
export const PROPOSAL_TTL = 14 * 24 * 60 * 60_000;
/** Decided and expired proposals are kept this long (then deleted by the sweep). */
const KEEP_DECIDED = 30 * 24 * 60 * 60_000;
/** Pending proposals listed at most. */
const MAX_LISTED = 50;

/** What the app hears when its change waits for review. */
export const PROPOSED_MESSAGE = "Proposed for review; the person will see it in Folevi's Changes page, where they can accept or reject it.";
/** What accepting says when the change can't be made on the note as it is now. */
const CANT_APPLY = "This note changed; the proposal can't be applied.";

export interface ProposalSource {
  source: "app" | "ai";
  name: string;
  grantId?: Id<"mcpGrants">;
  tokenId?: Id<"apiTokens">;
  device: string;
  reason: Doc<"proposals">["reason"];
}

/** "Add 2 lines at the end: “Buy milk…”" */
function summarize(blocks: WireBlock[]): string {
  const top = blocks.filter((b) => b.parentId === null).length || blocks.length;
  const first = blocks.map((b) => plainText((b.text ?? []) as InlineNode[]).trim()).find(Boolean) ?? "";
  const excerpt = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  return `Add ${top} ${top === 1 ? "line" : "lines"} at the end${excerpt ? `: “${excerpt}”` : ""}`;
}

/**
 * Stores an append to `doc` for its person to review, and tells them in the bell. A retried request (the same
 * `requestKey`) finds the proposal it made instead of making another.
 */
export async function proposeAppend(
  ctx: MutationCtx,
  profile: Doc<"profiles">,
  doc: Doc<"documents">,
  blocks: WireBlock[],
  from: ProposalSource,
  requestKey: string,
): Promise<{ proposalId: string; expiresAt: number }> {
  const earlier = await ctx.db
    .query("proposals")
    .withIndex("by_request", (q) => q.eq("requestKey", requestKey))
    .first();
  if (earlier && earlier.profileId === profile._id) return { proposalId: earlier.publicId, expiresAt: earlier.expiresAt };
  const now = Date.now();
  const publicId = ulid();
  const summary = summarize(blocks);
  const id = await ctx.db.insert("proposals", {
    publicId,
    profileId: profile._id,
    documentId: doc._id,
    source: from.source,
    sourceName: from.name.slice(0, 80) || "A connected app",
    ...(from.grantId ? { grantId: from.grantId } : {}),
    ...(from.tokenId ? { tokenId: from.tokenId } : {}),
    device: from.device.slice(0, 64),
    reason: from.reason,
    kind: "append",
    blocks,
    summary,
    requestKey,
    status: "pending",
    createdAt: now,
    expiresAt: now + PROPOSAL_TTL,
  });
  await ctx.db.insert("notifications", {
    profileId: profile._id,
    ...(doc.workspaceId ? { workspaceId: doc.workspaceId } : {}),
    kind: "system",
    documentId: doc._id,
    proposalId: id,
    title: `${from.name.slice(0, 80) || "A connected app"} proposed a change to “${doc.title || "Untitled"}”. Review it in Changes.`,
    body: summary,
    createdAt: now,
  });
  return { proposalId: publicId, expiresAt: now + PROPOSAL_TTL };
}

/** The caller's own proposal (anyone else's is "not found"). */
async function ownProposal(ctx: QueryCtx | MutationCtx, profile: Doc<"profiles">, proposalId: string): Promise<Doc<"proposals">> {
  const row = await ctx.db
    .query("proposals")
    .withIndex("by_public_id", (q) => q.eq("publicId", proposalId))
    .unique();
  if (!row || row.profileId !== profile._id) fail("not_found", "That proposal isn't there anymore.");
  return row;
}

async function pending(ctx: QueryCtx, profileId: Id<"profiles">, now: number, limit: number) {
  const rows = await ctx.db
    .query("proposals")
    .withIndex("by_profile_status", (q) => q.eq("profileId", profileId).eq("status", "pending"))
    .order("desc")
    .take(limit);
  return rows.filter((r) => r.expiresAt > now);
}

/**
 * The caller's pending proposals, newest first: the note, who proposed what, the lines it would add (with link
 * labels as the caller may see them), and whether they can accept it now (or why not). `now` is the client's
 * clock rounded to the minute, so the answer can be cached while expiry is still judged.
 */
export const list = query({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const rows = await pending(ctx, profile._id, args.now ?? 0, MAX_LISTED);
    const labels = new ReaderLabels(ctx, profile);
    const out = [];
    for (const r of rows) {
      const doc = await ctx.db.get(r.documentId);
      const readable = doc && !doc.inTrash && doc.deletedAt === undefined ? await documentAccess(ctx, profile, doc) : "none";
      const canRead = accessAtLeast(readable, "read");
      out.push({
        id: r.publicId,
        documentId: canRead ? doc!.publicId : null,
        title: canRead ? doc!.title || "Untitled" : "A note you can't open",
        source: r.source,
        sourceName: r.sourceName,
        summary: r.summary,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        blocks: canRead ? await labels.blocks(r.blocks as WireBlock[]) : [],
        /** Why it can't be accepted now (it can still be rejected), or null. */
        problem: !doc || doc.inTrash || doc.deletedAt !== undefined ? "This note is gone, so the proposal can't be applied." : !accessAtLeast(readable, "write") ? "You can't edit this note anymore." : null,
      });
    }
    return out;
  },
});

/** How many proposals wait for the caller (Changes' count in the sidebar). */
export const count = query({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    return (await pending(ctx, profile._id, args.now ?? 0, MAX_LISTED)).length;
  },
});

/**
 * Accepts a proposal: its lines are added at the end of the note as it is now, made as the app (its device,
 * marked as the app's in Changes and "Show editors"), with a version saved first so it can be undone. Accepting
 * twice changes nothing more. When the note can't take it (gone, too long, or the change is refused), it says
 * so and the proposal stays, to reject.
 */
export const accept = mutation({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await ownProposal(ctx, profile, args.proposalId);
    if (row.status === "accepted") return { status: "accepted" as const, documentId: (await ctx.db.get(row.documentId))?.publicId ?? null };
    if (row.status === "rejected") fail("invalid_argument", "This proposal was rejected.");
    if (row.status === "expired" || row.expiresAt <= Date.now()) fail("invalid_argument", "This proposal has expired.");
    const doc = await ctx.db.get(row.documentId);
    if (!doc || doc.inTrash || doc.deletedAt !== undefined) fail("conflict", CANT_APPLY);
    if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can't edit this note anymore.");
    const rows = await liveBlocks(ctx, doc._id);
    const blocks = (row.blocks as WireBlock[]).map((b) => ({ ...b }));
    // Placed at the end of the note as it is now, whatever happened to it since.
    const have = new Set(rows.map((r) => r.blockId));
    if (blocks.some((b) => have.has(b.id))) fail("conflict", CANT_APPLY);
    if (rows.length + blocks.length > LIMITS.maxBlocksPerDocument) fail("conflict", CANT_APPLY);
    const last = rows.filter((r) => r.parentId === null).reduce<string | null>((m, r) => (m === null || r.rank > m ? r.rank : m), null);
    const top = blocks.filter((b) => b.parentId === null);
    const ranks = rankSequence(top.length, last, null);
    top.forEach((b, i) => (b.rank = ranks[i]!));

    // Seen up to now (nothing else new in it): what they accept doesn't come back as a change to look at.
    const recent = await ctx.db
      .query("recents")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .unique();
    const caughtUp = recent?.seenSeq !== undefined && recent.seenSeq >= (await latestBlockSeq(ctx, doc._id));

    await snapshot(ctx, doc, profile._id, row.reason);
    const ops: SyncOp[] = blocks.map((b, i) => ({ opId: `prop${row.publicId.slice(0, 20)}${i.toString(36).padStart(4, "0")}`, kind: "block.upsert", documentId: doc.publicId, block: b, baseRevision: null, fields: ["content", "position"] }));
    const results = await new SyncEngine(ctx, profile, row.device, row.source === "ai" ? "ai" : "app").applyAll(null, ops);
    if (results.some((r) => r.status === "rejected" || r.status === "conflict")) fail("conflict", CANT_APPLY);
    await ctx.db.patch(row._id, { status: "accepted", decidedAt: Date.now() });
    if (caughtUp && recent) {
      const fresh = (await ctx.db.get(doc._id))!;
      await ctx.db.patch(recent._id, await seenMark(ctx, fresh, true));
    }
    return { status: "accepted" as const, documentId: doc.publicId };
  },
});

/** Rejects a proposal: the note stays as it is. Rejecting twice is fine; an accepted one can't be. */
export const reject = mutation({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await ownProposal(ctx, profile, args.proposalId);
    if (row.status === "accepted") fail("invalid_argument", "This proposal was already accepted. Undo it from the note's version history.");
    if (row.status === "pending") await ctx.db.patch(row._id, { status: "rejected", decidedAt: Date.now() });
    return null;
  },
});

/** Pending proposals past their time expire; decided ones are deleted a while later (hourly). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("proposals")
      .withIndex("by_status_expires", (q) => q.eq("status", "pending").lte("expiresAt", now))
      .take(200);
    for (const r of due) await ctx.db.patch(r._id, { status: "expired", decidedAt: now });
    let removed = 0;
    for (const status of ["accepted", "rejected", "expired"] as const) {
      const old = await ctx.db
        .query("proposals")
        .withIndex("by_status_expires", (q) => q.eq("status", status).lte("expiresAt", now - KEEP_DECIDED))
        .take(200);
      for (const r of old) {
        await ctx.db.delete(r._id);
        removed++;
      }
    }
    return { expired: due.length, removed };
  },
});
