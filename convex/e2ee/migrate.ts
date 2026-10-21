// Background encrypt, decrypt and re-seal jobs (docs/E2EE_DESIGN.md §5.3 e2ee.migrate, §6.9). The server
// never converts anything itself: a device of someone allowed to (Personal: its owner; a workspace: owners
// and admins; a lock: anyone who can edit there) claims a lease on the job, reads plaintext rows through the
// normal queries, seals them and hands them back here one note at a time. Each note switches atomically in
// `finishDocument` (sealed and purged of derived plaintext in one mutation) or `finishUnseal`. If the lease
// lapses, another device carries on from where the last one stopped.
//
// Phases: documents → history (versions) → files → cleanup → done. WP3.
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sanitizeTitle, validateWireBlock, type WireBlock } from "@folevi/editor-schema";
import { assertWritable, documentAccessInfo, membership, memberLevel, requireDocument, requireProfile, resolveScope } from "../lib/auth";
import { fail } from "../lib/errors";
import { nextSeq } from "../lib/seq";
import { insertScoped, scopeKey, scopeOfRow, vScope, vScopeArg, type Scope } from "../lib/scope";
import { failE2ee, spaceE2ee } from "../lib/e2ee/state";
import { E2EE_LIMITS, vMigrationDirection, vMigrationPhase, vMigrationScopeOf, vNoteKeyWrapInput, vRecordKind, vE2eeLevel } from "../lib/e2ee/validators";
import { NoteKeyVersions, checkMac, checkRecord, lockFor, recordHeaderVersion, requireSpaceKey, sealedBlockIssue, sealedPlaceholders } from "../lib/e2ee/sealedRows";
import { peopleOfDocument, purgeCopiesInScope, purgeDerivedPlaintext } from "../lib/e2ee/purge";
import { liveBlocks, refreshDerived, syncTaskProjection } from "../lib/documents";
import { syncLinks } from "../lib/syncEngine";
import { syncStudyCard } from "../lib/study";
import { queueIndex } from "../lib/ai/indexing";
import { normalizeNumberFormat, normalizeValue } from "../lib/collections";
import { vCollectionPropertyType, vDocumentStyle, vDocumentCover } from "../lib/validators";
import { checkSealedVersion, startLockMigration, startSpaceJob, vSealedVersionContent, writeRecord } from "../lib/e2ee/sealedWrites";

/** How long a device holds a job, or a note it is converting, without a heartbeat (§6.9). */
export const LEASE_MS = 2 * 60_000;
/** Notes handed out per claim. */
const CLAIM_BATCH = 50;
/** Rows looked at per claim while looking for work. */
const SCAN = 200;
const MAX_BLOCKS_PER_CALL = 200;
const MAX_BYTES_PER_CALL = 4 * 1024 * 1024;

type Migration = Doc<"e2eeMigrations">;

// ---------------------------------------------------------------- starting

/** Internal entry point (§5.3 `start`), for callers in other modules that run it as a function reference. */
export const start = internalMutation({
  args: {
    scope: vScope,
    by: v.id("profiles"),
    direction: vMigrationDirection,
    targetLevel: vE2eeLevel,
    scopeOf: vMigrationScopeOf,
    rootId: v.optional(v.string()),
    total: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.scopeOf === "space") return await startSpaceJob(ctx, args.scope, args.by, args.direction, args.targetLevel);
    if (args.direction === "reseal" || !args.rootId) fail("invalid_argument", "A lock job seals or unseals one folder or note.");
    return await startLockMigration(ctx, args.scope, args.by, { direction: args.direction, scopeOf: args.scopeOf, rootId: args.rootId, total: args.total ?? 0 });
  },
});

// ---------------------------------------------------------------- who may run a job

/** A job and the scope it runs in, if the caller may work on it (not found otherwise). */
async function jobFor(ctx: MutationCtx | QueryCtx, profile: Doc<"profiles">, migrationId: string): Promise<{ job: Migration; scope: Scope }> {
  const id = ctx.db.normalizeId("e2eeMigrations", migrationId);
  const job = id ? await ctx.db.get(id) : null;
  if (!job) fail("not_found", "Not found.");
  const scope = scopeOfRow(job);
  if (!(await mayRun(ctx, profile, scope, job))) fail("not_found", "Not found.");
  return { job, scope };
}

/** Personal: its owner. A workspace: owners and admins, or for a lock anyone who can edit there. */
async function mayRun(ctx: MutationCtx | QueryCtx, profile: Doc<"profiles">, scope: Scope, job: Migration): Promise<boolean> {
  if (scope.kind === "personal") return scope.profileId === profile._id;
  const m = await membership(ctx, profile._id, scope.workspaceId);
  if (!m) return false;
  const level = memberLevel(m);
  if (level === "owner" || level === "admin") return true;
  return job.scopeOf !== "space" && (level === "edit" || job.startedBy === profile._id);
}

// ---------------------------------------------------------------- claiming work

