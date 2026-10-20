// Version history in local mode (convex/documents.ts, "snapshots / version history"): saving a version, the
// list, a version's content, who changed what, naming, copying and restoring. A version holds the note's
// title, icon, look and blocks as they were (Phase 2: an immutable file in history/<noteId>/, plan §3.8).
//
// Where the server names people, local mode names devices: the library has one person, so "who edited" is
// which device did (shared.ts Devices, in the shape of the server's PersonView).
import { cloneBlocks, ulid, type WireBlock } from "@folevi/editor-schema";
import type { Doc } from "@/lib/convex/api";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal, type LocalMutationCtx, type LocalReader } from "../registry";
import { versionDocumentId, type LocalBlock, type LocalDocument, type LocalVersion } from "../store";
import { copyCollectionsInto } from "./collections";
import { Devices, insertDocument, linksAfter, liveBlocks, ReaderLabels, refreshDerived, refreshSyncedSource, requireProfile, toSummary, toWireBlock } from "./shared";

type Reason = Doc<"documentSnapshots">["reason"];

const MAX_VERSION_NAME = 80;
const VERSION_ORDINAL_KEY = "versionOrdinal";

/** A version's name as stored: one line, at most 80 characters, none when empty. */
function versionName(raw: string | undefined): string | null {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_VERSION_NAME) || null;
}

const newestFirst = (a: LocalVersion, b: LocalVersion) => b.createdAt - a.createdAt || b.ordinal - a.ordinal;

/** A note's versions, newest first (the server's by_document index, read descending). */
export async function versionsOf(db: LocalReader, documentId: string): Promise<LocalVersion[]> {
  return (await db.list("versions", documentId)).sort(newestFirst);
}

/** A version by its id, with its note; not_found as the server says it when either is gone. */
async function versionById(db: LocalReader, versionId: string): Promise<{ version: LocalVersion; doc: LocalDocument }> {
  const documentId = versionDocumentId(versionId);
  const version = documentId ? await db.get("versions", versionId, documentId) : undefined;
  if (!version) fail("not_found", "Version not found.");
  const doc = await db.get("documents", version.documentId);
  if (!doc) fail("not_found", "Version not found.");
  return { version, doc };
}

/** Blocks made first come first (the order the server's indexes keep a note's blocks in). */
const byCreation = (rows: LocalBlock[]) => [...rows].sort((a, b) => a.createdAt - b.createdAt);

/**
 * Saves a version of a note when it changed since the last one (documents.ts snapshot). Versions saved
 * before a restore or an AI agent's changes are always new, so restoring them brings back exactly that
 * moment. With nothing new to keep, naming "the current version" names the one that already holds it.
 */
