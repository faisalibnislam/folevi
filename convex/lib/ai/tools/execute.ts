// Carrying out an approved agent run, and undoing it (convex/aiAgent.ts runs these in mutations, one batch
// of operations at a time). Every operation is checked again first, as the person: they can still edit the
// note, it's still there, the blocks it edits haven't changed since the preview. A version of each note is
// saved before its first change (documentSnapshots "ai_run"), notes change through the sync engine (tasks,
// links, search and history stay right) with operation ids made from the operation's own id, and what Undo
// needs is recorded on the operation. Anything that doesn't fit fails that operation with a plain reason.
import type { Doc } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { flattenTree, LIMITS, markdownToBlocks, normalizeForSearch, rankBetween, rankSequence, SCHEMA_VERSION, ulid, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, documentAccessInfo, getDocumentByPublicId } from "../../auth";
import { fail } from "../../errors";
import { liveBlocks, toWireBlock } from "../../documents";
import { cloneBlocks, createDocument } from "../../create";
import { nextSeq } from "../../seq";
import { insertScoped, inScope, type Scope } from "../../scope";
import { randomFolderColor } from "../../folderColors";
import { SyncEngine, MAX_BATCH } from "../../syncEngine";
import { restoreDoc, restoreVersion, setTrashState, snapshot } from "../../../documents";
import { changesNote, q, type AgentOp, type RunNote } from "./ops";
import { requireCreate, writableNote } from "./propose";
import { scopeFolders } from "./read";

export interface ExecEnv {
  profile: Doc<"profiles">;
  scope: Scope;
}

/** The sync engine's device for the agent's changes (the sync log tells them apart). */
const DEVICE = "ai-agent";
const TAG_COLORS = ["accent", "moss", "marigold", "plum", "coral"];

const CHANGED = (title: string) => `${q(title)} changed after this was proposed, so it wasn't changed. Ask again to get a fresh proposal.`;

/** Applies sync operations as the person; anything the engine refuses or finds in conflict fails the whole operation. */
async function sync(ctx: MutationCtx, env: ExecEnv, ops: SyncOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += MAX_BATCH) {
    const engine = new SyncEngine(ctx, env.profile, DEVICE);
    const results = await engine.applyAll(null, ops.slice(i, i + MAX_BATCH));
    const bad = results.find((r) => r.status === "rejected" || r.status === "conflict");
    if (bad) fail("conflict", bad.error?.message && bad.status === "rejected" ? bad.error.message : "The note changed while this was being applied. Nothing was changed.");
  }
}

/** New blocks from Markdown, their top-level ones placed under `parentId` between two ranks. */
function blocksFrom(markdown: string, parentId: string | null, after: string | null, before: string | null): WireBlock[] {
  const { blocks } = markdownToBlocks(markdown, { titleFromHeading: false });
  const top = blocks.filter((b) => b.parentId === null);
  const ranks = rankSequence(top.length, after, before);
  top.forEach((b, i) => {
    b.parentId = parentId;
    b.rank = ranks[i]!;
  });
  return blocks;
}

const upsert = (opId: string, documentId: string, block: WireBlock, baseRevision: number | null = null): SyncOp => ({
  opId,
  kind: "block.upsert",
  documentId,
  block,
  baseRevision,
  fields: baseRevision === null ? ["content", "position"] : ["content"],
});

/** The rank of the block after `row` among its siblings (null: it's the last). */
function nextSiblingRank(rows: Doc<"blocks">[], row: Pick<Doc<"blocks">, "parentId" | "rank">): string | null {
  let next: string | null = null;
  for (const r of rows) if (r.parentId === row.parentId && r.rank > row.rank && (next === null || r.rank < next)) next = r.rank;
  return next;
}

const lastRootRank = (rows: Doc<"blocks">[]) => rows.filter((r) => r.parentId === null).reduce<string | null>((m, r) => (m === null || r.rank > m ? r.rank : m), null);
const firstRootRank = (rows: Doc<"blocks">[]) => rows.filter((r) => r.parentId === null).reduce<string | null>((m, r) => (m === null || r.rank < m ? r.rank : m), null);

