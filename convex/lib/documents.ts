import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  DEFAULT_COVER,
  DEFAULT_DOCUMENT_STYLE,
  buildPreview,
  deriveDocumentText,
  newDocumentRank,
  projectTask,
  sanitizeTitle,
  type PreviewLine,
  type WireBlock,
} from "@folevi/editor-schema";
import { insertScoped, scopeOfRow, type Scope } from "./scope";
import { accessAtLeast, documentAccess, membership } from "./auth";
import { sharedLabels } from "./linkLabels";
import { emitWebhook } from "./webhooks";
import { notesShowingInPlace, withSyncedShared } from "./synced";
import { sealedFieldsOf, toSealedWireBlock, type SealedDocumentFields } from "./e2ee/sealedRows";

type Ctx = QueryCtx | MutationCtx;

export interface DocumentSummary {
  id: string;
  /** The team workspace it's in (public id); null when it's in someone's Personal. */
  workspaceId: string | null;
  /** Whose Personal it's in (profile id); null in a team workspace. */
  ownerProfileId: string | null;
  parentDocumentId: string | null;
  folderId: string | null;
  kind: Doc<"documents">["kind"];
  title: string;
  icon: string | null;
  cover: Doc<"documents">["cover"];
  style: Doc<"documents">["style"];
  dailyDate: string | null;
  accessMode: Doc<"documents">["accessMode"];
  rank: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  archivedAt: number | null;
  deletedAt: number | null;
  revision: number;
  titleRev: number;
  seq: number;
  excerpt: string;
  preview: PreviewLine[] | null;
  wordCount: number;
  charCount: number;
  blockCount: number;
  /**
   * End-to-end encrypted notes only (docs/E2EE_DESIGN.md §4.6): the sealed title, appearance and meta (the
   * plaintext fields above then hold placeholders), whether the note itself is Always fully encrypted, the
   * locked folder it inherits that from (only for readers in its scope, like `folderId`) and its files.
   * Standard notes never have these keys.
   */
  sealed?: SealedDocumentFields;
  locked?: true;
  lockedVia?: string;
  fileIds?: string[];
}

/** Resolves Convex ids to public ids with a per-call cache. */
export class IdResolver {
  private docs = new Map<string, string | null>();
  private folders = new Map<string, string | null>();
  private workspaces = new Map<string, string | null>();
  private profiles = new Map<string, string | null>();
  constructor(private ctx: Ctx) {}
  async document(id: Id<"documents"> | undefined): Promise<string | null> {
    if (!id) return null;
    if (!this.docs.has(id)) this.docs.set(id, (await this.ctx.db.get(id))?.publicId ?? null);
    return this.docs.get(id) ?? null;
  }
  async folder(id: Id<"folders"> | undefined): Promise<string | null> {
    if (!id) return null;
    if (!this.folders.has(id)) this.folders.set(id, (await this.ctx.db.get(id))?.publicId ?? null);
    return this.folders.get(id) ?? null;
  }
  async workspace(id: Id<"workspaces"> | undefined): Promise<string | null> {
    if (!id) return null;
    if (!this.workspaces.has(id)) this.workspaces.set(id, (await this.ctx.db.get(id))?.publicId ?? null);
    return this.workspaces.get(id) ?? null;
  }
  async profile(id: Id<"profiles">): Promise<string> {
    if (!this.profiles.has(id)) this.profiles.set(id, (await this.ctx.db.get(id)) ? id : null);
    return this.profiles.get(id) ?? "";
  }
}

/**
 * What one reader may see of where pages sit. A page's folder only when they're in the page's own scope
 * (its Personal's owner, or a member of its workspace), never for a guest; its parent page only when they
 * can open that page. Anything else is null: an id of a folder or page they can't open isn't theirs to
 * have, even an opaque one. Cached per call; `summary` is toSummary for this reader.
 */
export class Placement {
  private members = new Map<string, boolean>();
  private readable = new Map<string, boolean>();
  constructor(
    private ctx: Ctx,
    private profile: Doc<"profiles">,
  ) {}

