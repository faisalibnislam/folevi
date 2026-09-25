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
  type WireBlock,
} from "@folevi/editor-schema";

type Ctx = QueryCtx | MutationCtx;

export interface DocumentSummary {
  id: string;
  workspaceId: string;
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
  async workspace(id: Id<"workspaces">): Promise<string> {
    if (!this.workspaces.has(id)) this.workspaces.set(id, (await this.ctx.db.get(id))?.publicId ?? null);
    return this.workspaces.get(id) ?? "";
  }
  async profile(id: Id<"profiles">): Promise<string> {
    if (!this.profiles.has(id)) this.profiles.set(id, (await this.ctx.db.get(id)) ? id : null);
    return this.profiles.get(id) ?? "";
  }
}

export async function toSummary(ids: IdResolver, doc: Doc<"documents">): Promise<DocumentSummary> {
  return {
    id: doc.publicId,
    workspaceId: await ids.workspace(doc.workspaceId),
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

export async function liveBlocks(ctx: Ctx, documentId: Id<"documents">): Promise<Doc<"blocks">[]> {
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect();
  return rows.filter((r) => r.deletedAt === undefined);
}

/** Recomputes search text, counts and excerpt from the canonical blocks. */
export async function refreshDerived(ctx: MutationCtx, doc: Doc<"documents">, rows?: Doc<"blocks">[]): Promise<void> {
  const blocks = (rows ?? (await liveBlocks(ctx, doc._id))).map(toWireBlock);
  const ordered = flattenTree(blocks).map((e) => e.block);
  const text = ordered.map((b) => plainText(b.text)).filter(Boolean);
  const joined = text.join("\n");
  const excerpt = text.join(" ").replace(/\s+/g, " ").slice(0, 240);
  await ctx.db.patch(doc._id, {
    searchText: documentSearchText(doc.title, ordered),
    wordCount: wordCount(`${doc.title} ${joined}`),
    charCount: joined.length,
    blockCount: blocks.length,
    excerpt,
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
  // Checklists inside templates are blueprints, not tasks.
  const projection = row.deletedAt === undefined && doc.kind !== "template" ? projectTask(toWireBlock(row), doc.publicId) : null;
  if (!projection) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  let assigneeId: Id<"profiles"> | undefined;
  if (projection.assigneeId) {
    const normalized = ctx.db.normalizeId("profiles", projection.assigneeId);
    if (normalized) assigneeId = normalized;
  }
  const fields = {
    blockId: row.blockId,
    blockDocId: row._id,
    documentId: doc._id,
    workspaceId: doc.workspaceId,
    title: projection.title,
    status: projection.status,
    dueDate: projection.dueDate ?? undefined,
    dueTime: projection.dueTime ?? undefined,
    priority: projection.priority,
    assigneeId,
    reminderAt: projection.reminderAt ?? undefined,
    completedAt: projection.completedAt ?? (projection.status === "done" ? Date.now() : undefined),
    updatedAt: Date.now(),
    documentInTrash: doc.inTrash,
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("tasks", { ...fields, createdBy: actorId });
}

export async function lastRootRank(ctx: Ctx, workspaceId: Id<"workspaces">): Promise<string | null> {
  const latest = await ctx.db
    .query("documents")
    .withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId))
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