/** Blocks added to the end of a note. */
async function appendBlocks(ctx: MutationCtx, env: ExecEnv, op: AgentOp, doc: Doc<"documents">, blocks: WireBlock[]): Promise<void> {
  const rows = await liveBlocks(ctx, doc._id);
  if (rows.length + blocks.length > LIMITS.maxBlocksPerDocument) fail("limit_exceeded", `${q(doc.title)} would have too many blocks.`);
  const top = blocks.filter((b) => b.parentId === null);
  const ranks = rankSequence(top.length, lastRootRank(rows), null);
  top.forEach((b, i) => (b.rank = ranks[i]!));
  await sync(ctx, env, blocks.map((b, i) => upsert(`${op.id}.${i}`, doc.publicId, b)));
}

/** A to-do block (a task once saved: tasks are made from to-dos). */
function todo(text: string, dueDate?: string): WireBlock {
  return { id: ulid(), type: "todo", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: { checked: false, ...(dueDate ? { dueDate } : {}) } };
}

function heading(text: string, level = 2): WireBlock {
  return { id: ulid(), type: "heading", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { level } };
}

/** The folder a new or moved note goes into: an existing one, one this run made, or none. */
async function targetFolder(ctx: MutationCtx, env: ExecEnv, op: AgentOp, ops: AgentOp[]): Promise<Doc<"folders"> | null> {
  let publicId: string | null | undefined = op.folderId;
  if (op.folderOp) {
    const made = ops.find((o) => o.id === op.folderOp);
    if (!made || made.status !== "applied" || !made.result?.folderId) fail("not_found", `The folder ${q(op.folderName ?? "")} wasn't made, so this wasn't done.`);
    publicId = made.result.folderId;
  }
  if (!publicId) return null;
  const folder = await ctx.db
    .query("folders")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (!folder || folder.deletedAt || !inScope(folder, env.scope)) fail("not_found", `The folder ${q(op.folderName ?? "")} isn't there anymore.`);
  return folder;
}

/** Saves a version of a note before the run first changes it, and remembers it for Undo. */
async function beforeChange(ctx: MutationCtx, env: ExecEnv, doc: Doc<"documents">, notes: RunNote[]): Promise<void> {
  if (notes.some((n) => n.noteId === doc.publicId)) return;
  const saved = await snapshot(ctx, doc, env.profile._id, "ai_run");
  notes.push({ noteId: doc.publicId, title: doc.title || "Untitled", snapshotId: saved.id!, contentSeqAfter: doc.contentSeq, titleAfter: doc.title });
}

/** Records how a note was left after a change (Undo compares it with how it is then). */
async function afterChange(ctx: MutationCtx, doc: Doc<"documents">, notes: RunNote[]): Promise<void> {
  const fresh = (await ctx.db.get(doc._id))!;
  const n = notes.find((x) => x.noteId === doc.publicId);
  if (n) {
    n.contentSeqAfter = fresh.contentSeq;
    n.titleAfter = fresh.title;
  }
}

/** The note an operation changes, checked again now: it's here, they can edit it, and it hasn't changed. */
async function noteNow(ctx: MutationCtx, env: ExecEnv, op: AgentOp): Promise<Doc<"documents">> {
  const doc = await writableNote(ctx, env.profile, env.scope, op.noteId ?? "");
  if (op.fromTitle !== undefined && doc.title !== op.fromTitle) fail("conflict", CHANGED(op.fromTitle));
  return doc;
}

async function newNote(ctx: MutationCtx, env: ExecEnv, op: AgentOp, ops: AgentOp[], title: string, blocks: WireBlock[]): Promise<AgentOp["result"]> {
  await requireCreate(ctx, env.profile, env.scope);
  const folder = await targetFolder(ctx, env, op, ops);
  if (blocks.length > LIMITS.maxBlocksPerDocument) fail("limit_exceeded", "That note would be too long.");
  const doc = await createDocument(ctx, { scope: env.scope, actor: env.profile, title, folderId: folder?._id, blocks });
  return { noteId: doc.publicId, title: doc.title || "Untitled", contentSeq: doc.contentSeq };
}

