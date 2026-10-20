import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cloneBlocks, specsToWireBlocks, ulid, randomNoteEmoji, validateWireBlock, type BlockSpec, type WireBlock } from "@folevi/editor-schema";
import { DEFAULTS, lastRootRank, newDocumentRank, refreshDerived, sanitizeTitle, syncTaskProjection } from "./documents";
import { studyKindOf, syncStudyCard } from "./study";
import { fail } from "./errors";
import { bump } from "./metrics";
import { nextSeq } from "./seq";
import { insertScoped, type Scope } from "./scope";
import { queueIndex } from "./ai/indexing";
import { emitWebhook } from "./webhooks";
import { indexSyncedBlocks } from "./synced";

// The authoring format and block copies are shared with the local backend (packages/editor-schema content.ts).
export { cloneBlocks, specsToWireBlocks, type BlockSpec };

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
  for (const row of rows) if (studyKindOf(row)) await syncStudyCard(ctx, row, doc);
  // Synced blocks it starts with are recorded as showing their content (lib/synced.ts).
  if (rows.some((r) => r.type === "synced")) {
    if (doc.kind === "synced") fail("invalid_block", "A synced block can't go inside another synced block.");
    await indexSyncedBlocks(ctx, doc, rows);
  }
  await refreshDerived(ctx, doc, rows);
  if (rows.length) await queueIndex(ctx, doc);
  if (doc.kind !== "synced") {
    await adjustDocumentCount(ctx, scope, 1);
    await bump(ctx, "documents_total");
  }
  const created = (await ctx.db.get(docId))!;
  await emitWebhook(ctx, "note.created", created);
  return created;
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

