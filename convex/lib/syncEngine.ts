// Server side of docs/SYNC_PROTOCOL.md. Pure functions over a MutationCtx; no client-supplied identity.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  LIMITS,
  sameContent,
  validateWireBlock,
  type OpResult,
  type SyncOp,
  type WireBlock,
  type WireDocumentCreate,
  type WireDocumentPatch,
} from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, getDocumentByPublicId, requireWorkspace } from "./auth";
import { IdResolver, liveBlocks, refreshDerived, sanitizeTitle, syncTaskProjection, toSummary, toWireBlock, type DocumentSummary } from "./documents";
import { createDocument, cloneBlocks } from "./create";
import { builtInTemplateBlocks } from "./templates";
import { bump } from "./metrics";
import { SeqAllocator } from "./seq";
import { fail } from "./errors";

export const MAX_BATCH = 100;

export type ServerOpResult = OpResult & { document?: DocumentSummary };

interface Touched {
  doc: Doc<"documents">;
  changedBlocks: Set<Id<"blocks">>;
}

export class SyncEngine {
  private seq: SeqAllocator;
  private touched = new Map<string, Touched>();
  private ids: IdResolver;
  constructor(
    private ctx: MutationCtx,
    private profile: Doc<"profiles">,
    private deviceId: string,
  ) {
    this.seq = new SeqAllocator(ctx);
    this.ids = new IdResolver(ctx);
  }

  async applyAll(workspacePublicId: string, ops: SyncOp[]): Promise<ServerOpResult[]> {
    if (ops.length > MAX_BATCH) fail("limit_exceeded", `At most ${MAX_BATCH} operations per batch.`);
    const { workspace } = await requireWorkspace(this.ctx, this.profile, workspacePublicId, "viewer");
    const results: ServerOpResult[] = [];
    for (const op of ops) {
      results.push(await this.applyOne(workspace, op));
    }
    await this.finish();
    return results;
  }

  private async record(workspace: Doc<"workspaces">, op: SyncOp, result: ServerOpResult): Promise<void> {
    const entityId =
      op.kind === "block.upsert" ? op.block.id : op.kind === "document.create" ? op.document.id : "blockId" in op ? op.blockId : op.documentId;
    if (result.status === "duplicate") return;
    await this.ctx.db.insert("syncOperations", {
      opId: op.opId,
      profileId: this.profile._id,
      deviceId: this.deviceId,
      workspaceId: workspace._id,
      entityId,
      kind: op.kind,
      baseRevision: "baseRevision" in op ? op.baseRevision : undefined,
      status: result.status,
      resultRevision: result.revision,
      errorCode: result.error?.code,
      createdAt: Date.now(),
    });
    if (result.status === "rejected") await bump(this.ctx, "sync_rejected");
    if (result.status === "conflict") await bump(this.ctx, "sync_conflicts");
  }

  private async applyOne(workspace: Doc<"workspaces">, op: SyncOp): Promise<ServerOpResult> {
    if (typeof op.opId !== "string" || op.opId.length < 8 || op.opId.length > 64) {
      return { opId: String(op.opId), status: "rejected", error: { code: "invalid_op", message: "Invalid operation id." } };
    }
    const prior = await this.ctx.db
      .query("syncOperations")
      .withIndex("by_profile_op", (q) => q.eq("profileId", this.profile._id).eq("opId", op.opId))
      .unique();
    if (prior) return await this.replay(op, prior);

    let result: ServerOpResult;
    try {
      switch (op.kind) {
        case "block.upsert":
          result = await this.upsertBlock(workspace, op);
          break;
        case "block.delete":
          result = await this.deleteBlock(workspace, op);
          break;
        case "block.restore":
          result = await this.restoreBlock(workspace, op);
          break;
        case "document.create":
          result = await this.createDoc(workspace, op);
          break;
        case "document.update":
          result = await this.updateDoc(workspace, op);
          break;
        default:
          result = { opId: (op as SyncOp).opId, status: "rejected", error: { code: "unknown_op", message: "Unknown operation." } };
      }
    } catch (e) {
      const data = (e as { data?: { code?: string; message?: string } }).data;
      if (!data?.code) throw e;
      result = { opId: op.opId, status: "rejected", error: { code: data.code, message: data.message ?? data.code } };
    }
    await this.record(workspace, op, result);
    return result;
  }