/**
 * A note's blocks copied for a merge (fresh ids, same tree). Database blocks stay behind: their table
 * belongs to the note they're in, which goes to Trash.
 */
function cloneBlocksForMerge(blocks: WireBlock[]): WireBlock[] {
  const dropped = new Set(blocks.filter((b) => b.type === "collection").map((b) => b.id));
  const kept = blocks.filter((b) => !dropped.has(b.id) && !(b.parentId && dropped.has(b.parentId)));
  // In reading order, so the copy's top-level blocks keep their order when appended.
  return cloneBlocks(flattenTree(kept).map((e) => e.block));
}

/** The files blocks show (images, attachments, audio). */
function fileIdsOf(blocks: WireBlock[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    const id = (b.props as { fileId?: unknown }).fileId;
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}

/**
 * A file belongs to one note (`files.documentId`): readers of that note may open it, and it's deleted
 * when that note is purged. Files the merged blocks show move to the target with them, so emptying
 * Trash of the source later never takes them away (Undo moves them back).
 */
async function moveFiles(ctx: MutationCtx, from: Doc<"documents">, to: Doc<"documents">, fileIds: Set<string>): Promise<{ fileId: string; from: string }[]> {
  if (!fileIds.size) return [];
  const rows = await ctx.db
    .query("files")
    .withIndex("by_document", (q) => q.eq("documentId", from._id))
    .take(500);
  const moved: { fileId: string; from: string }[] = [];
  for (const f of rows) {
    if (!fileIds.has(f.publicId)) continue;
    await ctx.db.patch(f._id, { documentId: to._id });
    moved.push({ fileId: f.publicId, from: from.publicId });
  }
  return moved;
}

function topLevel(blocks: WireBlock[]): WireBlock[] {
  const ranks = rankSequence(blocks.length);
  blocks.forEach((b, i) => (b.rank = ranks[i]!));
  return blocks;
}

/**
 * Carries out one approved operation. Returns what it did (for the report and Undo); throws (a plain
 * reason) when it can't, and then nothing of it happened (the mutation rolls back).
 */
export async function executeOp(ctx: MutationCtx, env: ExecEnv, op: AgentOp, ops: AgentOp[], notes: RunNote[]): Promise<NonNullable<AgentOp["result"]>> {
  switch (op.kind) {
    case "create_folder": {
      await requireCreate(ctx, env.profile, env.scope);
      const name = op.folderName ?? "";
      const folders = await scopeFolders(ctx, env.scope);
      const existing = folders.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
      // Made meanwhile (by hand, or another run): use it, and Undo leaves it alone.
      if (existing) return { folderId: existing.publicId, title: existing.name, created: false };
      const publicId = ulid();
      const now = Date.now();
      await insertScoped(ctx, "folders", env.scope, {
        publicId,
        name,
        color: randomFolderColor(),
        rank: rankBetween(folders.map((f) => f.rank).sort().pop() ?? null, null),
        createdBy: env.profile._id,
        createdAt: now,
        updatedAt: now,
        seq: await nextSeq(ctx, env.scope),
      });
      return { folderId: publicId, title: name, created: true };
    }

    case "create_note":
      return (await newNote(ctx, env, op, ops, op.title ?? "Untitled", markdownToBlocks(op.markdown ?? "", { titleFromHeading: false }).blocks))!;

    case "create_checklist":
    case "create_tasks": {
      const items = (op.items ?? []).map((i) => todo(i.text, i.dueDate));
      if (!op.noteId) return (await newNote(ctx, env, op, ops, op.title ?? "Tasks", topLevel(items)))!;
      const doc = await noteNow(ctx, env, op);
      await beforeChange(ctx, env, doc, notes);
      await appendBlocks(ctx, env, op, doc, [...(op.kind === "create_checklist" && op.title ? [heading(op.title, 3)] : []), ...items]);
      await afterChange(ctx, doc, notes);
      return { noteId: doc.publicId, title: doc.title || "Untitled" };
    }

    case "append_to_note": {
      const doc = await noteNow(ctx, env, op);
      await beforeChange(ctx, env, doc, notes);
      await appendBlocks(ctx, env, op, doc, markdownToBlocks(op.markdown ?? "", { titleFromHeading: false }).blocks);
      await afterChange(ctx, doc, notes);
      return { noteId: doc.publicId, title: doc.title || "Untitled" };
    }

    case "update_note": {
      const doc = await noteNow(ctx, env, op);
      const rows = await liveBlocks(ctx, doc._id);
      const byId = new Map(rows.map((r) => [r.blockId, r]));
      // Checked before anything changes: every block it edits is still there, as it was.
      for (const e of op.edits ?? []) {
        if (e.action === "insert") {
          if (e.afterBlockId && !byId.has(e.afterBlockId)) fail("conflict", CHANGED(doc.title));
          continue;
        }
        const row = byId.get(e.blockId ?? "");
        if (!row || row.contentRev !== e.baseRev) fail("conflict", CHANGED(doc.title));
      }
      await beforeChange(ctx, env, doc, notes);
      const syncOps: SyncOp[] = [];
      const deletes: SyncOp[] = [];
      // Where the next blocks after an anchor go (several inserts after one block keep their order).
      const cursor = new Map<string, string>();
      const place = (anchor: Doc<"blocks"> | null) => {
        const key = anchor?.blockId ?? "";
        const after = cursor.get(key) ?? anchor?.rank ?? null;
        const before = anchor ? nextSiblingRank(rows, anchor) : firstRootRank(rows);
        return { parentId: anchor?.parentId ?? null, after, before, key };
      };
      let n = 0;
      const id = () => `${op.id}.${n++}`;
      for (const e of op.edits ?? []) {
        if (e.action === "delete") {
          deletes.push({ opId: id(), kind: "block.delete", documentId: doc.publicId, blockId: e.blockId!, baseRevision: null });
          continue;
        }
        const anchor = e.action === "replace" ? byId.get(e.blockId!)! : e.afterBlockId ? byId.get(e.afterBlockId)! : null;
        const spot = place(anchor);
        const fresh = blocksFrom(e.markdown ?? "", spot.parentId, spot.after, spot.before);
        if (e.action === "replace") {
          // The first new block takes the old one's place (and id); the rest follow it.
          const first = fresh.find((b) => b.parentId === spot.parentId);
          if (!first) continue;
          for (const b of fresh) if (b.parentId === first.id) b.parentId = anchor!.blockId;
          syncOps.push(upsert(id(), doc.publicId, { ...first, id: anchor!.blockId, parentId: anchor!.parentId, rank: anchor!.rank }, anchor!.revision));
          for (const b of fresh) if (b !== first) syncOps.push(upsert(id(), doc.publicId, b));
          const rest = fresh.filter((b) => b !== first && b.parentId === spot.parentId);
          if (rest.length) cursor.set(spot.key, rest[rest.length - 1]!.rank);
        } else {
          for (const b of fresh) syncOps.push(upsert(id(), doc.publicId, b));
          const top = fresh.filter((b) => b.parentId === spot.parentId);
          if (top.length) cursor.set(spot.key, top[top.length - 1]!.rank);
        }
      }
      if (rows.length + syncOps.length > LIMITS.maxBlocksPerDocument) fail("limit_exceeded", `${q(doc.title)} would have too many blocks.`);
      await sync(ctx, env, [...syncOps, ...deletes]);
      await afterChange(ctx, doc, notes);
      return { noteId: doc.publicId, title: doc.title || "Untitled" };
    }

    case "rename_note": {
      const doc = await noteNow(ctx, env, op);
      await beforeChange(ctx, env, doc, notes);
      await sync(ctx, env, [{ opId: `${op.id}.0`, kind: "document.update", documentId: doc.publicId, patch: { title: op.title ?? doc.title }, baseRevision: doc.revision }]);
      await afterChange(ctx, doc, notes);
      return { noteId: doc.publicId, title: op.title };
    }

    case "move_note": {
      const doc = await noteNow(ctx, env, op);
      if (!(await documentAccessInfo(ctx, env.profile, doc)).inScope) fail("forbidden", "Only members can file notes here.");
      const folder = await targetFolder(ctx, env, op, ops);
      const from = doc.folderId ? await ctx.db.get(doc.folderId) : null;
      const movedFrom = from && !from.deletedAt ? from.publicId : null;
      await sync(ctx, env, [{ opId: `${op.id}.0`, kind: "document.update", documentId: doc.publicId, patch: { folderId: folder?.publicId ?? null }, baseRevision: doc.revision }]);
      return { noteId: doc.publicId, title: doc.title || "Untitled", folderId: folder?.publicId, movedFrom };
    }

    case "add_tags": {
      const doc = await noteNow(ctx, env, op);
      if (!(await documentAccessInfo(ctx, env.profile, doc)).inScope) fail("forbidden", "Only members can tag notes here.");
      const links = await ctx.db
        .query("documentTags")
        .withIndex("by_document", (q) => q.eq("documentId", doc._id))
        .take(200);
      const tagIds: string[] = [];
      const createdTagIds: string[] = [];
      for (const name of op.tags ?? []) {
        const normalizedName = normalizeForSearch(name);
        const s = env.scope;
        let tag = await (
          s.kind === "personal"
            ? ctx.db.query("tags").withIndex("by_owner_name", (q) => q.eq("ownerProfileId", s.profileId).eq("normalizedName", normalizedName))
            : ctx.db.query("tags").withIndex("by_workspace_name", (q) => q.eq("workspaceId", s.workspaceId).eq("normalizedName", normalizedName))
        ).first();
        if (!tag) {
          const publicId = ulid();
          const id = await insertScoped(ctx, "tags", s, { publicId, name, normalizedName, color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]!, createdAt: Date.now(), seq: await nextSeq(ctx, s) });
          tag = (await ctx.db.get(id))!;
          createdTagIds.push(publicId);
        }
        if (links.some((l) => l.tagId === tag!._id)) continue;
        await insertScoped(ctx, "documentTags", s, { documentId: doc._id, tagId: tag._id });
        tagIds.push(tag.publicId);
      }
      await ctx.db.patch(doc._id, { seq: await nextSeq(ctx, env.scope), updatedAt: Date.now() });
      return { noteId: doc.publicId, title: doc.title || "Untitled", tagIds, createdTagIds };
    }

    case "merge_notes": {
      const target = await noteNow(ctx, env, op);
      const sources: Doc<"documents">[] = [];
      for (const s of op.sources ?? []) sources.push(await writableNote(ctx, env.profile, env.scope, s.id));
      await beforeChange(ctx, env, target, notes);
      const blocks: WireBlock[] = [];
      const movedFiles: { fileId: string; from: string }[] = [];
      for (const s of sources) {
        const copied = cloneBlocksForMerge((await liveBlocks(ctx, s._id)).map(toWireBlock));
        blocks.push(heading(s.title || "Untitled"), ...copied);
        movedFiles.push(...(await moveFiles(ctx, s, target, fileIdsOf(copied))));
      }
      await appendBlocks(ctx, env, op, target, blocks);
      for (const s of sources) await setTrashState(ctx, s, env.profile._id, true, Date.now());
      await afterChange(ctx, target, notes);
      return { noteId: target.publicId, title: target.title || "Untitled", trashed: sources.map((s) => s.publicId), movedFiles };
    }
  }
}

