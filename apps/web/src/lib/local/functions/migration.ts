// The reads and the one write that moving a library needs, in local mode (convex/migration.ts and
// documents.importSnapshot; docs/LOCAL_MODE_PLAN.md §6, WP12). With them a library is read the same way an
// account is (lib/migrate/source.ts), and an account's history can come down into a library.
//
// migration.preflight is the account's (whether a library fits there): it's never asked of a library.
import { isValidId, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { paginate, sortKey } from "../paginate";
import type { LocalVersion } from "../store";
import { checkScope, requireProfile } from "./shared";

const VERSION_ORDINAL_KEY = "versionOrdinal";
/** As the server's (convex/documents.ts MAX_IMPORTED_*). */
const MAX_IMPORTED_SNAPSHOT_BYTES = 2_000_000;
const MAX_IMPORTED_SNAPSHOT_BLOCKS = 5000;
const MAX_IMPORTED_SNAPSHOTS_PER_NOTE = 200;

defineLocal(api.migration.documents, "query", async (ctx, args) => {
  checkScope(args.scope);
  await requireProfile(ctx);
  // A note whose file hasn't arrived on this device has no blocks here yet: it isn't listed (the move says
  // how many are still downloading, from the library's status).
  const docs = (await ctx.db.list("documents")).filter((d) => !d.pending);
  const result = paginate(docs, (d) => sortKey(String(d.seq).padStart(12, "0"), d.id), args.paginationOpts);
  return {
    page: result.page.map((d) => ({
      id: d.id,
      kind: d.kind,
      parentDocumentId: d.parentDocumentId,
      folderId: d.folderId,
      title: d.title,
      icon: d.icon,
      cover: d.cover,
      style: d.style,
      dailyDate: d.dailyDate,
      templateKey: d.templateKey,
      collectionId: d.collectionId,
      rank: d.rank,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      archivedAt: d.archivedAt,
      inTrash: d.inTrash,
      starred: d.starred,
      tagIds: [...d.tagIds],
      // Nothing in a library is shared or commented on.
      hasComments: false,
      shared: false,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
});

defineLocal(api.migration.fileTexts, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const rows = (await ctx.db.list("fileTexts", doc.id)).sort((a, b) => (a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : a.createdAt - b.createdAt)).slice(0, 500);
  const out = [];
  for (const r of rows) {
    if (r.fileId) {
      const file = await ctx.db.get("files", r.fileId);
      if (!file || file.documentId !== doc.id) continue;
    }
    out.push({ fileId: r.fileId, blockId: r.blockId, source: r.source, by: r.by, text: r.text, pageStarts: r.pageStarts, hash: r.hash });
  }
  return out;
});

/**
 * A version brought along from an account (convex/documents.ts importSnapshot): kept as it was, with the time
 * it was saved there. Sent again under the same id, the version it made.
 */
defineLocal(api.documents.importSnapshot, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  if (doc.inTrash) fail("forbidden", "Restore this document from Trash to edit it.");
  if (!isValidId(args.id)) fail("invalid_argument", "Invalid version id.");
  const versionId = `${doc.id}~${args.id}`;
  const existing = await ctx.db.get("versions", versionId, doc.id);
  if (existing) return { id: args.id, created: false };
  if (args.blocks.length > MAX_IMPORTED_SNAPSHOT_BLOCKS) fail("limit_exceeded", "That version has too many blocks to bring in.");
  const title = args.title.slice(0, 300);
  if (JSON.stringify({ title, icon: args.icon, style: args.style, blocks: args.blocks }).length > MAX_IMPORTED_SNAPSHOT_BYTES) fail("limit_exceeded", "That version is too big to bring in.");
  const versions = await ctx.db.list("versions", doc.id);
  if (versions.filter((v) => v.reason === "import").length >= MAX_IMPORTED_SNAPSHOTS_PER_NOTE) fail("limit_exceeded", "This note already has as much imported history as it can keep.");
  const ordinal = (((await ctx.db.get("meta", VERSION_ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", VERSION_ORDINAL_KEY, ordinal);
  const now = ctx.now();
  const name = (args.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  // The blocks as they were, ids and all (a version's blocks are never live).
  const blocks: WireBlock[] = args.blocks.map(({ revision: _revision, ...b }) => structuredClone(b) as WireBlock);
  const version: LocalVersion = {
    id: versionId,
    documentId: doc.id,
    reason: "import",
    name,
    title,
    icon: args.icon,
    ...(args.style ? { style: args.style } : {}),
    blocks,
    blockCount: blocks.length,
    // Never the note's own: an imported version never stands for "nothing changed since".
    contentSeq: -1,
    createdAt: Number.isFinite(args.createdAt) ? Math.max(0, Math.min(args.createdAt, now)) : now,
    ordinal,
    deviceId: ctx.deviceId,
    editors: [ctx.deviceId],
    authors: {},
    removed: {},
  };
  ctx.db.put("versions", version.id, version, doc.id);
  return { id: args.id, created: true };
});