export async function saveVersion(ctx: LocalMutationCtx, doc: LocalDocument, reason: Reason, name?: string | null): Promise<{ created: boolean; id?: string }> {
  const [last] = await versionsOf(ctx.db, doc.id);
  if (last && last.contentSeq === doc.contentSeq && last.title === doc.title && reason !== "before_restore" && reason !== "ai_run") {
    if (name && last.name !== name) ctx.db.put("versions", last.id, { ...last, name }, doc.id);
    return { created: false, id: last.id };
  }
  // Who did what since the version before: each block's last editor, and who deleted what's gone since.
  const since = last?.createdAt ?? 0;
  const here = ctx.deviceId;
  const rows = byCreation(await liveBlocks(ctx.db, doc.id));
  const authors: Record<string, [string, number]> = {};
  const changes = new Map<string, number>();
  const count = (device: string) => changes.set(device, (changes.get(device) ?? 0) + 1);
  for (const r of rows) {
    authors[r.id] = [r.updatedByDevice ?? here, r.updatedAt];
    if (r.updatedAt >= since) count(r.updatedByDevice ?? here);
  }
  const removed: Record<string, [string, number]> = {};
  if (last) {
    const gone = (await ctx.db.list("blocks", doc.id)).filter((b) => b.deletedAt !== null && b.deletedAt >= since).sort((a, b) => a.deletedAt! - b.deletedAt! || a.createdAt - b.createdAt);
    for (const r of gone.slice(0, 2000)) {
      removed[r.id] = [r.updatedByDevice ?? here, r.deletedAt!];
      count(r.updatedByDevice ?? here);
    }
    if (doc.title !== last.title) count(doc.editedByDevice ?? here);
  } else if (!changes.size) count(doc.editedByDevice ?? here);
  const editors = [...changes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => id);
  const ordinal = (((await ctx.db.get("meta", VERSION_ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", VERSION_ORDINAL_KEY, ordinal);
  const blocks = rows.map(toWireBlock);
  const version: LocalVersion = {
    id: `${doc.id}~${ulid()}`,
    documentId: doc.id,
    reason,
    name: name ?? null,
    title: doc.title,
    icon: doc.icon,
    ...(doc.style !== undefined ? { style: doc.style } : {}),
    blocks,
    blockCount: blocks.length,
    contentSeq: doc.contentSeq,
    createdAt: ctx.now(),
    ordinal,
    deviceId: here,
    editors,
    authors,
    removed,
  };
  ctx.db.put("versions", version.id, version, doc.id);
  return { created: true, id: version.id };
}

defineLocal(api.documents.createSnapshot, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  return await saveVersion(ctx, doc, args.reason, versionName(args.name));
});

defineLocal(api.documents.versions, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const all = await versionsOf(ctx.db, doc.id);
  const rows = args.namedOnly
    ? all
        .filter((v) => v.name)
        .sort((a, b) => (a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : a.ordinal - b.ordinal))
        .slice(0, 200)
        .sort((a, b) => b.createdAt - a.createdAt)
    : all.slice(0, 200);
  const devices = new Devices(ctx.db, ctx.deviceId);
  // The version each one is compared with: the one saved just before it (a named version's isn't listed).
  const previous = (i: number) => {
    if (!args.namedOnly && i + 1 < rows.length) return rows[i + 1]!.id;
    const r = rows[i]!;
    return all.find((v) => v.createdAt < r.createdAt)?.id ?? null;
  };
  const versions = [];
  for (const [i, r] of rows.entries()) {
    const editors = r.editors.length ? r.editors : [r.deviceId];
    versions.push({
      id: r.id,
      previousId: previous(i),
      reason: r.reason,
      name: r.name,
      title: r.title,
      blockCount: r.blockCount,
      createdAt: r.createdAt,
      editors: await Promise.all(editors.map(async (e) => (await devices.get(e)).key)),
      // Local only: a version kept because the same block (or the title) changed on two devices at once.
      // Version history labels it "Changed on another device" (components/doc/VersionHistory.tsx).
      ...(r.conflict ? { conflict: { target: r.conflict.target, device: (await devices.get(r.conflict.device)).name } } : {}),
    });
  }
  return { versions, people: await devices.all(), current: { contentSeq: doc.contentSeq, latestContentSeq: rows[0]?.contentSeq ?? null } };
});

defineLocal(api.documents.snapshotContent, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const documentId = versionDocumentId(args.snapshotId);
  const version = documentId ? await ctx.db.get("versions", args.snapshotId, documentId) : undefined;
  if (!version) return null;
  const doc = await ctx.db.get("documents", version.documentId);
  if (!doc) return null;
  const devices = new Devices(ctx.db, ctx.deviceId);
  // As lists of [block id, device key, time], as the server sends them (an object can't go over the wire past 1024 keys).
  const attribution = async (map: Record<string, [string, number]>) => {
    const out: [string, string, number][] = [];
    for (const [blockId, [device, at]] of Object.entries(map)) out.push([blockId, (await devices.get(device)).key, at]);
    return out;
  };
  const authors = await attribution(version.authors);
  const removed = await attribution(version.removed);
  // Links in an old version show the linked notes' current titles, like the live note.
  const blocks = await new ReaderLabels(ctx.db).blocks(version.blocks);
  return {
    content: JSON.stringify({ title: version.title, icon: version.icon, style: version.style, blocks }),
    authors,
    removed,
    people: await devices.all(),
  };
});

defineLocal(api.documents.blockAuthors, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const devices = new Devices(ctx.db, ctx.deviceId);
  const authors: [string, string, number][] = [];
  for (const r of byCreation(await liveBlocks(ctx.db, doc.id))) authors.push([r.id, (await devices.get(r.updatedByDevice)).key, r.updatedAt]);
  // And, for version history, which device deleted what since the version it's compared with.
  const removed: [string, string, number][] = [];
  const latest = args.since && versionDocumentId(args.since) === doc.id ? await ctx.db.get("versions", args.since, doc.id) : undefined;
  if (latest) {
    const gone = (await ctx.db.list("blocks", doc.id))
      .filter((b) => b.deletedAt !== null && b.deletedAt >= latest.createdAt)
      .sort((a, b) => a.deletedAt! - b.deletedAt! || a.createdAt - b.createdAt)
      .slice(0, 2000);
    for (const r of gone) removed.push([r.id, (await devices.get(r.updatedByDevice)).key, r.deletedAt!]);
  }
  return { authors, removed, people: await devices.all() };
});

defineLocal(api.documents.nameVersion, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const { version } = await versionById(ctx.db, args.snapshotId);
  ctx.db.put("versions", version.id, { ...version, name: versionName(args.name) }, version.documentId);
  return null;
});