  /** In the page's scope: its Personal's owner, or a member of its workspace (not a guest on it). */
  async inScope(doc: Doc<"documents">): Promise<boolean> {
    if (doc.ownerProfileId !== undefined) return doc.ownerProfileId === this.profile._id;
    if (doc.workspaceId === undefined) return false;
    let ok = this.members.get(doc.workspaceId);
    if (ok === undefined) {
      ok = (await membership(this.ctx, this.profile._id, doc.workspaceId)) !== null;
      this.members.set(doc.workspaceId, ok);
    }
    return ok;
  }

  /** Whether the reader can open the page with this id. */
  async canOpen(id: Id<"documents">): Promise<boolean> {
    let ok = this.readable.get(id);
    if (ok === undefined) {
      const doc = await this.ctx.db.get(id);
      ok = doc !== null && accessAtLeast(await documentAccess(this.ctx, this.profile, doc), "read");
      this.readable.set(id, ok);
    }
    return ok;
  }

  /** toSummary as this reader may see it. */
  async summary(ids: IdResolver, doc: Doc<"documents">): Promise<DocumentSummary> {
    const s = await toSummary(ids, doc);
    const folderId = s.folderId !== null && (await this.inScope(doc)) ? s.folderId : null;
    const parentDocumentId = doc.parentDocumentId !== undefined && (await this.canOpen(doc.parentDocumentId)) ? s.parentDocumentId : null;
    if (s.lockedVia !== undefined && !(await this.inScope(doc))) {
      const { lockedVia: _hidden, ...rest } = s;
      void _hidden;
      return { ...rest, folderId, parentDocumentId };
    }
    return { ...s, folderId, parentDocumentId };
  }
}

/** The folder a page lives in: its own, or its nearest ancestor page's. null means it's a Draft. */
export interface HomeFolder {
  id: string;
  name: string;
  color: string | null;
  /** An end-to-end encrypted folder's sealed name (`name` is then ""). */
  sealedName?: { c: ArrayBuffer; k: number };
}

/**
 * Resolves each page's home folder (nested pages have no folder of their own and inherit their parent
 * page's). Cached per query, and bounded in depth, so a list of pages costs a handful of reads.
 */
export class HomeFolders {
  private byDoc = new Map<string, HomeFolder | null>();
  private byFolder = new Map<string, HomeFolder | null>();
  constructor(private ctx: Ctx) {}
  private async folder(id: Id<"folders">): Promise<HomeFolder | null> {
    if (!this.byFolder.has(id)) {
      const f = await this.ctx.db.get(id);
      this.byFolder.set(id, f && !f.deletedAt ? { id: f.publicId, name: f.name, color: f.color ?? null, ...(f.sealedName ? { sealedName: f.sealedName } : {}) } : null);
    }
    return this.byFolder.get(id) ?? null;
  }
  async of(doc: Doc<"documents">): Promise<HomeFolder | null> {
    const chain: string[] = [];
    let cur: Doc<"documents"> | null = doc;
    let found: HomeFolder | null = null;
    for (let depth = 0; cur && depth < 12; depth++) {
      if (this.byDoc.has(cur._id)) {
        found = this.byDoc.get(cur._id) ?? null;
        break;
      }
      chain.push(cur._id);
      if (cur.folderId) {
        found = await this.folder(cur.folderId);
        break;
      }
      cur = cur.parentDocumentId ? await this.ctx.db.get(cur.parentDocumentId) : null;
    }
    for (const id of chain) this.byDoc.set(id, found);
    return found;
  }
}