/** Whether an applied operation did what it said (read back after the run). */
export async function verifyOp(ctx: QueryCtx, op: AgentOp): Promise<boolean> {
  const r = op.result;
  if (!r) return false;
  const note = r.noteId ? await getDocumentByPublicId(ctx, r.noteId) : null;
  switch (op.kind) {
    case "create_folder": {
      const f = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", r.folderId ?? ""))
        .unique();
      return Boolean(f && !f.deletedAt);
    }
    case "rename_note":
      return Boolean(note && note.title === op.title);
    case "move_note": {
      const f = note?.folderId ? await ctx.db.get(note.folderId) : null;
      return Boolean(note) && (f?.publicId ?? undefined) === (r.folderId ?? undefined);
    }
    case "add_tags": {
      if (!note) return false;
      const links = await ctx.db
        .query("documentTags")
        .withIndex("by_document", (q) => q.eq("documentId", note._id))
        .take(200);
      for (const id of r.tagIds ?? []) {
        const tag = await ctx.db
          .query("tags")
          .withIndex("by_public_id", (q) => q.eq("publicId", id))
          .unique();
        if (!tag || !links.some((l) => l.tagId === tag._id)) return false;
      }
      return true;
    }
    case "merge_notes": {
      if (!note || note.inTrash) return false;
      for (const id of r.trashed ?? []) if (!(await getDocumentByPublicId(ctx, id))?.inTrash) return false;
      return true;
    }
    default:
      return Boolean(note && !note.inTrash && (op.baseContentSeq === undefined || note.contentSeq > op.baseContentSeq));
  }
}