/** Whether a note still needs this job's work. */
async function needsWork(ctx: QueryCtx, job: Migration, doc: Doc<"documents">): Promise<boolean> {
  if (doc.kind === "synced" && job.direction !== "reseal" && doc.sealedAt === undefined && job.scopeOf !== "space") return false;
  if (job.direction === "seal") return doc.sealedAt === undefined;
  if (job.direction === "unseal") return doc.sealedAt !== undefined && (job.scopeOf !== "space" || (!doc.locked && doc.lockedVia === undefined));
  // reseal: rows under a note key older than the newest.
  if (doc.sealedAt === undefined) return false;
  return (await oldKeyRows(ctx, doc)) > 0;
}

/** Rows of a sealed note sealed with a note key older than its newest (re-seal work, §4.9). */
async function oldKeyRows(ctx: QueryCtx, doc: Doc<"documents">): Promise<number> {
  const versions = await new NoteKeyVersions(ctx).of(doc._id);
  const newest = Math.max(0, ...versions);
  let n = 0;
  if (doc.sealedTitle && doc.sealedTitle.k < newest) n++;
  for (const b of await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(5000)) if (b.sealed && b.sealed.k < newest) n++;
  return n;
}

/** The notes a lock job covers: the note (and its sub-pages), or everything in the folder (bounded). */
async function lockDocs(ctx: QueryCtx, job: Migration): Promise<Doc<"documents">[]> {
  const scope = scopeOfRow(job);
  const out: Doc<"documents">[] = [];
  if (job.scopeOf === "document") {
    const root = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", job.rootId!)).unique();
    if (root) out.push(root);
  } else {
    const folder = await ctx.db.query("folders").withIndex("by_public_id", (q) => q.eq("publicId", job.rootId!)).unique();
    if (!folder) return [];
    const folders = [folder];
    for (let i = 0; i < folders.length && folders.length < 500; i++) {
      folders.push(...(await ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", folders[i]!._id)).take(200)).filter((f) => !f.deletedAt));
    }
    for (const f of folders) out.push(...(await ctx.db.query("documents").withIndex("by_folder", (q) => q.eq("folderId", f._id)).take(2000)));
  }
  for (let i = 0; i < out.length && out.length < 5000; i++) out.push(...(await ctx.db.query("documents").withIndex("by_parent", (q) => q.eq("parentDocumentId", out[i]!._id)).take(200)));
  return out.filter((d) => scopeKey(scopeOfRow(d)) === scopeKey(scope)).sort((a, b) => (a.publicId < b.publicId ? -1 : 1));
}

/**
 * Takes (or renews) the job's lease for this device and returns the next notes to handle, in ULID order:
 * only ones that still need work, so a note a lapsed lease left half done is offered again. `busy` when
 * another device holds the lease.
 */
export const claim = mutation({
  args: { migrationId: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { job, scope } = await jobFor(ctx, profile, args.migrationId);
    if (job.phase === "done") return { busy: false, phase: job.phase, documents: [] as string[], snapshots: [] as string[], files: [] as string[] };
    const now = Date.now();
    if (job.leaseDeviceId && job.leaseDeviceId !== args.deviceId && (job.leaseUntil ?? 0) > now) {
      return { busy: true, phase: job.phase, documents: [] as string[], snapshots: [] as string[], files: [] as string[] };
    }
    await ctx.db.patch(job._id, { leaseDeviceId: args.deviceId, leaseProfileId: profile._id, leaseUntil: now + LEASE_MS });
    const work = await nextWork(ctx, job, scope);
    if (work.cursor !== job.cursor) await ctx.db.patch(job._id, { cursor: work.cursor });
    return { busy: false, phase: job.phase, ...work.items };
  },
});

/** The next items of the job's phase, and the cursor to start from next time (past fully handled rows only). */
async function nextWork(ctx: MutationCtx, job: Migration, scope: Scope): Promise<{ cursor: string | undefined; items: { documents: string[]; snapshots: string[]; files: string[] } }> {
  const items = { documents: [] as string[], snapshots: [] as string[], files: [] as string[] };
  if (job.phase === "documents") {
    if (job.scopeOf !== "space") {
      for (const d of await lockDocs(ctx, job)) if (items.documents.length < CLAIM_BATCH && (await needsWork(ctx, job, d))) items.documents.push(d.publicId);
      return { cursor: job.cursor, items };
    }
    // The scope's notes oldest first; the cursor moves past a page only once nothing in it needs work.
    let cursor = job.cursor ?? null;
    let advanced: string | undefined = job.cursor;
    let clean = true;
    for (let pages = 0; pages < 5 && items.documents.length < CLAIM_BATCH; pages++) {
      const base = ctx.db.query("documents");
      const q = scope.kind === "personal" ? base.withIndex("by_owner_created", (x) => x.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace_created", (x) => x.eq("workspaceId", scope.workspaceId));
      const page = await q.paginate({ cursor, numItems: SCAN });
      let pageClean = true;
      for (const d of page.page) {
        if (!(await needsWork(ctx, job, d))) continue;
        pageClean = false;
        if (items.documents.length < CLAIM_BATCH) items.documents.push(d.publicId);
      }
      if (clean && pageClean && !page.isDone) advanced = page.continueCursor;
      clean = clean && pageClean;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { cursor: advanced, items };
  }
  if (job.phase === "history") {
    for (const doc of await jobDocs(ctx, job, scope)) {
      if (items.snapshots.length >= CLAIM_BATCH) break;
      for (const s of await ctx.db.query("documentSnapshots").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(200)) {
        const wantSealed = job.direction !== "unseal";
        if (Boolean(s.sealed) !== wantSealed || (job.direction === "reseal" && s.sealed)) {
          if (job.direction === "reseal") continue;
          items.snapshots.push(s.publicId);
        }
        if (items.snapshots.length >= CLAIM_BATCH) break;
      }
    }
    return { cursor: job.cursor, items };
  }
  if (job.phase === "files") {
    for (const doc of await jobDocs(ctx, job, scope)) {
      if (items.files.length >= CLAIM_BATCH) break;
      for (const f of await ctx.db.query("files").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(200)) {
        if (f.status !== "ready") continue;
        const wantSealed = job.direction !== "unseal";
        if (Boolean(f.sealed) !== wantSealed) items.files.push(f.publicId);
        if (items.files.length >= CLAIM_BATCH) break;
      }
    }
  }
  return { cursor: job.cursor, items };
}

/** The notes of a job (a lock's, or the whole scope's that are now in the target state), bounded. */
async function jobDocs(ctx: QueryCtx, job: Migration, scope: Scope): Promise<Doc<"documents">[]> {
  if (job.scopeOf !== "space") return await lockDocs(ctx, job);
  const base = ctx.db.query("documents");
  return await (scope.kind === "personal" ? base.withIndex("by_owner_created", (x) => x.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace_created", (x) => x.eq("workspaceId", scope.workspaceId))).take(2000);
}

export const heartbeat = mutation({
  args: { migrationId: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { job } = await jobFor(ctx, profile, args.migrationId);
    if (job.leaseDeviceId !== args.deviceId) return { held: false };
    await ctx.db.patch(job._id, { leaseUntil: Date.now() + LEASE_MS });
    return { held: true };
  },
});

/** Ends a phase once nothing in it needs work; the last one finishes the job and the space's state. */
export const finishPhase = mutation({
  args: { migrationId: v.string(), phase: vMigrationPhase, deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { job, scope } = await jobFor(ctx, profile, args.migrationId);
    if (job.phase !== args.phase) return { phase: job.phase };
    const left = await nextWork(ctx, { ...job, cursor: undefined }, scope);
    if (left.items.documents.length || left.items.snapshots.length || left.items.files.length) fail("conflict", "Some notes here still need converting.");
    const order: Migration["phase"][] = ["documents", "history", "files", "cleanup", "done"];
    const next = order[order.indexOf(job.phase) + 1] ?? "done";
    if (job.phase === "cleanup") {
      // The per-person copies about the space's notes (notifications, app results, chat references, §5.5).
      let cursor = null as Awaited<ReturnType<typeof purgeCopiesInScope>>;
      for (let i = 0; i < 20; i++) {
        cursor = await purgeCopiesInScope(ctx, scope, { cursor });
        if (!cursor) break;
      }
      if (cursor) return { phase: job.phase, more: true };
    }
    await ctx.db.patch(job._id, { phase: next, cursor: undefined, ...(next === "done" ? { finishedAt: Date.now(), leaseDeviceId: undefined, leaseUntil: undefined } : {}) });
    if (next === "done") await finishSpace(ctx, scope, job, profile._id);
    return { phase: next };
  },
});

/** A finished space-wide job sets the space's state: sealed spaces are "on", unsealed ones "off". */
async function finishSpace(ctx: MutationCtx, scope: Scope, job: Migration, by: Id<"profiles">) {
  if (job.scopeOf !== "space") return;
  const space = await spaceE2ee(ctx, scope);
  if (!space || space.migrationId !== job._id) return;
  const state = job.direction === "unseal" ? "off" : "on";
  await ctx.db.patch(space._id, { state, migrationId: undefined, changedBy: by, changedAt: Date.now(), seq: await nextSeq(ctx, scope) });
}

/** The job's progress for Settings > Privacy and the sidebar (§10.10). */
export const progress = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const jobs = await ctx.db
      .query("e2eeMigrations")
      .withIndex("by_scope", (q) => q.eq("scopeKey", scopeKey(scope)))
      .order("desc")
      .take(20);
    const now = Date.now();
    return jobs.map((j) => ({
      id: j._id as string,
      direction: j.direction,
      scopeOf: j.scopeOf,
      rootId: j.rootId ?? null,
      phase: j.phase,
      total: j.total,
      done: j.done,
      failed: j.failed,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt ?? null,
      // "Paused" in the UI: nobody holds the lease right now.
      running: j.leaseUntil !== undefined && j.leaseUntil > now,
    }));
  },
});

// ---------------------------------------------------------------- one note

/** A note the caller may convert right now, held by this device (`sealing`), else refused. */
async function heldDoc(ctx: MutationCtx, profile: Doc<"profiles">, documentId: string, deviceId: string): Promise<Doc<"documents">> {
  const { doc } = await requireDocument(ctx, profile, documentId, "write");
  if (!doc.sealing || doc.sealing.by !== deviceId) fail("conflict", "Start converting this note first (beginDocument).");
  if (doc.sealing.until < Date.now()) fail("conflict", "This device's hold on the note ran out. Start again.");
  return doc;
}

function checkDevice(deviceId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) fail("invalid_argument", "Invalid device id.");
}

/**
 * Starts converting one note on this device: holds it (`documents.sealing`) so other devices' edits wait
 * (`e2ee_busy`, retried), and for a seal stores note key v1 wrapped by the space key.
 */
export const beginDocument = mutation({
  args: { documentId: v.string(), deviceId: v.string(), noteKey: v.optional(vNoteKeyWrapInput) },
  handler: async (ctx, args) => {
    checkDevice(args.deviceId);
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (!(await documentAccessInfo(ctx, profile, doc)).inScope) fail("forbidden", "Only members can convert notes.");
    const scope = scopeOfRow(doc);
    const space = await spaceE2ee(ctx, scope);
    if (!space || space.currentKeyVersion < 1) failE2ee("e2ee_not_set_up");
    const now = Date.now();
    if (doc.sealing && doc.sealing.by !== args.deviceId && doc.sealing.until > now) failE2ee("e2ee_busy");
    if (args.noteKey) {
      const nk = args.noteKey;
      if (nk.documentId !== doc.publicId || nk.wrappedBy !== "space" || nk.spaceVersion === undefined) fail("invalid_argument", "The note key must be wrapped by the space key for this note.");
      await requireSpaceKey(ctx, scope, nk.spaceVersion);
      if (!(nk.wrapped instanceof ArrayBuffer) || nk.wrapped.byteLength < 32 || nk.wrapped.byteLength > E2EE_LIMITS.keyWrapBytes) failE2ee("e2ee_plaintext", "The note key must be wrapped.");
      const versions = await new NoteKeyVersions(ctx).of(doc._id);
      if (!versions.has(nk.version)) {
        if (nk.version !== Math.max(0, ...versions) + 1) fail("invalid_argument", "Note key versions go up by one.");
        await insertScoped(ctx, "e2eeNoteKeys", scope, { documentId: doc._id, version: nk.version, wrappedBy: "space", spaceVersion: nk.spaceVersion, wrapped: nk.wrapped, createdBy: profile._id, createdAt: now, seq: await nextSeq(ctx, scope) });
      }
    }
    await ctx.db.patch(doc._id, { sealing: { by: args.deviceId, until: now + LEASE_MS } });
    return { until: now + LEASE_MS };
  },
});

const vSealBlock = v.object({
  blockId: v.string(),
  revision: v.number(),
  sealed: v.object({ c: v.bytes(), mac: v.string(), k: v.number(), collapsed: v.optional(v.literal(true)) }),
  syncedSource: v.optional(v.string()),
  mentionIds: v.optional(v.array(v.string())),
});

/**
 * Seals a batch of the note's blocks (tombstones too), compare-and-set on `revision`: a block changed since
 * the device read it is skipped and reported, and the device reads it again. Revisions are kept (the content
 * is the same), `seq` moves so replicas and open notes pick the rows up.
 */
export const sealBlocks = mutation({
  args: { documentId: v.string(), deviceId: v.string(), blocks: v.array(vSealBlock) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    return await sealRows(ctx, doc, args.blocks, false);
  },
});

/** Re-seals blocks of a sealed note under its newest note key (rotation, §4.9). Rows whose revision moved are skipped. */
export const resealBlocks = mutation({
  args: { documentId: v.string(), blocks: v.array(vSealBlock) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    if (doc.sealedAt === undefined) fail("invalid_argument", "This note isn't encrypted.");
    return await sealRows(ctx, doc, args.blocks, true);
  },
});

async function sealRows(ctx: MutationCtx, doc: Doc<"documents">, blocks: (typeof vSealBlock.type)[], reseal: boolean) {
  if (blocks.length > MAX_BLOCKS_PER_CALL) fail("limit_exceeded", `At most ${MAX_BLOCKS_PER_CALL} blocks per call.`);
  const bytes = blocks.reduce((n, b) => n + b.sealed.c.byteLength, 0);
  if (bytes > MAX_BYTES_PER_CALL) fail("limit_exceeded", "Too much in one call.");
  const keys = new NoteKeyVersions(ctx);
  const seq = await nextSeq(ctx, scopeOfRow(doc));
  const skipped: string[] = [];
  let sealed = 0;
  for (const b of blocks) {
    const issue = sealedBlockIssue({ id: b.blockId, type: "sealed", parentId: null, rank: "V", schemaVersion: 0, text: [], props: {}, sealed: { ...b.sealed, syncedSource: b.syncedSource, mentions: b.mentionIds } });
    if (issue) fail("invalid_block", issue);
    if (!(await keys.has(doc._id, b.sealed.k))) fail("invalid_block", "sealed.k: this note has no key with that version");
    const row = await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", b.blockId)).unique();
    if (!row || row.documentId !== doc._id) fail("not_found", "Block not found.");
    if (row.revision !== b.revision || (reseal && (!row.sealed || row.sealed.k >= b.sealed.k))) {
      skipped.push(b.blockId);
      continue;
    }
    if (b.syncedSource !== undefined) {
      const source = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", b.syncedSource!)).unique();
      if (!source || scopeKey(scopeOfRow(source)) !== scopeKey(scopeOfRow(doc))) fail("invalid_block", "A synced block shows content from the same space only.");
    }
    const mentionIds = (b.mentionIds ?? []).filter((m) => ctx.db.normalizeId("profiles", m)).slice(0, E2EE_LIMITS.mentionsPerBlock);
    await ctx.db.patch(row._id, {
      ...sealedPlaceholders(b.sealed.collapsed === true),
      sealed: { c: b.sealed.c, mac: b.sealed.mac, k: b.sealed.k },
      syncedSource: b.syncedSource,
      mentionIds: mentionIds.length ? mentionIds : undefined,
      seq,
    });
    sealed++;
  }
  return { sealed, skipped };
}

/** Seals the note's title (with its MAC), appearance and meta, and records its files. */
export const sealDocumentFields = mutation({
  args: { documentId: v.string(), deviceId: v.string(), sealedTitle: v.object({ c: v.bytes(), mac: v.string() }), sealedAppearance: v.bytes(), sealedMeta: v.optional(v.bytes()), fileIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    const keys = new NoteKeyVersions(ctx);
    const field = async (bytes: ArrayBuffer, what: string) => {
      const c = checkRecord(bytes, E2EE_LIMITS.fieldBytes, what);
      const k = recordHeaderVersion(c)!;
      if (!(await keys.has(doc._id, k))) failE2ee("e2ee_plaintext", `${what}: this note has no key with that version.`);
      return { c, k };
    };
    const title = { ...(await field(args.sealedTitle.c, "The title")), mac: checkMac(args.sealedTitle.mac, "The title") };
    const appearance = await field(args.sealedAppearance, "The appearance");
    const meta = args.sealedMeta ? await field(args.sealedMeta, "The meta") : undefined;
    if (args.fileIds.length > 500) fail("limit_exceeded", "Too many files.");
    for (const id of args.fileIds) {
      const f = await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique();
      if (!f || scopeKey(scopeOfRow(f)) !== scopeKey(scopeOfRow(doc))) fail("invalid_argument", "That file isn't in this space.");
    }
    await ctx.db.patch(doc._id, { sealedTitle: title, sealedAppearance: appearance, sealedMeta: meta, fileIds: args.fileIds.length ? [...new Set(args.fileIds)] : undefined });
    return null;
  },
});

/** Seals the note's comments' bodies (also used to re-seal them under a new note key). */
export const sealComments = mutation({
  args: { documentId: v.string(), deviceId: v.optional(v.string()), comments: v.array(v.object({ commentId: v.string(), sealedBody: v.bytes() })) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = args.deviceId ? await heldDoc(ctx, profile, args.documentId, args.deviceId) : (await requireDocument(ctx, profile, args.documentId, "write")).doc;
    if (!args.deviceId && doc.sealedAt === undefined) fail("conflict", "Start converting this note first (beginDocument).");
    if (args.comments.length > MAX_BLOCKS_PER_CALL) fail("limit_exceeded", "Too many comments in one call.");
    const keys = new NoteKeyVersions(ctx);
    for (const c of args.comments) {
      const bytes = checkRecord(c.sealedBody, 64 * 1024, "A comment");
      const k = recordHeaderVersion(bytes)!;
      if (!(await keys.has(doc._id, k))) failE2ee("e2ee_plaintext", "A comment names a key version this note doesn't have.");
      const row = await ctx.db.query("comments").withIndex("by_public_id", (q) => q.eq("publicId", c.commentId)).unique();
      if (!row || row.documentId !== doc._id) fail("not_found", "Comment not found.");
      await ctx.db.patch(row._id, { body: [], sealedBody: { c: bytes, k } });
    }
    return null;
  },
});

/** Seals (or re-seals) one version: its content as a SealedVersionContent, and its name. */
export const sealSnapshot = mutation({
  args: { snapshotId: v.string(), content: vSealedVersionContent, sealedName: v.optional(v.bytes()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const snap = await ctx.db.query("documentSnapshots").withIndex("by_public_id", (q) => q.eq("publicId", args.snapshotId)).unique();
    if (!snap) fail("not_found", "Version not found.");
    const doc = await ctx.db.get(snap.documentId);
    if (!doc) fail("not_found", "Version not found.");
    await requireDocument(ctx, profile, doc.publicId, "write");
    if (doc.sealedAt === undefined) fail("invalid_argument", "Seal the note before its history.");
    const json = await checkSealedVersion(ctx, doc, args.content);
    let sealedName: { c: ArrayBuffer; k: number } | undefined;
    if (args.sealedName) {
      const c = checkRecord(args.sealedName, E2EE_LIMITS.fieldBytes, "The version name");
      sealedName = { c, k: recordHeaderVersion(c)! };
    }
    for (const chunk of await ctx.db.query("snapshotChunks").withIndex("by_snapshot", (q) => q.eq("snapshotId", snap._id)).collect()) await ctx.db.delete(chunk._id);
    if (snap.storageId) await ctx.storage.delete(snap.storageId);
    const chunks = json.match(/[\s\S]{1,250000}/gu) ?? [""];
    for (const [index, data] of chunks.entries()) await ctx.db.insert("snapshotChunks", { snapshotId: snap._id, index, data });
    const hadName = snap.name !== undefined;
    await ctx.db.patch(snap._id, {
      title: "",
      content: undefined,
      storageId: undefined,
      chunkCount: chunks.length,
      sizeBytes: json.length,
      sealed: true,
      sealedName: sealedName ?? (hadName ? snap.sealedName : undefined),
      // A named version stays named (and kept); its name itself is now only sealed.
      name: hadName || sealedName ? "\u0001sealed" : undefined,
    });
    return null;
  },
});

const vRecordInput = v.object({ kind: vRecordKind, recordId: v.string(), sealed: v.bytes(), keyVersion: v.number() });

/**
 * Finishes sealing one note, atomically: every block (tombstones too), its title and appearance and its
 * comments must be sealed; the device's sealed records (collections, found text, study schedules) are
 * written; the note is marked sealed; everything the server derived from its plaintext is purged (§5.5).
 */
export const finishDocument = mutation({
  args: { documentId: v.string(), deviceId: v.string(), records: v.array(vRecordInput) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    if (!doc.sealedTitle || !doc.sealedAppearance) fail("conflict", "Seal the note's title and look first.");
    const rows = await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect();
    const plain = rows.filter((r) => r.sealed === undefined).map((r) => r.blockId);
    if (plain.length) failE2ee("e2ee_plaintext", `Some blocks aren't sealed yet: ${plain.slice(0, 20).join(", ")}`, { unsealed: plain.length });
    const comments = await ctx.db.query("commentThreads").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(500);
    for (const t of comments) {
      for (const c of await ctx.db.query("comments").withIndex("by_thread", (q) => q.eq("threadId", t._id)).take(500)) {
        if (!c.sealedBody && !c.deletedAt && Array.isArray(c.body) && c.body.length) failE2ee("e2ee_plaintext", "Some comments aren't sealed yet.");
      }
    }
    if (args.records.length > MAX_BLOCKS_PER_CALL) fail("limit_exceeded", "Too many records in one call.");
    const scope = scopeOfRow(doc);
    for (const r of args.records) await writeRecord(ctx, profile, { scope, doc }, { ...r, baseRev: null });
    const now = Date.now();
    const seq = await nextSeq(ctx, scope);
    await ctx.db.patch(doc._id, { sealedAt: now, sealing: undefined, revision: doc.revision + 1, titleRev: doc.revision + 1, seq });
    let fresh = (await ctx.db.get(doc._id))!;
    for (let i = 0; i < 10; i++) if ((await purgeDerivedPlaintext(ctx, fresh)).done) break;
    fresh = (await ctx.db.get(doc._id))!;
    // A sealed synced block keeps its link to the content it shows (its source is visible on purpose, §4.6).
    for (const r of rows) if (r.syncedSource !== undefined) await syncLinks(ctx, fresh, r);
    await refreshDerived(ctx, fresh);
    const job = await activeJob(ctx, scope);
    if (job) await ctx.db.patch(job._id, { done: job.done + 1 });
    // A lock of one note cleans the per-person copies about it now; a whole space does it in its cleanup phase.
    if (!job || job.scopeOf !== "space") {
      let cursor = null as Awaited<ReturnType<typeof purgeCopiesInScope>>;
      const people = await peopleOfDocument(ctx, fresh);
      for (let i = 0; i < 20; i++) {
        cursor = await purgeCopiesInScope(ctx, scope, { cursor, sealed: new Set([doc._id]), people });
        if (!cursor) break;
      }
    }
    return { sealedAt: now };
  },
});

/** The job running in a scope now (the space's, or the newest unfinished lock job). */
async function activeJob(ctx: MutationCtx, scope: Scope): Promise<Migration | null> {
  const space = await spaceE2ee(ctx, scope);
  if (space?.migrationId) {
    const job = await ctx.db.get(space.migrationId);
    if (job && job.phase !== "done") return job;
  }
  const jobs = await ctx.db.query("e2eeMigrations").withIndex("by_scope", (q) => q.eq("scopeKey", scopeKey(scope))).order("desc").take(5);
  return jobs.find((j) => j.phase !== "done") ?? null;
}

// ---------------------------------------------------------------- unsealing

/** Puts plaintext back into a sealed note's blocks (validated like any block, CAS on revision). */
export const unsealBlocks = mutation({
  args: { documentId: v.string(), deviceId: v.string(), blocks: v.array(v.object({ blockId: v.string(), revision: v.number(), block: v.any() })) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    if (args.blocks.length > MAX_BLOCKS_PER_CALL) fail("limit_exceeded", `At most ${MAX_BLOCKS_PER_CALL} blocks per call.`);
    await requireReadable(ctx, doc);
    const seq = await nextSeq(ctx, scopeOfRow(doc));
    const skipped: string[] = [];
    for (const b of args.blocks) {
      const block = b.block as WireBlock;
      const issues = validateWireBlock(block);
      if (issues.length || block.id !== b.blockId) fail("invalid_block", issues[0] ? `${issues[0].path}: ${issues[0].message}` : "Block id mismatch.");
      const row = await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", b.blockId)).unique();
      if (!row || row.documentId !== doc._id) fail("not_found", "Block not found.");
      if (row.revision !== b.revision) {
        skipped.push(b.blockId);
        continue;
      }
      await ctx.db.patch(row._id, { type: block.type, schemaVersion: block.schemaVersion, text: block.text, props: block.props, sealed: undefined, syncedSource: undefined, mentionIds: undefined, seq });
    }
    return { skipped };
  },
});

/** Unsealing goes to a Standard space or out of a lock only (never makes a sealed note readable inside an encrypted space). */
async function requireReadable(ctx: MutationCtx, doc: Doc<"documents">) {
  const space = await spaceE2ee(ctx, scopeOfRow(doc));
  if (space && space.level !== "standard") failE2ee("e2ee_required");
  const lock = await lockFor(ctx, doc.folderId, doc.parentDocumentId ? await ctx.db.get(doc.parentDocumentId) : null);
  if (doc.locked || lock !== undefined) failE2ee("e2ee_locked");
}

/** Puts back a note's plaintext title and look (sealed copies stay until finishUnseal). */
export const unsealDocumentFields = mutation({
  args: { documentId: v.string(), deviceId: v.string(), title: v.string(), icon: v.union(v.string(), v.null()), cover: vDocumentCover, style: vDocumentStyle, templateKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    await requireReadable(ctx, doc);
    if (args.cover.kind === "image" && args.cover.value && !(doc.fileIds ?? []).includes(args.cover.value)) fail("invalid_argument", "That image can't be used as a note theme.");
    await ctx.db.patch(doc._id, { title: sanitizeTitle(args.title), icon: args.icon ?? undefined, cover: args.cover, style: args.style, templateKey: args.templateKey?.slice(0, 200) });
    return null;
  },
});

/** Puts back comment bodies (plaintext again, validated like comments.edit's). */
export const unsealComments = mutation({
  args: { documentId: v.string(), deviceId: v.string(), comments: v.array(v.object({ commentId: v.string(), body: v.array(v.any()) })) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    await requireReadable(ctx, doc);
    for (const c of args.comments.slice(0, MAX_BLOCKS_PER_CALL)) {
      const row = await ctx.db.query("comments").withIndex("by_public_id", (q) => q.eq("publicId", c.commentId)).unique();
      if (!row || row.documentId !== doc._id) fail("not_found", "Comment not found.");
      if (JSON.stringify(c.body).length > 64 * 1024) fail("invalid_argument", "Comment is too long.");
      await ctx.db.patch(row._id, { body: c.body, sealedBody: undefined });
    }
    return null;
  },
});

const vPlainCollection = v.object({
  id: v.string(),
  name: v.string(),
  properties: v.array(v.object({ id: v.string(), name: v.string(), type: vCollectionPropertyType, options: v.optional(v.array(v.object({ id: v.string(), name: v.string(), color: v.string() }))), formula: v.optional(v.string()), numberFormat: v.optional(v.any()), rank: v.string() })),
  views: v.array(v.object({ id: v.string(), name: v.string(), type: v.union(v.literal("table"), v.literal("board"), v.literal("gallery"), v.literal("calendar")), config: v.any(), rank: v.string() })),
  rows: v.array(v.object({ id: v.string(), documentId: v.string(), rank: v.string(), values: v.array(v.object({ propertyId: v.string(), value: v.any() })) })),
});
const vPlainFileText = v.object({ blockId: v.string(), fileId: v.optional(v.string()), source: v.union(v.literal("pdf"), v.literal("image"), v.literal("handwriting")), by: v.union(v.literal("pdf"), v.literal("device"), v.literal("foli")), text: v.string(), pageStarts: v.optional(v.array(v.number())), hash: v.string() });

/**
 * Finishes unsealing one note: blocks and comments must be plaintext again; the server's collections and
 * found text are recreated from what the device opened; the sealed copies and records go; derived data is
 * computed again (search text, tasks, links, study cards, semantic index).
 */
export const finishUnseal = mutation({
  args: { documentId: v.string(), deviceId: v.string(), collections: v.array(vPlainCollection), fileTexts: v.array(vPlainFileText) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await heldDoc(ctx, profile, args.documentId, args.deviceId);
    await requireReadable(ctx, doc);
    const rows = await ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect();
    if (rows.some((r) => r.sealed !== undefined)) failE2ee("e2ee_plaintext", "Some blocks are still sealed.");
    const threads = await ctx.db.query("commentThreads").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(500);
    for (const t of threads) for (const c of await ctx.db.query("comments").withIndex("by_thread", (q) => q.eq("threadId", t._id)).take(500)) if (c.sealedBody) failE2ee("e2ee_plaintext", "Some comments are still sealed.");
    const scope = scopeOfRow(doc);
    const seq = await nextSeq(ctx, scope);
    const now = Date.now();
    for (const c of args.collections.slice(0, 50)) await recreateCollection(ctx, doc, c, seq);
    for (const f of args.fileTexts.slice(0, 500)) await recreateFileText(ctx, doc, f, profile._id);
    for (const r of await ctx.db.query("e2eeRecords").withIndex("by_document", (q) => q.eq("documentId", doc._id)).take(2000)) {
      if (r.kind === "collection" || r.kind === "fileText") await ctx.db.delete(r._id);
    }
    await ctx.db.patch(doc._id, { sealedAt: undefined, sealedTitle: undefined, sealedAppearance: undefined, sealedMeta: undefined, sealing: undefined, revision: doc.revision + 1, titleRev: doc.revision + 1, seq, updatedAt: now });
    const fresh = (await ctx.db.get(doc._id))!;
    for (const r of rows) {
      await syncTaskProjection(ctx, r, fresh, profile._id);
      await syncStudyCard(ctx, r, fresh);
      await syncLinks(ctx, fresh, r);
    }
    await refreshDerived(ctx, fresh, await liveBlocks(ctx, doc._id));
    await queueIndex(ctx, (await ctx.db.get(doc._id))!);
    const job = await activeJob(ctx, scope);
    if (job) await ctx.db.patch(job._id, { done: job.done + 1 });
    return null;
  },
});

async function recreateCollection(ctx: MutationCtx, doc: Doc<"documents">, c: typeof vPlainCollection.type, seq: number) {
  const existing = await ctx.db.query("collections").withIndex("by_public_id", (q) => q.eq("publicId", c.id)).unique();
  if (existing) return;
  const now = Date.now();
  const collectionId = await insertScoped(ctx, "collections", scopeOfRow(doc), { publicId: c.id, documentId: doc._id, name: c.name.slice(0, 200), createdAt: now, updatedAt: now, seq });
  const props = new Map<string, { id: Id<"collectionProperties">; type: Doc<"collectionProperties">["type"]; options: Doc<"collectionProperties">["options"] }>();
  for (const p of c.properties.slice(0, 200)) {
    const options = p.options ?? [];
    const id = await ctx.db.insert("collectionProperties", {
      publicId: p.id,
      collectionId,
      name: p.name.slice(0, 200),
      type: p.type,
      options,
      ...(p.formula !== undefined ? { formula: p.formula.slice(0, 5000) } : {}),
      ...(p.numberFormat ? { numberFormat: normalizeNumberFormat(p.numberFormat) } : {}),
      rank: p.rank,
      createdAt: now,
    });
    props.set(p.id, { id, type: p.type, options });
  }
  for (const view of c.views.slice(0, 50)) await ctx.db.insert("collectionViews", { publicId: view.id, collectionId, name: view.name.slice(0, 200), type: view.type, config: view.config, rank: view.rank, createdAt: now });
  for (const row of c.rows.slice(0, 5000)) {
    const rowDoc = await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", row.documentId)).unique();
    if (!rowDoc || scopeKey(scopeOfRow(rowDoc)) !== scopeKey(scopeOfRow(doc))) continue;
    const rowId = await ctx.db.insert("collectionRows", { publicId: row.id, collectionId, documentId: rowDoc._id, rank: row.rank, createdAt: now, updatedAt: now });
    await ctx.db.patch(rowDoc._id, { collectionId });
    for (const value of row.values) {
      const p = props.get(value.propertyId);
      if (!p) continue;
      await ctx.db.insert("collectionValues", { rowId, propertyId: p.id, collectionId, value: normalizeValue(p, value.value), updatedAt: now });
    }
  }
}

async function recreateFileText(ctx: MutationCtx, doc: Doc<"documents">, f: typeof vPlainFileText.type, by: Id<"profiles">) {
  let fileId: Id<"files"> | undefined;
  if (f.fileId) {
    const file = await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", f.fileId!)).unique();
    if (!file || file.documentId !== doc._id) return;
    fileId = file._id;
  }
  await insertScoped(ctx, "fileTexts", scopeOfRow(doc), {
    documentId: doc._id,
    ...(fileId ? { fileId } : {}),
    blockId: f.blockId,
    source: f.source,
    by: f.by,
    text: f.text.slice(0, 500_000),
    ...(f.pageStarts ? { pageStarts: f.pageStarts } : {}),
    hash: f.hash.slice(0, 128),
    createdBy: by,
    updatedAt: Date.now(),
  });
}