  /** Duplicate delivery: never re-apply; report the original outcome against current server state. */
  private async replay(op: SyncOp, prior: Doc<"syncOperations">): Promise<ServerOpResult> {
    if (op.kind === "document.create" || op.kind === "document.update") {
      const id = op.kind === "document.create" ? op.document.id : op.documentId;
      const doc = await getDocumentByPublicId(this.ctx, id);
      if (prior.status === "rejected") return { opId: op.opId, status: "rejected", error: { code: prior.errorCode ?? "rejected", message: "Rejected earlier." } };
      return { opId: op.opId, status: "duplicate", revision: doc?.revision, document: doc ? await toSummary(this.ids, doc) : undefined };
    }
    const blockId = op.kind === "block.upsert" ? op.block.id : op.blockId;
    const row = await this.ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
      .unique();
    if (prior.status === "rejected") {
      return {
        opId: op.opId,
        status: "rejected",
        error: { code: prior.errorCode ?? "rejected", message: "Rejected earlier." },
        block: row ? toWireBlock(row) : null,
        deleted: row ? row.deletedAt !== undefined : undefined,
      };
    }
    if (prior.status === "conflict" && op.kind === "block.upsert" && row) {
      return {
        opId: op.opId,
        status: "conflict",
        revision: row.revision,
        block: toWireBlock(row),
        conflict: { reason: row.deletedAt ? "deleted" : "content", server: toWireBlock(row), client: op.block },
      };
    }
    return {
      opId: op.opId,
      status: "duplicate",
      revision: row?.revision,
      block: row ? toWireBlock(row) : null,
      deleted: row ? row.deletedAt !== undefined : undefined,
    };
  }

  private async writableDoc(workspace: Doc<"workspaces">, publicId: string): Promise<Doc<"documents">> {
    const doc = await getDocumentByPublicId(this.ctx, publicId);
    if (!doc) fail("not_found", "Document not found.");
    const access = await documentAccess(this.ctx, this.profile, doc);
    if (access === "none") fail("not_found", "Document not found.");
    if (!accessAtLeast(access, "write")) fail("forbidden", "You can't edit this document.");
    if (doc.workspaceId !== workspace._id) fail("forbidden", "Document belongs to another workspace.");
    if (doc.inTrash) fail("forbidden", "Restore this document from Trash to edit it.");
    return doc;
  }

  private touch(doc: Doc<"documents">, blockRowId?: Id<"blocks">) {
    let t = this.touched.get(doc._id);
    if (!t) {
      t = { doc, changedBlocks: new Set() };
      this.touched.set(doc._id, t);
    }
    if (blockRowId) t.changedBlocks.add(blockRowId);
  }

  private async findBlock(blockId: string): Promise<Doc<"blocks"> | null> {
    return await this.ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
      .unique();
  }

  /** Validates the parent pointer; returns the (possibly normalized) parent id. */
  private async checkParent(doc: Doc<"documents">, block: WireBlock): Promise<{ parentId: string | null; normalized: boolean }> {
    if (block.parentId === null) return { parentId: null, normalized: false };
    let cursor: string | null = block.parentId;
    let depth = 0;
    let first = true;
    while (cursor !== null) {
      if (cursor === block.id) fail("invalid_block", "A block cannot be nested inside itself.");
      const current: string = cursor;
      const parent: Doc<"blocks"> | null = await this.findBlock(current);
      if (!parent || parent.documentId !== doc._id || parent.deletedAt !== undefined) {
        if (first) return { parentId: null, normalized: true };
        break;
      }
      first = false;
      depth++;
      if (depth > LIMITS.maxDepth) fail("invalid_block", "Blocks are nested too deeply.");
      cursor = parent.parentId;
    }
    return { parentId: block.parentId, normalized: false };
  }

