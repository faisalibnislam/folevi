// sync.push in local mode: the server side of docs/SYNC_PROTOCOL.md (convex/lib/syncEngine.ts) against the
// local store, so the web SyncEngine and Outbox run unchanged. One device writes this library at a time and
// it can't disagree with itself, so a change based on an older revision is still applied (the newest edit
// wins): only a malformed op is refused. Edits arriving from another device are merged by the store
// (packages/local-store), which keeps what it overwrites in version history (docs/LOCAL_MODE_PLAN.md §2.3).
import {
  LIMITS,
  builtInTemplateBlocks,
  cloneBlocks,
  sameContent,
  sanitizeTitle,
  validateWireBlock,
  type SyncOp,
  type WireBlock,
  type WireDocumentCreate,
  type WireScope,
} from "@folevi/editor-schema";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { errorCode, fail } from "../errors";
import { defineLocal, type LocalMutationCtx } from "../registry";
import type { LocalBlock, LocalDocument } from "../store";
import { insertDocument, liveBlocks, refreshDerived, requireProfile, toSummary, toWireBlock, type LocalProfile } from "./shared";

type PushResult = FunctionReturnType<typeof api.sync.push>[number];

const MAX_BATCH = 100;

/** What a replay of an op id needs to know (convex syncOperations). */
interface OpRecord {
  kind: SyncOp["kind"];
  entityId: string;
  status: PushResult["status"];
  errorCode?: string;
}

const opKey = (opId: string) => `op:${opId}`;

function entityOf(op: SyncOp): string {
  return op.kind === "block.upsert" ? op.block.id : op.kind === "document.create" ? op.document.id : "blockId" in op ? op.blockId : op.documentId;
}

/** A page backdrop is "art:<artwork id>" or "color:<name>"; anything else is dropped (syncEngine.ts checkedStyle). */
const BACKDROP = /^(art:[a-z0-9-]{1,40}|color:[a-z]{1,20})$/;
function checkedStyle<T extends { backdrop?: string }>(style: T): T {
  if (style.backdrop === undefined || BACKDROP.test(style.backdrop)) return style;
  const { backdrop: _dropped, ...rest } = style;
  void _dropped;
  return rest as T;
}

class LocalSync {
  /** Notes whose blocks this batch changed: their derived text, counts and seqs are refreshed at the end. */
  private touched = new Set<string>();
  private seq: number | null = null;
  constructor(
    private ctx: LocalMutationCtx,
    private profile: LocalProfile,
    private routing: WireScope,
  ) {}

  private async nextSeq(): Promise<number> {
    return (this.seq ??= await this.ctx.nextSeq());
  }

  async applyAll(ops: SyncOp[]): Promise<PushResult[]> {
    if (ops.length > MAX_BATCH) fail("limit_exceeded", `At most ${MAX_BATCH} operations per batch.`);
    const results: PushResult[] = [];
    for (const op of ops) results.push(await this.applyOne(op));
    await this.finish();
    return results;
  }

