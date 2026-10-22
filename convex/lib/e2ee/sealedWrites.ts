// Writes shared by e2ee/content.ts and e2ee/migrate.ts (docs/E2EE_DESIGN.md §5.3): sealed records, sealed
// versions, and the start of a migration job. Kept out of both modules so neither imports the other.
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { fail } from "../errors";
import { nextSeq } from "../seq";
import { insertScoped, scopeKey, scopeOfRow, type Scope } from "../scope";
import { failE2ee } from "./state";
import { E2EE_LIMITS, type RecordKind } from "./validators";
import { NoteKeyVersions, b64uToBytes, checkRecord } from "./sealedRows";

type Migration = Doc<"e2eeMigrations">;

/** Kinds of records only one person reads (their own Foli AI chats and memories, study schedules, settings). */
export const PERSONAL_KINDS: ReadonlySet<RecordKind> = new Set(["aiChat", "aiMemory", "studyReview", "prefs"]);

export async function findRecord(ctx: MutationCtx, scope: Scope, kind: RecordKind, recordId: string, profileId: Id<"profiles"> | undefined): Promise<Doc<"e2eeRecords"> | null> {
  const rows = await ctx.db
    .query("e2eeRecords")
    .withIndex("by_scope_kind_record", (q) =>
      (scope.kind === "personal" ? q.eq("workspaceId", undefined).eq("ownerProfileId", scope.profileId) : q.eq("workspaceId", scope.workspaceId).eq("ownerProfileId", undefined)).eq("kind", kind).eq("recordId", recordId),
    )
    .take(50);
  return rows.find((r) => r.profileId === profileId) ?? null;
}

/** Writes a sealed record (shared with the migration's finishDocument). Compare-and-set on `rev`. */
export async function writeRecord(
  ctx: MutationCtx,
  profile: Doc<"profiles">,
  at: { scope: Scope; doc: Doc<"documents"> | null },
  input: { kind: RecordKind; recordId: string; sealed: ArrayBuffer; keyVersion: number; baseRev?: number | null },
): Promise<{ rev: number }> {
  if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(input.recordId)) fail("invalid_argument", "Invalid record id.");
  const c = checkRecord(input.sealed, E2EE_LIMITS.recordBytes, "The record", input.keyVersion);
  if (at.doc && !(await new NoteKeyVersions(ctx).has(at.doc._id, input.keyVersion))) failE2ee("e2ee_plaintext", "The record names a key version this note doesn't have.");
  const profileId = PERSONAL_KINDS.has(input.kind) ? profile._id : undefined;
  const existing = await findRecord(ctx, at.scope, input.kind, input.recordId, profileId);
  if (existing && at.doc && existing.documentId !== at.doc._id) fail("invalid_argument", "That record id is taken.");
  if (input.baseRev !== undefined && input.baseRev !== null && (existing?.rev ?? 0) !== input.baseRev) failE2ee("e2ee_conflict");
  const seq = await nextSeq(ctx, at.scope);
  const now = Date.now();
  // A person's study schedules for a note, now in their sealed record: the server's rows of them go (§6.7).
  if (input.kind === "studyReview" && at.doc) {
    const docId = at.doc._id;
    for (const r of await ctx.db.query("studyReviews").withIndex("by_document", (q) => q.eq("documentId", docId)).take(2000)) if (r.profileId === profile._id) await ctx.db.delete(r._id);
  }
  if (existing) {
    const rev = existing.rev + 1;
    await ctx.db.patch(existing._id, { sealed: c, size: c.byteLength, keyVersion: input.keyVersion, rev, updatedBy: profile._id, updatedAt: now, deletedAt: undefined, seq });
    return { rev };
  }
  await insertScoped(ctx, "e2eeRecords", at.scope, {
    kind: input.kind,
    recordId: input.recordId,
    ...(at.doc ? { documentId: at.doc._id } : {}),
    ...(profileId ? { profileId } : {}),
    keyVersion: input.keyVersion,
    sealed: c,
    size: c.byteLength,
    rev: 1,
    updatedBy: profile._id,
    updatedAt: now,
    seq,
  });
  return { rev: 1 };
}

/**
 * What `documentSnapshots.name` holds for a sealed version with a name: not the name (that's `sealedName`),
 * only a mark that it has one, so "named versions are kept" and the named-only list keep working.
 */
export const SEALED_VERSION_NAME = "\u0001sealed";