  private async upsertBlock(workspace: Doc<"workspaces">, op: Extract<SyncOp, { kind: "block.upsert" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(workspace, op.documentId);
    const incoming: WireBlock = { ...op.block };
    delete incoming.revision;
    const issues = validateWireBlock(incoming);
    if (issues.length) {
      const existingRow = await this.findBlock(incoming.id);
      return {
        opId: op.opId,
        status: "rejected",
        error: { code: "invalid_block", message: `${issues[0]!.path}: ${issues[0]!.message}` },
        block: existingRow && existingRow.documentId === doc._id ? toWireBlock(existingRow) : null,
      };
    }
    const existing = await this.findBlock(incoming.id);
    if (existing && existing.documentId !== doc._id) {
      return { opId: op.opId, status: "rejected", error: { code: "wrong_document", message: "Block belongs to another document." } };
    }
    const { parentId, normalized } = await this.checkParent(doc, incoming);
    const seq = await this.seq.for(doc.workspaceId);
    const now = Date.now();

    if (!existing) {
      if (doc.blockCount >= LIMITS.maxBlocksPerDocument) fail("limit_exceeded", "This document has too many blocks.");
      const rowId = await this.ctx.db.insert("blocks", {
        blockId: incoming.id,
        documentId: doc._id,
        workspaceId: doc.workspaceId,
        parentId,
        rank: incoming.rank,
        type: incoming.type,
        schemaVersion: incoming.schemaVersion,
        text: incoming.text,
        props: incoming.props,
        revision: 1,
        contentRev: 1,
        positionRev: 1,
        seq,
        createdAt: now,
        updatedAt: now,
        updatedBy: this.profile._id,
      });
      this.touch(doc, rowId);
      const row = (await this.ctx.db.get(rowId))!;
      return { opId: op.opId, status: "applied", revision: 1, block: toWireBlock(row), deleted: false, normalized: normalized || undefined };
    }

    if (existing.deletedAt !== undefined) {
      return {
        opId: op.opId,
        status: "conflict",
        revision: existing.revision,
        block: toWireBlock(existing),
        deleted: true,
        conflict: { reason: "deleted", server: toWireBlock(existing), client: incoming },
      };
    }

    const contentChanged = !sameContent(existing as unknown as WireBlock, incoming);
    const positionChanged = existing.parentId !== parentId || existing.rank !== incoming.rank;

    if (op.baseRevision === null) {
      if (contentChanged) {
        return {
          opId: op.opId,
          status: "conflict",
          revision: existing.revision,
          block: toWireBlock(existing),
          conflict: { reason: "exists", server: toWireBlock(existing), client: incoming },
        };
      }
      return { opId: op.opId, status: "applied", revision: existing.revision, block: toWireBlock(existing), deleted: false };
    }

    const wantsContent = op.fields.includes("content") && contentChanged;
    const wantsPosition = op.fields.includes("position") && positionChanged;
    const contentConflict = wantsContent && existing.contentRev > op.baseRevision;

    if (!wantsContent && !wantsPosition) {
      return { opId: op.opId, status: "applied", revision: existing.revision, block: toWireBlock(existing), deleted: false };
    }
    const revision = existing.revision + 1;
    const patch: Partial<Doc<"blocks">> = { revision, seq, updatedAt: now, updatedBy: this.profile._id };
    if (wantsContent && !contentConflict) {
      patch.type = incoming.type;
      patch.schemaVersion = incoming.schemaVersion;
      patch.text = incoming.text;
      patch.props = incoming.props;
      patch.contentRev = revision;
    }
    if (wantsPosition) {
      patch.parentId = parentId;
      patch.rank = incoming.rank;
      patch.positionRev = revision;
    }
    if (contentConflict && !wantsPosition) {
      return {
        opId: op.opId,
        status: "conflict",
        revision: existing.revision,
        block: toWireBlock(existing),
        conflict: { reason: "content", server: toWireBlock(existing), client: incoming },
      };
    }
    await this.ctx.db.patch(existing._id, patch);
    this.touch(doc, existing._id);
    const row = (await this.ctx.db.get(existing._id))!;
    if (contentConflict) {
      return {
        opId: op.opId,
        status: "conflict",
        revision: row.revision,
        block: toWireBlock(row),
        conflict: { reason: "content", server: toWireBlock(row), client: incoming },
      };
    }
    return { opId: op.opId, status: "applied", revision: row.revision, block: toWireBlock(row), deleted: false, normalized: normalized || undefined };
  }

  private async subtree(doc: Doc<"documents">, rootBlockId: string): Promise<Doc<"blocks">[]> {
    const all = await this.ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect();
    const byParent = new Map<string, Doc<"blocks">[]>();
    for (const b of all) {
      if (b.parentId === null) continue;
      const list = byParent.get(b.parentId);
      if (list) list.push(b);
      else byParent.set(b.parentId, [b]);
    }
    const out: Doc<"blocks">[] = [];
    const walk = (id: string, depth: number) => {
      if (depth > 64) return;
      for (const c of byParent.get(id) ?? []) {
        out.push(c);
        walk(c.blockId, depth + 1);
      }
    };
    walk(rootBlockId, 0);
    return out;
  }

  private async deleteBlock(workspace: Doc<"workspaces">, op: Extract<SyncOp, { kind: "block.delete" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(workspace, op.documentId);
    const row = await this.findBlock(op.blockId);
    if (!row || row.documentId !== doc._id) return { opId: op.opId, status: "applied", block: null, deleted: true };
    if (row.deletedAt !== undefined) return { opId: op.opId, status: "applied", revision: row.revision, block: toWireBlock(row), deleted: true };
    const seq = await this.seq.for(doc.workspaceId);
    const now = Date.now();
    const revision = row.revision + 1;
    await this.ctx.db.patch(row._id, { deletedAt: now, revision, positionRev: revision, seq, updatedAt: now, updatedBy: this.profile._id });
    this.touch(doc, row._id);
    for (const child of await this.subtree(doc, row.blockId)) {
      if (child.deletedAt !== undefined) continue;
      await this.ctx.db.patch(child._id, { deletedAt: now, revision: child.revision + 1, seq, updatedAt: now, updatedBy: this.profile._id });
      this.touch(doc, child._id);
    }
    const updated = (await this.ctx.db.get(row._id))!;
    return { opId: op.opId, status: "applied", revision, block: toWireBlock(updated), deleted: true };
  }

  private async restoreBlock(workspace: Doc<"workspaces">, op: Extract<SyncOp, { kind: "block.restore" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(workspace, op.documentId);
    const row = await this.findBlock(op.blockId);
    if (!row || row.documentId !== doc._id) return { opId: op.opId, status: "rejected", error: { code: "not_found", message: "Block not found." } };
    if (row.deletedAt === undefined) return { opId: op.opId, status: "applied", revision: row.revision, block: toWireBlock(row), deleted: false };
    const deletedAt = row.deletedAt;
    const seq = await this.seq.for(doc.workspaceId);
    const now = Date.now();
    let parentId = row.parentId;
    if (parentId) {
      const parent = await this.findBlock(parentId);
      if (!parent || parent.deletedAt !== undefined) parentId = null;
    }
    const revision = row.revision + 1;
    await this.ctx.db.patch(row._id, {
      deletedAt: undefined,
      parentId,
      revision,
      positionRev: revision,
      seq,
      updatedAt: now,
      updatedBy: this.profile._id,
    });
    this.touch(doc, row._id);
    for (const child of await this.subtree(doc, row.blockId)) {
      if (child.deletedAt !== deletedAt) continue;
      await this.ctx.db.patch(child._id, { deletedAt: undefined, revision: child.revision + 1, seq, updatedAt: now });
      this.touch(doc, child._id);
    }
    const updated = (await this.ctx.db.get(row._id))!;
    return { opId: op.opId, status: "applied", revision, block: toWireBlock(updated), deleted: false, normalized: parentId !== row.parentId || undefined };
  }

  private async createDoc(workspace: Doc<"workspaces">, op: Extract<SyncOp, { kind: "document.create" }>): Promise<ServerOpResult> {
    const input: WireDocumentCreate = op.document;
    await requireWorkspace(this.ctx, this.profile, workspace.publicId, "editor");
    const existing = await getDocumentByPublicId(this.ctx, input.id);
    if (existing) {
      if (existing.createdBy === this.profile._id && existing.workspaceId === workspace._id) {
        return { opId: op.opId, status: "applied", revision: existing.revision, document: await toSummary(this.ids, existing) };
      }
      return { opId: op.opId, status: "rejected", error: { code: "exists", message: "A document with this id already exists." } };
    }
    let parentDocumentId: Id<"documents"> | undefined;
    let accessMode: Doc<"documents">["accessMode"] = "workspace";
    if (input.parentDocumentId) {
      const parent = await this.writableDoc(workspace, input.parentDocumentId);
      parentDocumentId = parent._id;
      accessMode = parent.accessMode;
    }
    let folderId: Id<"folders"> | undefined;
    if (input.folderId) {
      const folder = await this.ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", input.folderId!))
        .unique();
      if (!folder || folder.workspaceId !== workspace._id || folder.deletedAt) fail("not_found", "Folder not found.");
      folderId = folder._id;
    }
    if (input.kind === "daily") {
      if (!input.dailyDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.dailyDate)) fail("invalid_argument", "Daily notes need a date.");
      const dup = await this.ctx.db
        .query("documents")
        .withIndex("by_daily", (q) => q.eq("workspaceId", workspace._id).eq("dailyOwnerId", this.profile._id).eq("dailyDate", input.dailyDate!))
        .first();
      if (dup) {
        return {
          opId: op.opId,
          status: "conflict",
          revision: dup.revision,
          document: await toSummary(this.ids, dup),
          conflict: { reason: "exists", server: null, client: null },
        };
      }
    }
    let blocks: WireBlock[] = [];
    let templateKey: string | undefined;
    if (input.templateId) {
      const template = await getDocumentByPublicId(this.ctx, input.templateId);
      if (template && template.kind === "template") {
        const access = await documentAccess(this.ctx, this.profile, template);
        if (accessAtLeast(access, "read")) {
          blocks = cloneBlocks((await liveBlocks(this.ctx, template._id)).map(toWireBlock));
          templateKey = template.publicId;
        }
      } else if (input.templateId.startsWith("builtin:")) {
        blocks = builtInTemplateBlocks(input.templateId.slice(8)) ?? [];
        templateKey = input.templateId;
      }
    }
    const doc = await createDocument(this.ctx, {
      workspaceId: workspace._id,
      actor: this.profile,
      publicId: input.id,
      title: input.title,
      icon: input.icon,
      kind: input.kind === "template" || input.kind === "daily" ? input.kind : "document",
      parentDocumentId,
      folderId,
      style: input.style,
      cover: input.cover,
      dailyDate: input.kind === "daily" ? (input.dailyDate ?? undefined) : undefined,
      dailyOwnerId: input.kind === "daily" ? this.profile._id : undefined,
      templateKey,
      accessMode,
      blocks,
    });
    return { opId: op.opId, status: "applied", revision: doc.revision, document: await toSummary(this.ids, doc) };
  }

  private async updateDoc(workspace: Doc<"workspaces">, op: Extract<SyncOp, { kind: "document.update" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(workspace, op.documentId);
    const patch: WireDocumentPatch = op.patch;
    const now = Date.now();
    const update: Partial<Doc<"documents">> = {};
    let titleConflict = false;
    if (patch.title !== undefined) {
      const title = sanitizeTitle(patch.title);
      if (title !== doc.title) {
        if (op.baseRevision !== null && doc.titleRev > op.baseRevision) titleConflict = true;
        else update.title = title;
      }
    }
    if (patch.icon !== undefined) update.icon = patch.icon ?? undefined;
    if (patch.cover !== undefined) update.cover = patch.cover;
    if (patch.style !== undefined) update.style = patch.style;
    if (patch.folderId !== undefined) {
      if (patch.folderId === null) update.folderId = undefined;
      else {
        const folder = await this.ctx.db
          .query("folders")
          .withIndex("by_public_id", (q) => q.eq("publicId", patch.folderId!))
          .unique();
        if (!folder || folder.workspaceId !== workspace._id || folder.deletedAt) fail("not_found", "Folder not found.");
        update.folderId = folder._id;
      }
    }
    if (patch.parentDocumentId !== undefined) {
      if (patch.parentDocumentId === null) update.parentDocumentId = undefined;
      else {
        const parent = await this.writableDoc(workspace, patch.parentDocumentId);
        // Reject cycles: the new parent may not be a descendant of this document.
        let cursor: Doc<"documents"> | null = parent;
        for (let i = 0; cursor && i < 32; i++) {
          if (cursor._id === doc._id) fail("invalid_argument", "A page can't be moved inside itself.");
          cursor = cursor.parentDocumentId ? await this.ctx.db.get(cursor.parentDocumentId) : null;
        }
        update.parentDocumentId = parent._id;
      }
    }
    const changed = Object.keys(update).length > 0;
    if (changed) {
      const seq = await this.seq.for(doc.workspaceId);
      const revision = doc.revision + 1;
      await this.ctx.db.patch(doc._id, {
        ...update,
        revision,
        titleRev: update.title !== undefined ? revision : doc.titleRev,
        seq,
        updatedAt: now,
        lastEditedBy: this.profile._id,
      });
      if (update.title !== undefined) await refreshDerived(this.ctx, (await this.ctx.db.get(doc._id))!);
    }
    const fresh = (await this.ctx.db.get(doc._id))!;
    const summary = await toSummary(this.ids, fresh);
    if (titleConflict) {
      return { opId: op.opId, status: "conflict", revision: fresh.revision, document: summary, conflict: { reason: "content", server: null, client: null } };
    }
    return { opId: op.opId, status: "applied", revision: fresh.revision, document: summary };
  }

  /** Post-batch bookkeeping: derived text, task projections, links, document revision/seq. */
  private async finish(): Promise<void> {
    for (const { doc, changedBlocks } of this.touched.values()) {
      if (changedBlocks.size === 0) continue;
      const fresh = (await this.ctx.db.get(doc._id))!;
      const seq = await this.seq.for(fresh.workspaceId);
      await this.ctx.db.patch(fresh._id, {
        updatedAt: Date.now(),
        lastEditedBy: this.profile._id,
        contentSeq: fresh.contentSeq + 1,
        seq,
      });
      for (const rowId of changedBlocks) {
        const row = await this.ctx.db.get(rowId);
        if (!row) continue;
        await syncTaskProjection(this.ctx, row, fresh, this.profile._id);
        await syncLinks(this.ctx, fresh, row);
      }
      await refreshDerived(this.ctx, (await this.ctx.db.get(fresh._id))!);
    }
  }
}

/** Maintains the backlink index for one block. */
export async function syncLinks(ctx: MutationCtx, doc: Doc<"documents">, row: Doc<"blocks">): Promise<void> {
  const existing = await ctx.db
    .query("documentLinks")
    .withIndex("by_source_block", (q) => q.eq("sourceDocumentId", doc._id).eq("blockId", row.blockId))
    .collect();
  const targets = new Set<string>();
  if (row.deletedAt === undefined) {
    if (row.type === "page" && typeof (row.props as { documentId?: unknown }).documentId === "string") {
      targets.add((row.props as { documentId: string }).documentId);
    }
    const scan = (nodes: unknown) => {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        if (n && typeof n === "object" && (n as { type?: string }).type === "pageLink") {
          const id = (n as { documentId?: unknown }).documentId;
          if (typeof id === "string") targets.add(id);
        }
      }
    };
    scan(row.text);
    if (row.type === "table") for (const r of ((row.props as { rows?: unknown[][] }).rows ?? [])) for (const c of r) scan(c);
  }
  targets.delete(doc.publicId);
  const have = new Set(existing.map((l) => l.targetPublicId));
  for (const l of existing) if (!targets.has(l.targetPublicId)) await ctx.db.delete(l._id);
  for (const t of targets) {
    if (!have.has(t)) await ctx.db.insert("documentLinks", { workspaceId: doc.workspaceId, sourceDocumentId: doc._id, targetPublicId: t, blockId: row.blockId });
  }
}