  private async applyOne(op: SyncOp): Promise<PushResult> {
    if (typeof op.opId !== "string" || op.opId.length < 8 || op.opId.length > 64) {
      return { opId: String(op.opId), status: "rejected", error: { code: "invalid_op", message: "Invalid operation id." } };
    }
    const prior = (await this.ctx.db.get("meta", opKey(op.opId))) as OpRecord | undefined;
    if (prior) return await this.replay(op, prior);
    let result: PushResult;
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
      const code = errorCode(e);
      if (!code) throw e;
      result = { opId: op.opId, status: "rejected", error: { code, message: (e as { data?: { message?: string } }).data?.message ?? code } };
    }
    const record: OpRecord = { kind: op.kind, entityId: entityOf(op), status: result.status, ...(result.error ? { errorCode: result.error.code } : {}) };
    this.ctx.db.put("meta", opKey(op.opId), record);
    return result;
  }

  /** The same op again (a resend after a lost answer): never applied twice; the current state goes back. */
  private async replay(op: SyncOp, prior: OpRecord): Promise<PushResult> {
    if (entityOf(op) !== prior.entityId || op.kind !== prior.kind) {
      return { opId: op.opId, status: "rejected", error: { code: "invalid_op", message: "This operation id was already used for something else." } };
    }
    if (prior.status === "rejected") return { opId: op.opId, status: "rejected", error: { code: prior.errorCode ?? "rejected", message: "Rejected earlier." } };
    if (op.kind === "document.create" || op.kind === "document.update") {
      const doc = await this.ctx.db.get("documents", op.kind === "document.create" ? op.document.id : op.documentId);
      return { opId: op.opId, status: "duplicate", revision: doc?.revision, document: doc ? toSummary(doc, this.profile.id) : undefined };
    }
    const row = await this.ctx.db.get("blocks", entityOf(op), op.documentId);
    return { opId: op.opId, status: "duplicate", revision: row?.revision, block: row ? toWireBlock(row) : null, deleted: row ? row.deletedAt !== null : undefined };
  }

  /** The note a block op writes to: it must exist and not be in Trash. */
  private async writableDoc(id: string): Promise<LocalDocument> {
    const doc = await this.ctx.db.get("documents", id);
    if (!doc) fail("not_found", "Document not found.");
    if (doc.inTrash) fail("forbidden", "Restore this document from Trash to edit it.");
    return doc;
  }

  /** The parent pointer as stored: a parent that isn't a live block of this note is the top level. */
  private async checkParent(documentId: string, block: WireBlock): Promise<{ parentId: string | null; normalized: boolean }> {
    if (block.parentId === null) return { parentId: null, normalized: false };
    let cursor: string | null = block.parentId;
    let depth = 0;
    let first = true;
    while (cursor !== null) {
      if (cursor === block.id) fail("invalid_block", "A block cannot be nested inside itself.");
      const parent: LocalBlock | undefined = await this.ctx.db.get("blocks", cursor, documentId);
      if (!parent || parent.deletedAt !== null) {
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

  private async upsertBlock(op: Extract<SyncOp, { kind: "block.upsert" }>): Promise<PushResult> {
    const doc = await this.writableDoc(op.documentId);
    const incoming: WireBlock = { ...op.block };
    delete incoming.revision;
    const existing = await this.ctx.db.get("blocks", incoming.id, doc.id);
    const issues = validateWireBlock(incoming);
    if (issues.length) {
      return { opId: op.opId, status: "rejected", error: { code: "invalid_block", message: `${issues[0]!.path}: ${issues[0]!.message}` }, block: existing ? toWireBlock(existing) : null };
    }
    if (incoming.type === "synced" && doc.kind === "synced") fail("invalid_block", "A synced block can't go inside another synced block.");
    const { parentId, normalized } = await this.checkParent(doc.id, incoming);
    const seq = await this.nextSeq();
    const now = this.ctx.now();

    if (!existing) {
      if ((await liveBlocks(this.ctx.db, doc.id)).length >= LIMITS.maxBlocksPerDocument) fail("limit_exceeded", "This document has too many blocks.");
      const row: LocalBlock = { ...incoming, documentId: doc.id, parentId, revision: 1, contentRev: 1, positionRev: 1, seq, deletedAt: null, createdAt: now, updatedAt: now };
      this.ctx.db.put("blocks", row.id, row, doc.id);
      this.touched.add(doc.id);
      return { opId: op.opId, status: "applied", revision: 1, block: toWireBlock(row), deleted: false, normalized: normalized || undefined };
    }

    const contentChanged = !sameContent(existing, incoming);
    const positionChanged = existing.parentId !== parentId || existing.rank !== incoming.rank;
    // A deleted block written again (this device thought it was there) comes back; a create of a block that
    // exists (baseRevision null) is an edit of it. The newest edit wins either way.
    const revived = existing.deletedAt !== null;
    const fresh = op.baseRevision === null;
    // A create of a block that's already there with the same content changes nothing (as on the server).
    if (fresh && !revived && !contentChanged) return { opId: op.opId, status: "applied", revision: existing.revision, block: toWireBlock(existing), deleted: false };
    const wantsContent = (op.fields.includes("content") || fresh || revived) && contentChanged;
    const wantsPosition = (op.fields.includes("position") || fresh || revived) && positionChanged;
    const collapsed = Boolean((incoming.props as { collapsed?: unknown }).collapsed);
    const wantsCollapse = op.fields.includes("collapsed") && existing.type === "toggle" && incoming.type === "toggle" && Boolean((existing.props as { collapsed?: unknown }).collapsed) !== collapsed;
    if (!wantsContent && !wantsPosition && !wantsCollapse && !revived) {
      return { opId: op.opId, status: "applied", revision: existing.revision, block: toWireBlock(existing), deleted: false };
    }
    const revision = existing.revision + 1;
    const row: LocalBlock = { ...existing, revision, seq, updatedAt: now, deletedAt: null };
    if (wantsContent) {
      row.type = incoming.type;
      row.schemaVersion = incoming.schemaVersion;
      row.text = incoming.text;
      row.props = incoming.props;
      row.contentRev = revision;
    }
    if (wantsPosition || revived) {
      row.parentId = parentId;
      row.rank = incoming.rank;
      row.positionRev = revision;
    }
    if (wantsCollapse) row.props = { ...row.props, collapsed };
    this.ctx.db.put("blocks", row.id, row, doc.id);
    this.touched.add(doc.id);
    return { opId: op.opId, status: "applied", revision, block: toWireBlock(row), deleted: false, normalized: normalized || undefined };
  }

  /** Every block nested under `rootId`, deleted ones included. */
  private async subtree(documentId: string, rootId: string): Promise<LocalBlock[]> {
    const all = await this.ctx.db.list("blocks", documentId);
    const kids = new Map<string, LocalBlock[]>();
    for (const b of all) if (b.parentId) kids.set(b.parentId, [...(kids.get(b.parentId) ?? []), b]);
    const out: LocalBlock[] = [];
    const walk = (id: string, depth: number) => {
      if (depth > 64) return;
      for (const c of kids.get(id) ?? []) {
        out.push(c);
        walk(c.id, depth + 1);
      }
    };
    walk(rootId, 0);
    return out;
  }

  private async deleteBlock(op: Extract<SyncOp, { kind: "block.delete" }>): Promise<PushResult> {
    const doc = await this.writableDoc(op.documentId);
    const row = await this.ctx.db.get("blocks", op.blockId, doc.id);
    if (!row) return { opId: op.opId, status: "applied", block: null, deleted: true };
    if (row.deletedAt !== null) return { opId: op.opId, status: "applied", revision: row.revision, block: toWireBlock(row), deleted: true };
    const seq = await this.nextSeq();
    const now = this.ctx.now();
    const revision = row.revision + 1;
    const gone: LocalBlock = { ...row, deletedAt: now, revision, positionRev: revision, seq, updatedAt: now };
    this.ctx.db.put("blocks", gone.id, gone, doc.id);
    for (const child of await this.subtree(doc.id, row.id)) {
      if (child.deletedAt !== null) continue;
      this.ctx.db.put("blocks", child.id, { ...child, deletedAt: now, revision: child.revision + 1, seq, updatedAt: now }, doc.id);
    }
    this.touched.add(doc.id);
    return { opId: op.opId, status: "applied", revision, block: toWireBlock(gone), deleted: true };
  }

  private async restoreBlock(op: Extract<SyncOp, { kind: "block.restore" }>): Promise<PushResult> {
    const doc = await this.writableDoc(op.documentId);
    const row = await this.ctx.db.get("blocks", op.blockId, doc.id);
    if (!row) return { opId: op.opId, status: "rejected", error: { code: "not_found", message: "Block not found." } };
    if (row.deletedAt === null) return { opId: op.opId, status: "applied", revision: row.revision, block: toWireBlock(row), deleted: false };
    const deletedAt = row.deletedAt;
    const seq = await this.nextSeq();
    const now = this.ctx.now();
    let parentId = row.parentId;
    if (parentId) {
      const parent = await this.ctx.db.get("blocks", parentId, doc.id);
      if (!parent || parent.deletedAt !== null) parentId = null;
    }
    const revision = row.revision + 1;
    const back: LocalBlock = { ...row, deletedAt: null, parentId, revision, positionRev: revision, seq, updatedAt: now };
    this.ctx.db.put("blocks", back.id, back, doc.id);
    for (const child of await this.subtree(doc.id, row.id)) {
      if (child.deletedAt !== deletedAt) continue;
      this.ctx.db.put("blocks", child.id, { ...child, deletedAt: null, revision: child.revision + 1, seq, updatedAt: now }, doc.id);
    }
    this.touched.add(doc.id);
    return { opId: op.opId, status: "applied", revision, block: toWireBlock(back), deleted: false, normalized: parentId !== row.parentId || undefined };
  }

  /** The scope a create names (`scope`, or the older `workspaceId`): only Personal exists here. */
  private createsInPersonal(input: WireDocumentCreate): boolean {
    const named = input.scope ?? (input.workspaceId ? { kind: "workspace" as const, workspaceId: input.workspaceId } : null);
    return (named ?? this.routing).kind === "personal";
  }

  private async createDoc(op: Extract<SyncOp, { kind: "document.create" }>): Promise<PushResult> {
    const input = op.document;
    const existing = await this.ctx.db.get("documents", input.id);
    if (existing) return { opId: op.opId, status: "applied", revision: existing.revision, document: toSummary(existing, this.profile.id) };
    if (input.kind === "synced" && (input.parentDocumentId || input.folderId || input.templateId)) fail("invalid_argument", "Synced content is never nested or filed.");
    let parentDocumentId: string | null = null;
    if (input.parentDocumentId) parentDocumentId = (await this.writableDoc(input.parentDocumentId)).id;
    else if (!this.createsInPersonal(input)) fail("not_found", "Workspace not found.");
    let folderId: string | null = null;
    if (input.folderId) {
      const folder = await this.ctx.db.get("folders", input.folderId);
      if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
      folderId = folder.id;
    }
    if (input.kind === "daily") {
      const date = input.dailyDate;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("invalid_argument", "Daily notes need a date.");
      const dup = (await this.ctx.db.list("documents")).find((d) => d.kind === "daily" && d.dailyDate === date);
      if (dup) return { opId: op.opId, status: "conflict", revision: dup.revision, document: toSummary(dup, this.profile.id), conflict: { reason: "exists", server: null, client: null } };
    }
    let blocks: WireBlock[] = [];
    let templateKey: string | null = null;
    if (input.templateId) {
      if (input.templateId.startsWith("builtin:")) {
        const found = builtInTemplateBlocks(input.templateId.slice(8));
        if (!found) fail("not_found", "That template is no longer available.");
        blocks = found;
      } else {
        const template = await this.ctx.db.get("documents", input.templateId);
        if (!template || template.kind !== "template" || template.inTrash) fail("not_found", "That template is no longer available.");
        blocks = cloneBlocks((await liveBlocks(this.ctx.db, template.id)).map(toWireBlock));
      }
      templateKey = input.templateId;
    }
    const kind = input.kind === "template" || input.kind === "daily" || input.kind === "synced" ? input.kind : "document";
    const doc = await insertDocument(this.ctx, {
      id: input.id,
      title: input.title,
      icon: input.icon,
      kind,
      parentDocumentId,
      folderId,
      style: input.style ? checkedStyle(input.style) : undefined,
      cover: input.cover,
      dailyDate: kind === "daily" ? (input.dailyDate ?? null) : null,
      templateKey,
      blocks,
    });
    return { opId: op.opId, status: "applied", revision: doc.revision, document: toSummary(doc, this.profile.id) };
  }

  private async updateDoc(op: Extract<SyncOp, { kind: "document.update" }>): Promise<PushResult> {
    const doc = await this.writableDoc(op.documentId);
    const patch = op.patch;
    const update: Partial<LocalDocument> = {};
    if (patch.title !== undefined) {
      const title = sanitizeTitle(patch.title);
      if (title !== doc.title) update.title = title;
    }
    // Notes always keep an icon: an icon can be changed, not removed.
    if (patch.icon) update.icon = patch.icon;
    if (patch.cover !== undefined) update.cover = patch.cover;
    if (patch.style !== undefined) update.style = checkedStyle(patch.style);
    if (patch.folderId !== undefined) {
      if (patch.folderId !== null) {
        const folder = await this.ctx.db.get("folders", patch.folderId);
        if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
      }
      update.folderId = patch.folderId;
    }
    if (patch.parentDocumentId !== undefined) {
      if (patch.parentDocumentId === null) update.parentDocumentId = null;
      else {
        const parent = await this.writableDoc(patch.parentDocumentId);
        // No cycles: the new parent may not be inside this note.
        let cursor: LocalDocument | undefined = parent;
        for (let i = 0; cursor && i < 32; i++) {
          if (cursor.id === doc.id) fail("invalid_argument", "A page can't be moved inside itself.");
          cursor = cursor.parentDocumentId ? await this.ctx.db.get("documents", cursor.parentDocumentId) : undefined;
        }
        update.parentDocumentId = parent.id;
      }
    }
    let fresh = doc;
    if (Object.keys(update).length) {
      const revision = doc.revision + 1;
      fresh = { ...doc, ...update, revision, titleRev: update.title !== undefined ? revision : doc.titleRev, seq: await this.nextSeq(), updatedAt: this.ctx.now() };
      if (update.title !== undefined) fresh = await refreshDerived(this.ctx.db, fresh);
      this.ctx.db.put("documents", fresh.id, fresh);
    }
    return { opId: op.opId, status: "applied", revision: fresh.revision, document: toSummary(fresh, this.profile.id) };
  }

  /** Each note whose blocks changed: derived text and counts, its edit time and change counters. */
  private async finish(): Promise<void> {
    for (const id of this.touched) {
      const doc = await this.ctx.db.get("documents", id);
      if (!doc) continue;
      const derived = await refreshDerived(this.ctx.db, doc);
      this.ctx.db.put("documents", id, { ...derived, updatedAt: this.ctx.now(), contentSeq: doc.contentSeq + 1, seq: await this.nextSeq() });
    }
  }
}

defineLocal(api.sync.push, "mutation", async (ctx, args) => {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(args.deviceId)) fail("invalid_argument", "Invalid device id.");
  const profile = await requireProfile(ctx);
  return await new LocalSync({ ...ctx, deviceId: args.deviceId }, profile, args.scope).applyAll(args.ops as SyncOp[]);
});