// ---------------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------------

/** One part of an undo: a note put back as it was, or one operation reversed. */
export type UndoPart = { key: string; label: string };

/** Operations reversed one by one (content changes are undone by putting their notes back instead). */
const reversible = (op: AgentOp) => op.status === "applied" && op.undone === undefined && !(changesNote(op) && op.kind !== "merge_notes");

/** What an undo does, in order: notes back to their versions first, then the operations, last first. */
export function undoParts(ops: AgentOp[], notes: RunNote[]): UndoPart[] {
  return [
    ...notes.filter((n) => n.restored === undefined).map((n) => ({ key: `note:${n.noteId}`, label: q(n.title) })),
    ...ops
      .filter(reversible)
      .reverse()
      .map((o) => ({ key: `op:${o.id}`, label: o.summary })),
  ];
}

/** Whether a part changed since the run (then Undo asks first). Returns why, or null. */
export async function changedSince(ctx: QueryCtx, env: ExecEnv, part: UndoPart, ops: AgentOp[], notes: RunNote[]): Promise<string | null> {
  if (part.key.startsWith("note:")) {
    const n = notes.find((x) => `note:${x.noteId}` === part.key)!;
    const doc = await getDocumentByPublicId(ctx, n.noteId);
    if (!doc) return null;
    return doc.contentSeq !== n.contentSeqAfter || doc.title !== n.titleAfter ? `${q(doc.title)} was edited after the AI changed it.` : null;
  }
  const op = ops.find((o) => `op:${o.id}` === part.key)!;
  const r = op.result ?? {};
  switch (op.kind) {
    case "create_note":
    case "create_checklist":
    case "create_tasks": {
      const doc = r.noteId ? await getDocumentByPublicId(ctx, r.noteId) : null;
      return doc && !doc.inTrash && (doc.contentSeq !== r.contentSeq || (r.title !== undefined && doc.title !== r.title)) ? `${q(doc.title)} was edited after the AI made it.` : null;
    }
    case "move_note": {
      const doc = r.noteId ? await getDocumentByPublicId(ctx, r.noteId) : null;
      const f = doc?.folderId ? await ctx.db.get(doc.folderId) : null;
      return doc && (f?.publicId ?? undefined) !== (r.folderId ?? undefined) ? `${q(doc.title)} was moved again since.` : null;
    }
    case "create_folder": {
      if (!r.created) return null;
      const f = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", r.folderId ?? ""))
        .unique();
      if (!f || f.deletedAt) return null;
      const made = new Set(ops.filter((o) => o.status === "applied" && (o.kind === "create_note" || o.kind === "create_checklist" || o.kind === "create_tasks" || o.kind === "move_note")).map((o) => o.result?.noteId));
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_folder", (q) => q.eq("folderId", f._id))
        .take(200);
      const others = docs.filter((d) => !d.inTrash && !made.has(d.publicId));
      return others.length ? `The folder ${q(f.name)} has other notes in it now.` : null;
    }
    default:
      return null;
  }
}

