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
import { accessAtLeast, documentAccess, getDocumentByPublicId, membership, roleAtLeast } from "./auth";
import { IdResolver, liveBlocks, refreshDerived, sanitizeTitle, syncTaskProjection, toSummary, toWireBlock, type DocumentSummary } from "./documents";
import { createDocument, cloneBlocks } from "./create";
import { builtInTemplateBlocks } from "./templates";
import { bump } from "./metrics";

/** A page backdrop is "art:<artwork id>" or "color:<name>"; anything else is dropped. */
const BACKDROP = /^(art:[a-z0-9-]{1,40}|color:[a-z]{1,20})$/;
function checkedStyle<T extends { backdrop?: string }>(style: T): T {
  if (style.backdrop === undefined || BACKDROP.test(style.backdrop)) return style;
  const { backdrop: _dropped, ...rest } = style;
  void _dropped;
  return rest as T;
}
import { SeqAllocator } from "./seq";
import { fail } from "./errors";
import { mentionedIds, notify } from "./notify";

export const MAX_BATCH = 100;

export type ServerOpResult = OpResult & { document?: DocumentSummary };

interface Touched {
  doc: Doc<"documents">;
  changedBlocks: Set<Id<"blocks">>;
}

export class SyncEngine {
  private seq: SeqAllocator;
  private touched = new Map<string, Touched>();
  /** People newly @-mentioned in block text during this batch (notified after the batch applies). */
  private newMentions: { doc: Doc<"documents">; blockId: string; userIds: string[]; excerpt: string }[] = [];
  private ids: IdResolver;
  /** The batch's routing workspace (see docs/SYNC_PROTOCOL.md §Routing); null when the caller isn't a member. */
  private routing: Doc<"workspaces"> | null = null;
  constructor(
    private ctx: MutationCtx,
    private profile: Doc<"profiles">,
    private deviceId: string,
  ) {
    this.seq = new SeqAllocator(ctx);
    this.ids = new IdResolver(ctx);
  }

  /**
   * Applies a batch. Operations are authorized one by one against the document they touch, so a batch
   * may freely mix documents from several workspaces (shared pages, deep links from another workspace).
   * `routingWorkspacePublicId` only decides where a `document.create` without a parent (and without its
   * own `workspaceId`) is created.
   */
  async applyAll(routingWorkspacePublicId: string | null, ops: SyncOp[]): Promise<ServerOpResult[]> {
    if (ops.length > MAX_BATCH) fail("limit_exceeded", `At most ${MAX_BATCH} operations per batch.`);
    this.routing = routingWorkspacePublicId ? await this.memberWorkspace(routingWorkspacePublicId) : null;
    const results: ServerOpResult[] = [];
    for (const op of ops) {
      results.push(await this.applyOne(op));
    }
    await this.finish();
    return results;
  }

  /** A workspace the caller belongs to, or null (never reveals whether a foreign workspace exists). */
  private async memberWorkspace(publicId: string): Promise<Doc<"workspaces"> | null> {
    const workspace = await this.ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique();
    if (!workspace || workspace.status === "deleting") return null;
    return (await membership(this.ctx, this.profile._id, workspace._id)) ? workspace : null;
  }

  /** Workspace an op is recorded under: the touched document's, else the routing/default workspace. */
  private async recordWorkspace(op: SyncOp): Promise<Id<"workspaces"> | null> {
    const candidates = op.kind === "document.create" ? [op.document.id, op.document.parentDocumentId] : [op.documentId];
    for (const id of candidates) {
      const doc = typeof id === "string" ? await getDocumentByPublicId(this.ctx, id) : null;
      if (doc) return doc.workspaceId;
    }
    if (op.kind === "document.create" && op.document.workspaceId) {
      const target = await this.memberWorkspace(op.document.workspaceId);
      if (target) return target._id;
    }
    return this.routing?._id ?? this.profile.defaultWorkspaceId ?? null;
  }

