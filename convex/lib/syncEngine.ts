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
import { accessAtLeast, documentAccess, documentAccessInfo, getDocumentByPublicId, membership, memberAtLeast, memberLevel, isScheduledForDeletion, DELETION_SCHEDULED_MESSAGE } from "./auth";
import { IdResolver, liveBlocks, Placement, refreshDerived, sanitizeTitle, syncTaskProjection, toWireBlock, type DocumentSummary } from "./documents";
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
import { hasValidScope, inScope, insertScoped, personalScope, sameScopeRows, scopeOfRow, workspaceScope, type Scope, type ScopeArg } from "./scope";
import { fail } from "./errors";
import { mentionedIds, notify } from "./notify";
import { ReaderLabels, titleIsShared } from "./linkLabels";

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
  /**
   * The batch's routing scope (see docs/SYNC_PROTOCOL.md §Routing): the caller's Personal, or a workspace
   * they're a member of; null when they named a workspace they aren't in.
   */
  private routing: Scope | null = null;
  constructor(
    private ctx: MutationCtx,
    private profile: Doc<"profiles">,
    private deviceId: string,
  ) {
    this.seq = new SeqAllocator(ctx);
    this.ids = new IdResolver(ctx);
  }

  /**
   * A page as returned to the caller: no folder id for a guest, no parent they can't open (Placement).
   * A fresh Placement each time, since a batch can move pages and change what's open.
   */
  private async summary(doc: Doc<"documents">): Promise<DocumentSummary> {
    return await new Placement(this.ctx, this.profile).summary(this.ids, doc);
  }

  /**
   * Applies a batch. Operations are authorized one by one against the document they touch, so a batch
   * may freely mix documents from several scopes (shared pages, deep links from a workspace). `routing`
   * only decides where a `document.create` without a parent (and without its own scope) is created.
   */
  async applyAll(routing: ScopeArg | null, ops: SyncOp[]): Promise<ServerOpResult[]> {
    if (ops.length > MAX_BATCH) fail("limit_exceeded", `At most ${MAX_BATCH} operations per batch.`);
    this.routing = routing ? await this.memberScope(routing) : null;
    const results: ServerOpResult[] = [];
    for (const op of ops) {
      results.push(await this.applyOne(op));
    }
    await this.finish();
    // Blocks go back with link labels this person may see (lib/linkLabels.ts), like every other read.
    const labels = new ReaderLabels(this.ctx, this.profile);
    for (const r of results) {
      if (r.block) r.block = await labels.block(r.block);
      if (r.conflict?.server) r.conflict = { ...r.conflict, server: await labels.block(r.conflict.server) };
    }
    return results;
  }

  /**
   * A scope the caller may create in, or null: their own Personal (a client never names someone else's),
   * or a team workspace they belong to (never reveals whether a foreign workspace exists).
   */
  private async memberScope(arg: ScopeArg): Promise<Scope | null> {
    if (arg.kind === "personal") return personalScope(this.profile._id);
    const workspace = await this.ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", arg.workspaceId))
      .unique();
    if (!workspace || workspace.status === "deleting") return null;
    return (await membership(this.ctx, this.profile._id, workspace._id)) ? workspaceScope(workspace._id) : null;
  }

  /**
   * The scope a create op names itself: `scope`, or the older `workspaceId` field. Ops pushed as JSON
   * (pushJson) aren't checked by Convex validators, so the shape is checked here; a malformed scope is
   * null (createTarget refuses it).
   */
  private createScopeArg(input: WireDocumentCreate): ScopeArg | null {
    const scope = input.scope as unknown;
    if (scope && typeof scope === "object") {
      const s = scope as { kind?: unknown; workspaceId?: unknown };
      if (s.kind === "personal") return { kind: "personal" };
      if (s.kind === "workspace" && typeof s.workspaceId === "string") return { kind: "workspace", workspaceId: s.workspaceId };
      return null;
    }
    return typeof input.workspaceId === "string" && input.workspaceId ? { kind: "workspace", workspaceId: input.workspaceId } : null;
  }

  /** Scope an op is recorded under: the touched document's, else the one it names, the routing scope or the caller's Personal. */
  private async recordScope(op: SyncOp): Promise<Scope> {
    const candidates = op.kind === "document.create" ? [op.document.id, op.document.parentDocumentId] : [op.documentId];
    for (const id of candidates) {
      const doc = typeof id === "string" ? await getDocumentByPublicId(this.ctx, id) : null;
      if (doc && hasValidScope(doc)) return scopeOfRow(doc);
    }
    const named = op.kind === "document.create" ? this.createScopeArg(op.document) : null;
    if (named) {
      const target = await this.memberScope(named);
      if (target) return target;
    }
    return this.routing ?? personalScope(this.profile._id);
  }

  private async record(op: SyncOp, result: ServerOpResult): Promise<void> {
    const entityId =
      op.kind === "block.upsert" ? op.block.id : op.kind === "document.create" ? op.document.id : "blockId" in op ? op.blockId : op.documentId;
    if (result.status === "duplicate") return;
    await insertScoped(this.ctx, "syncOperations", await this.recordScope(op), {
      opId: op.opId,
      profileId: this.profile._id,
      deviceId: this.deviceId,
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

  /** Whether the caller may still read `doc` (a replay never returns what they can't open now). */
  private async readable(doc: Doc<"documents"> | null): Promise<Doc<"documents"> | null> {
    return doc && (await documentAccess(this.ctx, this.profile, doc)) !== "none" ? doc : null;
  }

  /**
   * Duplicate delivery: never re-apply; report the original outcome against current server state. Only
   * for the same operation: an op id reused for another page or block is refused, and the current state
   * is only returned if the caller can still read it.
   */
  private async replay(op: SyncOp, prior: Doc<"syncOperations">): Promise<ServerOpResult> {
    const entityId = op.kind === "block.upsert" ? op.block.id : op.kind === "document.create" ? op.document.id : "blockId" in op ? op.blockId : op.documentId;
    if (entityId !== prior.entityId || op.kind !== prior.kind) {
      return { opId: op.opId, status: "rejected", error: { code: "invalid_op", message: "This operation id was already used for something else." } };
    }
    if (op.kind === "document.create" || op.kind === "document.update") {
      const id = op.kind === "document.create" ? op.document.id : op.documentId;
      const doc = await this.readable(await getDocumentByPublicId(this.ctx, id));
      if (prior.status === "rejected") return { opId: op.opId, status: "rejected", error: { code: prior.errorCode ?? "rejected", message: "Rejected earlier." } };
      return { opId: op.opId, status: "duplicate", revision: doc?.revision, document: doc ? await this.summary(doc) : undefined };
    }
    const blockId = op.kind === "block.upsert" ? op.block.id : op.blockId;
    const found = await this.ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
      .unique();
    const row = found && (await this.readable(await this.ctx.db.get(found.documentId))) ? found : null;
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
    const seq = await this.seq.for(scopeOfRow(doc));
    const now = Date.now();

    if (!existing) {
      if (doc.blockCount >= LIMITS.maxBlocksPerDocument) fail("limit_exceeded", "This document has too many blocks.");
      const rowId = await insertScoped(this.ctx, "blocks", scopeOfRow(doc), {
        blockId: incoming.id,
        documentId: doc._id,
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
    const seq = await this.seq.for(scopeOfRow(doc));
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
    const seq = await this.seq.for(scopeOfRow(doc));
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
   * Where a new page goes: under its parent (always the parent's scope), else the scope the op names,
   * else the batch's routing scope. Adding pages to Personal is for its owner only; to a workspace it
   * needs editor membership. People who only hold a grant on a shared page (guests) can edit it but not
   * add pages to someone else's Personal or workspace.
   */
  private async createTarget(input: WireDocumentCreate): Promise<{ scope: Scope; parent: Doc<"documents"> | null }> {
    let parent: Doc<"documents"> | null = null;
    let scope: Scope | null;
    const named = this.createScopeArg(input);
    if (input.parentDocumentId) {
      parent = await this.writableDoc(input.parentDocumentId);
      scope = scopeOfRow(parent);
    } else if (input.scope && !named) {
      fail("invalid_argument", "Unknown place to create the page in.");
    } else if (named) {
      scope = await this.memberScope(named);
    } else {
      scope = this.routing;
    }
    if (!scope) fail("not_found", "Workspace not found.");
    if (scope.kind === "personal") {
      if (scope.profileId !== this.profile._id) fail("forbidden", "You can't add pages here.");
      return { scope, parent };
    }
    const workspace = await this.ctx.db.get(scope.workspaceId);
    if (!workspace || workspace.status === "deleting") fail("not_found", "Workspace not found.");
    const member = await membership(this.ctx, this.profile._id, workspace._id);
    if (!memberAtLeast(member, "edit")) fail("forbidden", "You can't add pages to this workspace.");
    if (isScheduledForDeletion(workspace)) fail("forbidden", DELETION_SCHEDULED_MESSAGE);
    if (workspace.status === "suspended" && memberLevel(member!) !== "owner") fail("suspended", "This workspace is suspended.");
    return { scope, parent };
  }

  private async createDoc(op: Extract<SyncOp, { kind: "document.create" }>): Promise<ServerOpResult> {
    const input: WireDocumentCreate = op.document;
    const existing = await getDocumentByPublicId(this.ctx, input.id);
    if (existing) {
      // A replay through another path (or after a lost ack) of our own create, if we can still open it.
      if (existing.createdBy === this.profile._id && (await this.readable(existing))) {
        return { opId: op.opId, status: "applied", revision: existing.revision, document: await this.summary(existing) };
      }
      return { opId: op.opId, status: "rejected", error: { code: "exists", message: "A document with this id already exists." } };
    }
    const { scope, parent } = await this.createTarget(input);
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
      if (!folder || !inScope(folder, scope) || folder.deletedAt) fail("not_found", "Folder not found.");
      folderId = folder._id;
    }
    if (input.kind === "daily") {
      const date = input.dailyDate;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("invalid_argument", "Daily notes need a date.");
      const base = this.ctx.db.query("documents");
      const dup = await (
        scope.kind === "personal"
          ? base.withIndex("by_owner_daily", (q) => q.eq("ownerProfileId", scope.profileId).eq("dailyOwnerId", this.profile._id).eq("dailyDate", date))
          : base.withIndex("by_daily", (q) => q.eq("workspaceId", scope.workspaceId).eq("dailyOwnerId", this.profile._id).eq("dailyDate", date))
      ).first();
      if (dup) {
        return {
          opId: op.opId,
          status: "conflict",
          revision: dup.revision,
          document: await this.summary(dup),
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
      scope,
      actor: this.profile,
      publicId: input.id,
      title: input.title,
      icon: input.icon,
      kind: input.kind === "template" || input.kind === "daily" ? input.kind : "document",
      parentDocumentId,
      folderId,
      style: input.style ? checkedStyle(input.style) : undefined,
      cover: input.cover ? await this.checkedCover(input.cover, scope) : undefined,
      dailyDate: input.kind === "daily" ? (input.dailyDate ?? undefined) : undefined,
      dailyOwnerId: input.kind === "daily" ? this.profile._id : undefined,
      templateKey,
      accessMode,
      blocks,
    });
    return { opId: op.opId, status: "applied", revision: doc.revision, document: await this.summary(doc) };
  }

  /**
   * A note style image must be an image already uploaded into the note's own scope; anything else is
   * refused (the client never gets to point a note at someone else's file).
   */
  private async checkedCover(cover: Doc<"documents">["cover"], scope: Scope): Promise<Doc<"documents">["cover"]> {
    if (cover.kind !== "image") return cover;
    const fileId = cover.value;
    const file = fileId
      ? await this.ctx.db
          .query("files")
          .withIndex("by_public_id", (q) => q.eq("publicId", fileId))
          .unique()
      : null;
    if (!file || !inScope(file, scope) || file.status !== "ready" || (file.kind !== "cover" && file.kind !== "image")) fail("invalid_argument", "That image can't be used as a note style.");
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
    if (patch.cover !== undefined) update.cover = await this.checkedCover(patch.cover, scopeOfRow(doc));
    if (patch.style !== undefined) update.style = checkedStyle(patch.style);
    // Moving a page: guests (a page grant, no membership) may only rearrange pages among what was shared
    // with them (never file pages in the scope's folders or put them at its top level), and taking a
    // page out from under a restricted page (which would open it up) needs manage access.
    const moving = patch.folderId !== undefined || patch.parentDocumentId !== undefined;
    const info = moving ? await documentAccessInfo(this.ctx, this.profile, doc) : null;
    if (patch.folderId !== undefined) {
      let folderId: Id<"folders"> | undefined;
      if (patch.folderId !== null) {
        const folder = await this.ctx.db
          .query("folders")
          .withIndex("by_public_id", (q) => q.eq("publicId", patch.folderId!))
          .unique();
        if (!folder || !sameScopeRows(folder, doc) || folder.deletedAt) fail("not_found", "Folder not found.");
        folderId = folder._id;
      }
      if (folderId !== doc.folderId && !info!.inScope) fail("forbidden", "Only members can move pages between folders.");
      update.folderId = folderId;
    }
    if (patch.parentDocumentId !== undefined) {
      let parent: Doc<"documents"> | null = null;
      if (patch.parentDocumentId === null) {
        if (doc.parentDocumentId !== undefined && !info!.inScope) fail("forbidden", "Only members can move a page to the top level.");
        update.parentDocumentId = undefined;
      } else {
        parent = await this.writableDoc(patch.parentDocumentId);
        // Pages never move between Personal and a workspace (or between workspaces) by moving them.
        if (!sameScopeRows(parent, doc)) fail("invalid_argument", "A page can only be moved under a page in the same place.");
        // Reject cycles: the new parent may not be a descendant of this document.
        let cursor: Doc<"documents"> | null = parent;
        for (let i = 0; cursor && i < 32; i++) {
          if (cursor._id === doc._id) fail("invalid_argument", "A page can't be moved inside itself.");
          cursor = cursor.parentDocumentId ? await this.ctx.db.get(cursor.parentDocumentId) : null;
        }
        update.parentDocumentId = parent._id;
      }
      if (info!.restricted && !accessAtLeast(info!.access, "manage") && (parent?._id ?? undefined) !== doc.parentDocumentId) {
        const stillRestricted = doc.accessMode === "restricted" || (parent !== null && (await documentAccessInfo(this.ctx, this.profile, parent)).restricted);
        if (!stillRestricted) fail("forbidden", "Only people who manage this page can move it out of a restricted page.");
      }
    }
    const changed = Object.keys(update).length > 0;
    if (changed) {
      const seq = await this.seq.for(scopeOfRow(doc));
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
    const summary = await this.summary(fresh);
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
      const seq = await this.seq.for(scopeOfRow(fresh));
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
    if (!have.has(t)) await insertScoped(ctx, "documentLinks", scopeOfRow(doc), { sourceDocumentId: doc._id, targetPublicId: t, blockId: row.blockId });
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
 * of the same block into a conflict. At worst that edit re-writes the old label, which the next rename
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
  // A link's label is only refreshed when whoever last wrote that block can open the page: anyone can put
  // a link to any page id in their own notes, and must not learn a page's new title that way.
  const canRead = new Map<string, boolean>();
  const writerCanRead = async (profileId: Id<"profiles">): Promise<boolean> => {
    if (profileId === actor) return true;
    let ok = canRead.get(profileId);
    if (ok === undefined) {
      const writer = await ctx.db.get(profileId);
      ok = Boolean(writer && (await documentAccess(ctx, writer, doc)) !== "none");
      canRead.set(profileId, ok);
    }
    return ok;
  };
  // Nor is a title written into a page whose readers may not all open this one (a restricted page, or a
  // page in another scope): readers are served the current title or a neutral label anyway
  // (lib/linkLabels.ts), and the stored label feeds text every reader sees (excerpt, preview, search).
  const shared = new Map<string, boolean>();
  const sharedWith = async (sourceId: Id<"documents">): Promise<boolean> => {
    let ok = shared.get(sourceId);
    if (ok === undefined) {
      const source = await ctx.db.get(sourceId);
      ok = source !== null && (await titleIsShared(ctx, source, doc));
      shared.set(sourceId, ok);
    }
    return ok;
  };
  for (const link of links) {
    const key = `${link.sourceDocumentId}:${link.blockId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = await ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", link.blockId))
      .unique();
    if (!row || row.deletedAt !== undefined || row.documentId !== link.sourceDocumentId) continue;
    if (!(await sharedWith(row.documentId))) continue;
    if (!(await writerCanRead(row.updatedBy))) continue;
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
    const seq = await seqs.for(scopeOfRow(row));
    await ctx.db.patch(row._id, { ...patch, revision: row.revision + 1, seq, updatedAt: Date.now(), updatedBy: actor });
    touchedDocs.add(row.documentId);
  }
  for (const id of touchedDocs) {
    const source = await ctx.db.get(id);
    if (source) await refreshDerived(ctx, source);
  }
}