export async function toSummary(ids: IdResolver, doc: Doc<"documents">): Promise<DocumentSummary> {
  return {
    id: doc.publicId,
    workspaceId: await ids.workspace(doc.workspaceId),
    ownerProfileId: doc.ownerProfileId ?? null,
    parentDocumentId: await ids.document(doc.parentDocumentId),
    folderId: await ids.folder(doc.folderId),
    kind: doc.kind,
    title: doc.title,
    icon: doc.icon ?? null,
    cover: doc.cover,
    style: doc.style,
    dailyDate: doc.dailyDate ?? null,
    accessMode: doc.accessMode,
    rank: doc.rank,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy,
    archivedAt: doc.archivedAt ?? null,
    deletedAt: doc.deletedAt ?? null,
    revision: doc.revision,
    titleRev: doc.titleRev,
    seq: doc.seq,
    excerpt: doc.excerpt,
    preview: doc.preview ?? null,
    wordCount: doc.wordCount,
    charCount: doc.charCount,
    blockCount: doc.blockCount,
    ...(await sealedSummary(ids, doc)),
  };
}

/** The sealed part of a summary; nothing at all for a Standard note (its summary is exactly as before). */
async function sealedSummary(ids: IdResolver, doc: Doc<"documents">): Promise<Partial<DocumentSummary>> {
  const sealed = sealedFieldsOf(doc);
  if (!sealed && !doc.locked && doc.lockedVia === undefined) return {};
  const out: Partial<DocumentSummary> = {};
  if (sealed) out.sealed = sealed;
  if (doc.locked) out.locked = true;
  if (doc.lockedVia !== undefined) {
    const via = await ids.folder(doc.lockedVia);
    if (via) out.lockedVia = via;
  }
  if (doc.fileIds?.length) out.fileIds = doc.fileIds;
  return out;
}

/** A block as clients receive it; a sealed block travels as a SealedWireBlock (placeholders plus `sealed`). */
export function toWireBlock(row: Doc<"blocks">): WireBlock {
  if (row.sealed !== undefined) return toSealedWireBlock(row);
  return {
    id: row.blockId,
    type: row.type,
    parentId: row.parentId,
    rank: row.rank,
    schemaVersion: row.schemaVersion,
    text: row.text as WireBlock["text"],
    props: row.props as Record<string, unknown>,
    revision: row.revision,
  };
}

/** A page's blocks that aren't deleted. Tombstones are left out by the index, so they're never read. */
export async function liveBlocks(ctx: Ctx, documentId: Id<"documents">): Promise<Doc<"blocks">[]> {
  return await ctx.db
    .query("blocks")
    .withIndex("by_document_deleted", (q) => q.eq("documentId", documentId).eq("deletedAt", undefined))
    .collect();
}

// The card preview, title and rank rules are shared with the local backend (packages/editor-schema derive.ts).
export { buildPreview, newDocumentRank, sanitizeTitle, type PreviewLine };

/**
 * Recomputes search text, counts, excerpt and card preview from the canonical blocks. Everyone who can
 * read the page sees these, so links in them carry only titles everyone there may see (sharedLabels).
 */
export async function refreshDerived(ctx: MutationCtx, doc: Doc<"documents">, rows?: Doc<"blocks">[]): Promise<void> {
  // A sealed note's text is ciphertext: devices derive its search text and preview (docs/E2EE_DESIGN.md
  // §6.7). Only the number of blocks is kept (the limit per note is enforced on it).
  if (doc.sealedAt !== undefined) {
    const count = (rows ?? (await liveBlocks(ctx, doc._id))).length;
    if (count !== doc.blockCount) await ctx.db.patch(doc._id, { blockCount: count });
    return;
  }
  const own = (rows ?? (await liveBlocks(ctx, doc._id))).map(toWireBlock);
  // A note reads with the synced blocks from its own place in it (lib/synced.ts): searching finds the note.
  const blocks = await sharedLabels(ctx, doc, (await withSyncedShared(ctx, doc, own)).blocks);
  // A synced block's content is never found as a page of its own: the notes showing it are. Counts are of
  // the body only (the title isn't part of the page's word count).
  const derived = deriveDocumentText(doc.title, blocks, { synced: doc.kind === "synced" });
  await ctx.db.patch(doc._id, {
    searchText: derived.searchText,
    wordCount: derived.wordCount,
    charCount: derived.charCount,
    // The note's own blocks (the limit on blocks per note counts these).
    blockCount: own.length,
    excerpt: derived.excerpt,
    preview: derived.preview,
  });
  // The notes in its place that show it include its text.
  if (doc.kind === "synced") for (const note of await notesShowingInPlace(ctx, doc)) await refreshDerived(ctx, note);
}