defineLocal(api.documents.copyVersion, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const { version, doc } = await versionById(ctx.db, args.snapshotId);
  const copy = await insertDocument(ctx, {
    title: `${version.name ?? version.title ?? "Untitled"} (copy)`.slice(0, 500),
    icon: version.icon ?? doc.icon,
    kind: doc.kind === "template" ? "template" : "document",
    folderId: doc.folderId,
    parentDocumentId: doc.parentDocumentId,
    style: version.style ?? doc.style,
    cover: doc.cover,
    // The bytes of its files are shared, never copied: an attachment stays while any note refers to it (plan §3.8).
    blocks: cloneBlocks(version.blocks),
  });
  // Its databases are its own, as on the server: rows edited in the copy don't change the original.
  await copyCollectionsInto(ctx, copy.id);
  return toSummary((await ctx.db.get("documents", copy.id)) ?? copy, profile.id);
});

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Rewrites a note to hold exactly `content` (title, icon, look when given, and blocks, ids kept), after saving
 * the note as it is now so the restore can itself be undone (documents.ts rewritePage). The changes are new
 * local edits, made by this device.
 */
export async function rewriteNote(ctx: LocalMutationCtx, doc: LocalDocument, content: { title: string; icon: string | null; style?: LocalDocument["style"]; blocks: WireBlock[] }): Promise<{ undoVersionId: string | null }> {
  const before = await saveVersion(ctx, doc, "before_restore");
  const seq = await ctx.nextSeq();
  const now = ctx.now();
  const device = ctx.deviceId;
  const current = await ctx.db.list("blocks", doc.id);
  const byId = new Map(current.map((b) => [b.id, b]));
  const keep = new Set(content.blocks.map((b) => b.id));
  for (const b of content.blocks) {
    const existing = byId.get(b.id);
    if (existing) {
      // Lines that are already as they were stay untouched: they keep which device wrote them.
      const sameContent = existing.type === b.type && sameJson(existing.text, b.text) && sameJson(existing.props, b.props);
      const samePlace = existing.deletedAt === null && existing.parentId === b.parentId && existing.rank === b.rank;
      if (sameContent && samePlace) continue;
      const revision = existing.revision + 1;
      const row: LocalBlock = {
        ...existing,
        parentId: b.parentId,
        rank: b.rank,
        type: b.type,
        schemaVersion: b.schemaVersion,
        text: b.text,
        props: b.props,
        deletedAt: null,
        revision,
        contentRev: sameContent ? existing.contentRev : revision,
        positionRev: samePlace ? existing.positionRev : revision,
        seq,
        updatedAt: now,
        updatedByDevice: device,
      };
      ctx.db.put("blocks", row.id, row, doc.id);
    } else {
      const row: LocalBlock = {
        id: b.id,
        documentId: doc.id,
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
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        updatedByDevice: device,
      };
      ctx.db.put("blocks", row.id, row, doc.id);
    }
  }
  for (const b of current) {
    if (keep.has(b.id) || b.deletedAt !== null) continue;
    const row: LocalBlock = { ...b, deletedAt: now, revision: b.revision + 1, seq, updatedAt: now, updatedByDevice: device };
    ctx.db.put("blocks", row.id, row, doc.id);
  }
  const revision = doc.revision + 1;
  let fresh: LocalDocument = {
    ...doc,
    title: content.title,
    icon: content.icon ?? null,
    // The note's look as it was then too (versions saved before looks were kept leave it as it is).
    ...(content.style !== undefined ? { style: content.style } : {}),
    revision,
    titleRev: revision,
    seq,
    contentSeq: doc.contentSeq + 1,
    updatedAt: now,
    editedByDevice: device,
  };
  // Every block's links as they are now (the server syncs links for all of the note's blocks here).
  const all = await ctx.db.list("blocks", doc.id);
  const linksBefore = new Set((doc.links ?? []).map((l) => l.target));
  fresh = { ...fresh, links: await linksAfter(ctx, fresh, all) };
  fresh = await refreshDerived(ctx.db, fresh);
  ctx.db.put("documents", fresh.id, fresh);
  const linksNow = new Set((fresh.links ?? []).map((l) => l.target));
  for (const t of new Set([...linksBefore, ...linksNow])) if (linksBefore.has(t) !== linksNow.has(t)) await refreshSyncedSource(ctx, t);
  return { undoVersionId: before.id ?? null };
}

defineLocal(api.documents.restoreSnapshot, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const { version, doc } = await versionById(ctx.db, args.snapshotId);
  return await rewriteNote(ctx, doc, { title: version.title, icon: version.icon, style: version.style, blocks: version.blocks });
});
