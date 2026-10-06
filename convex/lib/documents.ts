import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  DEFAULT_COVER,
  DEFAULT_DOCUMENT_STYLE,
  documentSearchText,
  flattenTree,
  plainText,
  projectTask,
  rankBetween,
  wordCount,
  type InlineNode,
  type WireBlock,
} from "@folevi/editor-schema";
import { insertScoped, scopeOfRow, type Scope } from "./scope";
import { accessAtLeast, documentAccess, membership } from "./auth";
import { sharedLabels } from "./linkLabels";

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
    return { ...s, folderId, parentDocumentId };
  }
}

/** The folder a page lives in: its own, or its nearest ancestor page's. null means it's a Draft. */
export interface HomeFolder {
  id: string;
  name: string;
  color: string | null;
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
      this.byFolder.set(id, f && !f.deletedAt ? { id: f.publicId, name: f.name, color: f.color ?? null } : null);
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
  };
}

export function toWireBlock(row: Doc<"blocks">): WireBlock {
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

/** One line of a page thumbnail: block type, trimmed text, and just enough shape to draw it. */
export interface PreviewLine {
  t: string;
  x: string;
  l?: number;
  c?: boolean;
  d?: number;
  rows?: string[][];
}

const PREVIEW_LINES = 14;

/** The first blocks of a page, trimmed, so document cards can show a miniature of the page itself. */
export function buildPreview(entries: { block: WireBlock; depth: number }[]): PreviewLine[] {
  const out: PreviewLine[] = [];
  for (const { block: b, depth } of entries) {
    if (out.length >= PREVIEW_LINES) break;
    const p = b.props as { level?: number; checked?: boolean; rows?: InlineNode[][][]; name?: string; title?: string; url?: string; titleCache?: string };
    const line: PreviewLine = { t: b.type, x: plainText(b.text).slice(0, 160) };
    if (depth) line.d = Math.min(depth, 4);
    if (b.type === "heading") line.l = Number(p.level ?? 1);
    if (b.type === "todo") line.c = Boolean(p.checked);
    if (b.type === "table") line.rows = (p.rows ?? []).slice(0, 6).map((r) => r.slice(0, 5).map((c) => plainText(c).slice(0, 24)));
    if (b.type === "file" || b.type === "audio") line.x = String(p.name ?? "File").slice(0, 80);
    if (b.type === "bookmark") line.x = String(p.title ?? p.url ?? "").slice(0, 80);
    if (b.type === "page") line.x = String(p.titleCache ?? "Page").slice(0, 80);
    if (b.type === "formula") line.x = String((p as { latex?: string }).latex ?? "").slice(0, 160);
    out.push(line);
  }
  return out;
}

/**
 * Recomputes search text, counts, excerpt and card preview from the canonical blocks. Everyone who can
 * read the page sees these, so links in them carry only titles everyone there may see (sharedLabels).
 */
export async function refreshDerived(ctx: MutationCtx, doc: Doc<"documents">, rows?: Doc<"blocks">[]): Promise<void> {
  const blocks = await sharedLabels(ctx, doc, (rows ?? (await liveBlocks(ctx, doc._id))).map(toWireBlock));
  const flat = flattenTree(blocks);
  const ordered = flat.map((e) => e.block);
  const text = ordered.map((b) => plainText(b.text)).filter(Boolean);
  const joined = text.join("\n");
  const excerpt = text.join(" ").replace(/\s+/g, " ").slice(0, 240);
  await ctx.db.patch(doc._id, {
    searchText: documentSearchText(doc.title, ordered),
    // Body only, like charCount (the title isn't part of the page's word count).
    wordCount: wordCount(joined),
    charCount: joined.length,
    blockCount: blocks.length,
    excerpt,
    preview: buildPreview(flat),
  });
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
  };
  // A task is in its document's scope (documents never change scope).
  if (!existing) {
    await insertScoped(ctx, "tasks", scopeOfRow(doc), { ...fields, createdBy: actorId, updatedAt: Date.now() });
    return;
  }
  // Most block edits don't change the task; writing it anyway would wake every task list watching it.
  const unchanged = (Object.keys(fields) as (keyof typeof fields)[]).every((k) => existing[k] === fields[k]);
  if (unchanged) return;
  // A reminder set to a new time is a new reminder: it goes out again even if the old one already did.
  const reminderMoved = existing.reminderSentAt !== undefined && existing.reminderAt !== fields.reminderAt;
  await ctx.db.patch(existing._id, { ...fields, ...(reminderMoved ? { reminderSentAt: undefined } : {}), updatedAt: Date.now() });
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

export function newDocumentRank(after: string | null): string {
  try {
    return rankBetween(after, null);
  } catch {
    return rankBetween(null, null);
  }
}

export const DEFAULTS = { style: DEFAULT_DOCUMENT_STYLE, cover: DEFAULT_COVER };

export function sanitizeTitle(title: string): string {
  return title.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 300);
}