  private async record(op: SyncOp, result: ServerOpResult): Promise<void> {
    const entityId =
      op.kind === "block.upsert" ? op.block.id : op.kind === "document.create" ? op.document.id : "blockId" in op ? op.blockId : op.documentId;
    if (result.status === "duplicate") return;
    const workspaceId = await this.recordWorkspace(op);
    // Every signed-in profile has a default workspace; without one there is nothing to attribute the op to.
    if (!workspaceId) return;
    await this.ctx.db.insert("syncOperations", {
      opId: op.opId,
      profileId: this.profile._id,
      deviceId: this.deviceId,
      workspaceId,
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

  private async applyOne(op: SyncOp): Promise<ServerOpResult> {
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
          result = await this.upsertBlock(op);
          break;
        case "block.delete":
          result = await this.deleteBlock(op);
          break;
        case "block.restore":
          result = await this.restoreBlock(op);
          break;
        case "document.create":
          result = await this.createDoc(op);
          break;
        case "document.update":
          result = await this.updateDoc(op);
          break;
        default:
          result = { opId: (op as SyncOp).opId, status: "rejected", error: { code: "unknown_op", message: "Unknown operation." } };
      }
    } catch (e) {
      const data = (e as { data?: { code?: string; message?: string } }).data;
      if (!data?.code) throw e;
      result = { opId: op.opId, status: "rejected", error: { code: data.code, message: data.message ?? data.code } };
    }
    await this.record(op, result);
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

  /** Write access is decided per document (workspace role or an explicit grant), never by the batch's workspace. */
  private async writableDoc(publicId: string): Promise<Doc<"documents">> {
    const doc = await getDocumentByPublicId(this.ctx, publicId);
    if (!doc) fail("not_found", "Document not found.");
    const access = await documentAccess(this.ctx, this.profile, doc);
    if (access === "none") fail("not_found", "Document not found.");
    if (!accessAtLeast(access, "write")) fail("forbidden", "You can't edit this document.");
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

  private async upsertBlock(op: Extract<SyncOp, { kind: "block.upsert" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(op.documentId);
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
      this.trackMentions(doc, [], incoming);
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
    if (patch.text !== undefined) this.trackMentions(doc, existing.text, incoming);
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

  private async deleteBlock(op: Extract<SyncOp, { kind: "block.delete" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(op.documentId);
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

  private async restoreBlock(op: Extract<SyncOp, { kind: "block.restore" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(op.documentId);
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

  /**
   * Where a new page goes: under its parent (same workspace), else the op's own `workspaceId`, else the
   * batch's routing workspace. Creating pages needs editor membership of that workspace — people who
   * only hold a grant on a shared page can edit it but not add pages to someone else's workspace.
   */
  private async createTarget(input: WireDocumentCreate): Promise<{ workspace: Doc<"workspaces">; parent: Doc<"documents"> | null }> {
    let parent: Doc<"documents"> | null = null;
    let workspace: Doc<"workspaces"> | null;
    if (input.parentDocumentId) {
      parent = await this.writableDoc(input.parentDocumentId);
      workspace = await this.ctx.db.get(parent.workspaceId);
    } else if (input.workspaceId) {
      workspace = await this.memberWorkspace(input.workspaceId);
      if (!workspace) fail("not_found", "Workspace not found.");
    } else {
      workspace = this.routing;
      if (!workspace) fail("not_found", "Workspace not found.");
    }
    if (!workspace) fail("not_found", "Workspace not found.");
    const member = await membership(this.ctx, this.profile._id, workspace._id);
    if (!member || !roleAtLeast(member.role, "editor")) fail("forbidden", "You can't add pages to this workspace.");
    if (workspace.status === "suspended" && member.role !== "owner") fail("suspended", "This workspace is suspended.");
    return { workspace, parent };
  }

  private async createDoc(op: Extract<SyncOp, { kind: "document.create" }>): Promise<ServerOpResult> {
    const input: WireDocumentCreate = op.document;
    const existing = await getDocumentByPublicId(this.ctx, input.id);
    if (existing) {
      // A replay through another path (or after a lost ack) of our own create.
      if (existing.createdBy === this.profile._id) {
        return { opId: op.opId, status: "applied", revision: existing.revision, document: await toSummary(this.ids, existing) };
      }
      return { opId: op.opId, status: "rejected", error: { code: "exists", message: "A document with this id already exists." } };
    }
    const { workspace, parent } = await this.createTarget(input);
    let parentDocumentId: Id<"documents"> | undefined;
    let accessMode: Doc<"documents">["accessMode"] = "workspace";
    if (parent) {
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
      if (input.templateId.startsWith("builtin:")) {
        const key = input.templateId.slice(8);
        const found = builtInTemplateBlocks(key);
        // Admins can switch built-in templates off (admin console); that is enforced here, not only in the picker.
        if (!found || !(await builtInTemplateEnabled(this.ctx, key))) fail("not_found", "That template is no longer available.");
        blocks = found;
        templateKey = input.templateId;
      } else {
        const template = await getDocumentByPublicId(this.ctx, input.templateId);
        if (!template || template.kind !== "template" || template.inTrash) fail("not_found", "That template is no longer available.");
        if (!accessAtLeast(await documentAccess(this.ctx, this.profile, template), "read")) fail("not_found", "That template is no longer available.");
        blocks = cloneBlocks((await liveBlocks(this.ctx, template._id)).map(toWireBlock));
        templateKey = template.publicId;
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
      style: input.style ? checkedStyle(input.style) : undefined,
      cover: input.cover ? await this.checkedCover(input.cover, workspace._id) : undefined,
      dailyDate: input.kind === "daily" ? (input.dailyDate ?? undefined) : undefined,
      dailyOwnerId: input.kind === "daily" ? this.profile._id : undefined,
      templateKey,
      accessMode,
      blocks,
    });
    return { opId: op.opId, status: "applied", revision: doc.revision, document: await toSummary(this.ids, doc) };
  }

  /**
   * A note style image must be an image already uploaded into this workspace; anything else is refused
   * (the client never gets to point a note at someone else's file).
   */
  private async checkedCover(cover: Doc<"documents">["cover"], workspaceId: Id<"workspaces">): Promise<Doc<"documents">["cover"]> {
    if (cover.kind !== "image") return cover;
    const fileId = cover.value;
    const file = fileId
      ? await this.ctx.db
          .query("files")
          .withIndex("by_public_id", (q) => q.eq("publicId", fileId))
          .unique()
      : null;
    if (!file || file.workspaceId !== workspaceId || file.status !== "ready" || (file.kind !== "cover" && file.kind !== "image")) fail("invalid_argument", "That image can't be used as a note style.");
    return { kind: "image", value: file.publicId };
  }

  private async updateDoc(op: Extract<SyncOp, { kind: "document.update" }>): Promise<ServerOpResult> {
    const doc = await this.writableDoc(op.documentId);
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
    // Notes always keep an icon: an icon can be changed, not removed.
    if (patch.icon) update.icon = patch.icon;
    if (patch.cover !== undefined) update.cover = await this.checkedCover(patch.cover, doc.workspaceId);
    if (patch.style !== undefined) update.style = checkedStyle(patch.style);
    if (patch.folderId !== undefined) {
      if (patch.folderId === null) update.folderId = undefined;
      else {
        const folder = await this.ctx.db
          .query("folders")
          .withIndex("by_public_id", (q) => q.eq("publicId", patch.folderId!))
          .unique();
        if (!folder || folder.workspaceId !== doc.workspaceId || folder.deletedAt) fail("not_found", "Folder not found.");
        update.folderId = folder._id;
      }
    }
    if (patch.parentDocumentId !== undefined) {
      if (patch.parentDocumentId === null) update.parentDocumentId = undefined;
      else {
        const parent = await this.writableDoc(patch.parentDocumentId);
        if (parent.workspaceId !== doc.workspaceId) fail("invalid_argument", "A page can only be moved under a page in the same workspace.");
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
      if ("title" in update || "icon" in update) {
        await refreshLinkLabels(this.ctx, (await this.ctx.db.get(doc._id))!, this.profile._id);
      }
    }
    const fresh = (await this.ctx.db.get(doc._id))!;
    const summary = await toSummary(this.ids, fresh);
    if (titleConflict) {
      return { opId: op.opId, status: "conflict", revision: fresh.revision, document: summary, conflict: { reason: "content", server: null, client: null } };
    }
    return { opId: op.opId, status: "applied", revision: fresh.revision, document: summary };
  }

  private trackMentions(doc: Doc<"documents">, before: unknown, after: WireBlock) {
    const had = new Set(mentionedIds(before));
    const added = mentionedIds(after.text).filter((id) => !had.has(id) && id !== this.profile._id);
    if (!added.length) return;
    const excerpt = after.text.map((n) => (n.type === "text" ? n.text : n.type === "mention" ? `@${n.label}` : n.type === "date" ? n.date : n.label)).join("").slice(0, 140);
    this.newMentions.push({ doc, blockId: after.id, userIds: added, excerpt });
  }

  /** Post-batch bookkeeping: derived text, task projections, links, document revision/seq. */
  private async finish(): Promise<void> {
    for (const m of this.newMentions) {
      for (const id of m.userIds) {
        const recipientId = this.ctx.db.normalizeId("profiles", id);
        if (!recipientId) continue;
        await notify(this.ctx, {
          recipientId,
          actor: this.profile,
          kind: "mention",
          doc: m.doc,
          blockId: m.blockId,
          title: `${this.profile.displayName} mentioned you in ${m.doc.title || "Untitled"}`,
          excerpt: m.excerpt,
          email: { key: "mention_notification" },
        });
      }
    }
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

/** Whether an admin has switched a built-in template off (rows exist only once toggled). */
export async function builtInTemplateEnabled(ctx: MutationCtx, key: string): Promise<boolean> {
  const row = await ctx.db
    .query("builtInTemplates")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row ? row.enabled : true;
}

/**
 * Pages that link to `doc` cache its title (page blocks: `props.titleCache`/`iconCache`; inline links:
 * the `pageLink` label). When the title or icon changes, rewrite those caches so outlines, exports,
 * share views and search show the current name. The rewrite bumps `revision`/`seq` (clients pick it up
 * like any remote change) but not `contentRev`: it is derived data, so it never turns a concurrent edit
 * of the same block into a conflict — at worst that edit re-writes the old label, which the next rename
 * refreshes again.
 */
export async function refreshLinkLabels(ctx: MutationCtx, doc: Doc<"documents">, actor: Id<"profiles">): Promise<void> {
  const links = await ctx.db
    .query("documentLinks")
    .withIndex("by_target", (q) => q.eq("targetPublicId", doc.publicId))
    .take(500);
  const title = doc.title || "Untitled";
  const icon = doc.icon ?? null;
  const touchedDocs = new Set<Id<"documents">>();
  const seqs = new SeqAllocator(ctx);
  const relabel = (nodes: unknown): { nodes: unknown; changed: boolean } => {
    if (!Array.isArray(nodes)) return { nodes, changed: false };
    let changed = false;
    const out = nodes.map((n) => {
      if (n && typeof n === "object" && (n as { type?: string }).type === "pageLink" && (n as { documentId?: string }).documentId === doc.publicId) {
        if ((n as { label?: string }).label !== title) {
          changed = true;
          return { ...(n as object), label: title };
        }
      }
      return n;
    });
    return { nodes: out, changed };
  };
  const seen = new Set<string>();
  for (const link of links) {
    const key = `${link.sourceDocumentId}:${link.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = await ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", link.blockId))
      .unique();
    if (!row || row.deletedAt !== undefined || row.documentId !== link.sourceDocumentId) continue;
    const patch: Partial<Doc<"blocks">> = {};
    const props = row.props as Record<string, unknown>;
    if (row.type === "page" && props.documentId === doc.publicId) {
      const nextProps: Record<string, unknown> = { ...props, titleCache: title };
      if (icon) nextProps.iconCache = icon;
      else delete nextProps.iconCache;
      if (props.titleCache !== title || (props.iconCache ?? null) !== icon) patch.props = nextProps;
    }
    const text = relabel(row.text);
    if (text.changed) patch.text = text.nodes as Doc<"blocks">["text"];
    if (row.type === "table") {
      const rows = (props.rows as unknown[][] | undefined) ?? [];
      let changed = false;
      const nextRows = rows.map((r) =>
        r.map((cell) => {
          const c = relabel(cell);
          if (c.changed) changed = true;
          return c.nodes;
        }),
      );
      if (changed) patch.props = { ...((patch.props as Record<string, unknown> | undefined) ?? props), rows: nextRows };
    }
    if (!Object.keys(patch).length) continue;
    const seq = await seqs.for(row.workspaceId);
    await ctx.db.patch(row._id, { ...patch, revision: row.revision + 1, seq, updatedAt: Date.now(), updatedBy: actor });
    touchedDocs.add(row.documentId);
  }
  for (const id of touchedDocs) {
    const source = await ctx.db.get(id);
    if (source) await refreshDerived(ctx, source);
  }
}