/** Whether the person can still change a note (Undo skips one they can't, saying so). */
async function canEdit(ctx: MutationCtx, env: ExecEnv, doc: Doc<"documents">): Promise<boolean> {
  return inScope(doc, env.scope) && accessAtLeast(await documentAccess(ctx, env.profile, doc), "write");
}

/**
 * Undoes one part. Returns "done", or "kept" when there was nothing to undo or it can't be (gone, no
 * longer theirs to edit). Callers decide about parts that changed since before calling.
 */
export async function undoPart(ctx: MutationCtx, env: ExecEnv, part: UndoPart, ops: AgentOp[], notes: RunNote[]): Promise<"done" | "kept"> {
  if (part.key.startsWith("note:")) {
    const n = notes.find((x) => `note:${x.noteId}` === part.key)!;
    const doc = await getDocumentByPublicId(ctx, n.noteId);
    const snap = await ctx.db
      .query("documentSnapshots")
      .withIndex("by_public_id", (q) => q.eq("publicId", n.snapshotId))
      .unique();
    if (!doc || !snap || snap.documentId !== doc._id || !(await canEdit(ctx, env, doc))) return "kept";
    await restoreVersion(ctx, doc, snap, env.profile);
    return "done";
  }
  const op = ops.find((o) => `op:${o.id}` === part.key)!;
  const r = op.result ?? {};
  const doc = r.noteId ? await getDocumentByPublicId(ctx, r.noteId) : null;
  switch (op.kind) {
    case "create_note":
    case "create_checklist":
    case "create_tasks": {
      if (!doc || doc.inTrash || !(await canEdit(ctx, env, doc))) return "kept";
      await setTrashState(ctx, doc, env.profile._id, true, Date.now());
      return "done";
    }
    case "move_note": {
      if (!doc || !(await canEdit(ctx, env, doc))) return "kept";
      const back = r.movedFrom
        ? await ctx.db
            .query("folders")
            .withIndex("by_public_id", (q) => q.eq("publicId", r.movedFrom!))
            .unique()
        : null;
      await sync(ctx, env, [{ opId: `${op.id}.undo`, kind: "document.update", documentId: doc.publicId, patch: { folderId: back && !back.deletedAt ? back.publicId : null }, baseRevision: null }]);
      return "done";
    }
    case "add_tags": {
      if (!doc || !(await canEdit(ctx, env, doc))) return "kept";
      const links = await ctx.db
        .query("documentTags")
        .withIndex("by_document", (q) => q.eq("documentId", doc._id))
        .take(200);
      for (const id of r.tagIds ?? []) {
        const tag = await ctx.db
          .query("tags")
          .withIndex("by_public_id", (q) => q.eq("publicId", id))
          .unique();
        if (!tag) continue;
        for (const l of links.filter((x) => x.tagId === tag._id)) await ctx.db.delete(l._id);
        // A tag the run made goes too, unless something else has it now.
        if ((r.createdTagIds ?? []).includes(id)) {
          const other = await ctx.db
            .query("documentTags")
            .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
            .first();
          if (!other) await ctx.db.delete(tag._id);
        }
      }
      await ctx.db.patch(doc._id, { seq: await nextSeq(ctx, env.scope), updatedAt: Date.now() });
      return "done";
    }
    case "merge_notes": {
      let any = false;
      for (const id of r.trashed ?? []) {
        const s = await getDocumentByPublicId(ctx, id);
        if (!s || !s.inTrash || !(await canEdit(ctx, env, s))) continue;
        await restoreDoc(ctx, s, env.profile._id);
        any = true;
      }
      // The files go back to the notes they came from (still there), so those keep showing them; a note
      // purged since leaves its files with the target.
      for (const m of r.movedFiles ?? []) {
        const file = await ctx.db
          .query("files")
          .withIndex("by_public_id", (q) => q.eq("publicId", m.fileId))
          .unique();
        const home = await getDocumentByPublicId(ctx, m.from);
        if (!file || !home || !doc || file.documentId !== doc._id) continue;
        await ctx.db.patch(file._id, { documentId: home._id });
      }
      return any ? "done" : "kept";
    }
    case "create_folder": {
      if (!r.created) return "kept";
      const f = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", r.folderId ?? ""))
        .unique();
      if (!f || f.deletedAt || !inScope(f, env.scope)) return "kept";
      // As deleting a folder by hand: its notes stay, unsorted.
      const seq = await nextSeq(ctx, env.scope);
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_folder", (q) => q.eq("folderId", f._id))
        .take(500);
      for (const d of docs) await ctx.db.patch(d._id, { folderId: undefined, seq, revision: d.revision + 1 });
      await ctx.db.patch(f._id, { deletedAt: Date.now(), seq });
      return "done";
    }
    default:
      return "kept";
  }
}