const vSealedVersionContent = v.object({
  e2ee: v.literal(1),
  title: v.object({ c: v.string(), k: v.number(), mac: v.optional(v.string()) }),
  appearance: v.object({ c: v.string(), k: v.number() }),
  meta: v.optional(v.object({ c: v.string(), k: v.number() })),
  blocks: v.array(v.object({ id: v.string(), parentId: v.union(v.string(), v.null()), rank: v.string(), c: v.string(), k: v.number(), mac: v.optional(v.string()), collapsed: v.optional(v.literal(true)) })),
});
export { vSealedVersionContent };

/** Checks a SealedVersionContent from a device (ciphertext only, sizes) and returns it as stored JSON. */
export async function checkSealedVersion(ctx: MutationCtx, doc: Doc<"documents">, content: typeof vSealedVersionContent.type): Promise<string> {
  const keys = new NoteKeyVersions(ctx);
  const field = async (f: { c: string; k: number }, what: string, max: number) => {
    const bytes = b64uToBytes(f.c);
    checkRecord(bytes, max, what, f.k);
    if (!(await keys.has(doc._id, f.k))) failE2ee("e2ee_plaintext", `${what}: this note has no key with that version.`);
  };
  await field(content.title, "The title", E2EE_LIMITS.fieldBytes);
  await field(content.appearance, "The appearance", E2EE_LIMITS.fieldBytes);
  if (content.meta) await field(content.meta, "The meta", E2EE_LIMITS.fieldBytes);
  if (content.blocks.length > 5000) fail("limit_exceeded", "That version has too many blocks.");
  for (const b of content.blocks) await field(b, "A block", E2EE_LIMITS.blockBytes);
  const json = JSON.stringify(content);
  if (json.length > 8_000_000) fail("limit_exceeded", "That version is too big.");
  return json;
}

const SNAPSHOT_CHUNK = 250_000;

/** Stores a sealed version (its chunks and row). Shared with migrate.sealSnapshot. */
export async function writeSnapshotChunks(
  ctx: MutationCtx,
  doc: Doc<"documents">,
  s: { publicId: string; reason: Doc<"documentSnapshots">["reason"]; json: string; blockCount: number; contentSeq: number; createdBy: Id<"profiles">; createdAt: number; sealedName?: { c: ArrayBuffer; k: number } },
): Promise<Id<"documentSnapshots">> {
  const chunks = s.json.match(new RegExp(`[\\s\\S]{1,${SNAPSHOT_CHUNK}}`, "gu")) ?? [""];
  const snapshotId = await insertScoped(ctx, "documentSnapshots", scopeOfRow(doc), {
    documentId: doc._id,
    publicId: s.publicId,
    reason: s.reason,
    title: "",
    chunkCount: chunks.length,
    blockCount: s.blockCount,
    sizeBytes: s.json.length,
    contentSeq: s.contentSeq,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    editors: [s.createdBy],
    sealed: true,
    ...(s.sealedName ? { sealedName: s.sealedName, name: SEALED_VERSION_NAME } : {}),
  });
  for (const [index, data] of chunks.entries()) await ctx.db.insert("snapshotChunks", { snapshotId, index, data });
  return snapshotId;
}

/** A space-wide job as e2ee.spaces.enable / lower / rotate start it (same row as keyStore.startSpaceMigration). */
export async function startSpaceJob(ctx: MutationCtx, scope: Scope, by: Id<"profiles">, direction: Migration["direction"], targetLevel: Migration["targetLevel"]): Promise<Id<"e2eeMigrations">> {
  const total = scope.kind === "personal" ? ((await ctx.db.get(scope.profileId))?.personalDocumentCount ?? 0) : ((await ctx.db.get(scope.workspaceId))?.documentCount ?? 0);
  return await insertScoped(ctx, "e2eeMigrations", scope, { scopeKey: scopeKey(scope), direction, targetLevel, scopeOf: "space", total, done: 0, failed: 0, phase: "documents", startedBy: by, startedAt: Date.now() });
}

/** A job for a locked (or unlocked) folder or note in a Standard space (e2ee.content.setFolderLocked / setDocumentLocked). */
export async function startLockMigration(
  ctx: MutationCtx,
  scope: Scope,
  by: Id<"profiles">,
  o: { direction: "seal" | "unseal"; scopeOf: "folder" | "document"; rootId: string; total: number },
): Promise<Id<"e2eeMigrations">> {
  return await insertScoped(ctx, "e2eeMigrations", scope, {
    scopeKey: scopeKey(scope),
    direction: o.direction,
    targetLevel: "standard",
    scopeOf: o.scopeOf,
    rootId: o.rootId,
    total: o.total,
    done: 0,
    failed: 0,
    phase: "documents",
    startedBy: by,
    startedAt: Date.now(),
  });
}

