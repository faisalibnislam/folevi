import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  SCHEMA_VERSION,
  parseInlineMarkdown,
  rankSequence,
  ulid,
  randomNoteEmoji,
  validateWireBlock,
  type InlineNode,
  type WireBlock,
} from "@folevi/editor-schema";
import { DEFAULTS, lastRootRank, newDocumentRank, refreshDerived, sanitizeTitle, syncTaskProjection } from "./documents";
import { fail } from "./errors";
import { bump } from "./metrics";
import { nextSeq } from "./seq";
import { insertScoped, type Scope } from "./scope";
import { queueIndex } from "./ai/indexing";

/** Compact authoring format for seed content, templates and programmatic documents. */
export interface BlockSpec {
  type: string;
  /** Inline Markdown (bold, italic, code, links). */
  md?: string;
  text?: InlineNode[];
  props?: Record<string, unknown>;
  children?: BlockSpec[];
}

export function specsToWireBlocks(specs: BlockSpec[], parentId: string | null = null): WireBlock[] {
  const ranks = rankSequence(specs.length);
  const out: WireBlock[] = [];
  specs.forEach((spec, i) => {
    const id = ulid();
    out.push({
      id,
      type: spec.type,
      parentId,
      rank: ranks[i]!,
      schemaVersion: SCHEMA_VERSION,
      text: spec.text ?? (spec.md ? parseInlineMarkdown(spec.md) : []),
      props: spec.props ?? {},
    });
    if (spec.children?.length) out.push(...specsToWireBlocks(spec.children, id));
  });
  return out;
}

export interface CreateDocumentInput {
  /** Where the document lives: a Personal or a team workspace (authorized by the caller). */
  scope: Scope;
  actor: Doc<"profiles">;
  publicId?: string;
  title: string;
  icon?: string | null;
  kind?: Doc<"documents">["kind"];
  parentDocumentId?: Id<"documents">;
  folderId?: Id<"folders">;
  style?: Doc<"documents">["style"];
  cover?: Doc<"documents">["cover"];
  dailyDate?: string;
  dailyOwnerId?: Id<"profiles">;
  templateKey?: string;
  collectionId?: Id<"collections">;
  accessMode?: Doc<"documents">["accessMode"];
  blocks?: WireBlock[];
}

export async function createDocument(ctx: MutationCtx, input: CreateDocumentInput): Promise<Doc<"documents">> {
  const now = Date.now();
  const scope = input.scope;
  const seq = await nextSeq(ctx, scope);
  const publicId = input.publicId ?? ulid();
  const existing = await ctx.db
    .query("documents")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (existing) fail("conflict", "Document already exists.");
  const blocks = input.blocks ?? [];
  for (const b of blocks) {
    const issues = validateWireBlock(b);
    if (issues.length) fail("invalid_block", `${issues[0]!.path}: ${issues[0]!.message}`);
  }
  const docId = await insertScoped(ctx, "documents", scope, {
    publicId,
    parentDocumentId: input.parentDocumentId,
    folderId: input.folderId,
    kind: input.kind ?? "document",
    title: sanitizeTitle(input.title),
    // Every note has an icon (templates and collection rows keep whatever they were given).
    icon: input.icon ?? ((input.kind ?? "document") === "document" ? randomNoteEmoji() : undefined),
    // New notes start Plain unless the caller gives a note theme.
    cover: input.cover ?? DEFAULTS.cover,
    style: input.style ?? DEFAULTS.style,
    dailyDate: input.dailyDate,
    dailyOwnerId: input.dailyOwnerId,
    templateKey: input.templateKey,
    collectionId: input.collectionId,
    accessMode: input.accessMode ?? "workspace",
    rank: newDocumentRank(await lastRootRank(ctx, scope)),
    createdBy: input.actor._id,
    lastEditedBy: input.actor._id,
    createdAt: now,
    updatedAt: now,
    inTrash: false,
    revision: 1,
    titleRev: 1,
    seq,
    contentSeq: blocks.length ? 1 : 0,
    searchText: input.title,
    wordCount: 0,
    charCount: 0,
    blockCount: 0,
    excerpt: "",
  });
  const rows: Doc<"blocks">[] = [];
  for (const b of blocks) {
    const rowId = await insertScoped(ctx, "blocks", scope, {
      blockId: b.id,
      documentId: docId,
      parentId: b.parentId,
      rank: b.rank,
      type: b.type,
      schemaVersion: b.schemaVersion,
      text: b.text,
      props: b.props,
      revision: 1,
      contentRev: 1,
      positionRev: 1,
      seq,
      createdAt: now,
      updatedAt: now,
      updatedBy: input.actor._id,
    });
    rows.push((await ctx.db.get(rowId))!);
  }
  const doc = (await ctx.db.get(docId))!;
  for (const row of rows) if (row.type === "todo") await syncTaskProjection(ctx, row, doc, input.actor._id);
  await refreshDerived(ctx, doc, rows);
  if (rows.length) await queueIndex(ctx, doc);
  await adjustDocumentCount(ctx, scope, 1);
  await bump(ctx, "documents_total");
  return (await ctx.db.get(docId))!;
}

/** Keeps a scope's document counter (admin views) in step. */
export async function adjustDocumentCount(ctx: MutationCtx, scope: Scope, delta: number): Promise<void> {
  if (scope.kind === "personal") {
    const owner = await ctx.db.get(scope.profileId);
    if (owner) await ctx.db.patch(owner._id, { personalDocumentCount: Math.max(0, (owner.personalDocumentCount ?? 0) + delta) });
    return;
  }
  const ws = await ctx.db.get(scope.workspaceId);
  if (ws) await ctx.db.patch(ws._id, { documentCount: Math.max(0, ws.documentCount + delta) });
}

/** Deep-copies blocks with fresh ids, preserving the tree. */
export function cloneBlocks(blocks: WireBlock[]): WireBlock[] {
  const map = new Map<string, string>();
  for (const b of blocks) map.set(b.id, ulid());
  return blocks.map((b) => ({
    ...b,
    id: map.get(b.id)!,
    parentId: b.parentId ? (map.get(b.parentId) ?? null) : null,
    revision: undefined,
  }));
}