/** Keeps the task projection in step with a todo block (the block stays canonical). */
export async function syncTaskProjection(
  ctx: MutationCtx,
  row: Doc<"blocks">,
  doc: Doc<"documents">,
  actorId: Id<"profiles">,
): Promise<void> {
  const existing = await ctx.db
    .query("tasks")
    .withIndex("by_block", (q) => q.eq("blockId", row.blockId))
    .unique();
  // Sealed to-dos are projected on devices (docs/E2EE_DESIGN.md §6.7); a projection left from before goes.
  if (row.sealed !== undefined || doc.sealedAt !== undefined) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  // Checklists inside templates are blueprints, not tasks. A task's title is shown to everyone who can read
  // the page, so links in it carry only titles everyone there may see.
  const live = row.deletedAt === undefined && doc.kind !== "template";
  const projection = live ? projectTask((await sharedLabels(ctx, doc, [toWireBlock(row)]))[0]!, doc.publicId) : null;
  if (!projection) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  let assigneeId: Id<"profiles"> | undefined;
  if (projection.assigneeId) {
    const normalized = ctx.db.normalizeId("profiles", projection.assigneeId);
    if (normalized) assigneeId = normalized;
  }
  // A done to-do whose block doesn't say when keeps the time it was first seen done (re-projecting it, on
  // any later edit of the block, mustn't move it to now).
  const doneAt = existing?.status === "done" && existing.completedAt !== undefined ? existing.completedAt : Date.now();
  const fields = {
    blockId: row.blockId,
    blockDocId: row._id,
    documentId: doc._id,
    title: projection.title,
    status: projection.status,
    dueDate: projection.dueDate ?? undefined,
    dueTime: projection.dueTime ?? undefined,
    priority: projection.priority,
    assigneeId,
    reminderAt: projection.reminderAt ?? undefined,
    completedAt: projection.completedAt ?? (projection.status === "done" ? doneAt : undefined),
    documentInTrash: doc.inTrash,
    repeat: projection.repeat ?? undefined,
  };
  // A task is in its document's scope (documents never change scope).
  if (!existing) {
    await insertScoped(ctx, "tasks", scopeOfRow(doc), { ...fields, createdBy: actorId, updatedAt: Date.now() });
    await emitWebhook(ctx, "task.created", doc, { taskBlockId: row.blockId });
    return;
  }
  // Most block edits don't change the task; writing it anyway would wake every task list watching it.
  const unchanged = (Object.keys(fields) as (keyof typeof fields)[]).every((k) => existing[k] === fields[k]);
  if (unchanged) return;
  // A reminder set to a new time is a new reminder: it goes out again even if the old one already did.
  const reminderMoved = existing.reminderSentAt !== undefined && existing.reminderAt !== fields.reminderAt;
  await ctx.db.patch(existing._id, { ...fields, ...(reminderMoved ? { reminderSentAt: undefined } : {}), updatedAt: Date.now() });
  if (existing.status !== "done" && fields.status === "done") await emitWebhook(ctx, "task.completed", doc, { taskBlockId: row.blockId });
  // A repeating to-do just checked off comes back at its next date (right after this edit is saved).
  if (existing.status === "open" && fields.status === "done" && fields.repeat) {
    await ctx.scheduler.runAfter(0, internal.tasks.repeatTask, { blockId: row.blockId, actorId });
  }
}

export async function lastRootRank(ctx: Ctx, scope: Scope): Promise<string | null> {
  const base = ctx.db.query("documents");
  const latest = await (
    scope.kind === "personal"
      ? base.withIndex("by_owner_created", (q) => q.eq("ownerProfileId", scope.profileId))
      : base.withIndex("by_workspace_created", (q) => q.eq("workspaceId", scope.workspaceId))
  )
    .order("desc")
    .first();
  return latest?.rank ?? null;
}

export const DEFAULTS = { style: DEFAULT_DOCUMENT_STYLE, cover: DEFAULT_COVER };
