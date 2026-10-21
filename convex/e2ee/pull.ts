// What a device's replica of an end-to-end encrypted space is fed from (docs/E2EE_DESIGN.md §5.3
// e2ee.pull, §6.5): every row of the space changed since a cursor, sealed as stored, filtered by what the
// caller may read. The device opens them; the server sends ciphertext and the visible structure only.
//
//   head      the scope's change counter (devices subscribe and pull when it moves)
//   pull      documents, blocks, folders, tags, records, note key wraps and the space row with seq > cursor
//   mine      the caller's stars, recents and hidden recents in the scope (per person, not in the replica's seq)
//   document  one sealed note for someone without a replica of its space (a guest)
//
// In a Standard space with locked folders or notes, only sealed notes (and their rows) and locked folders
// come (tags too: their names are plaintext there). WP3.
import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { accessAtLeast, documentAccess, documentAccessInfo, PageReader, requireDocument, requireProfile, resolveScope } from "../lib/auth";
import { headSeq } from "../lib/seq";
import { IdResolver, toWireBlock } from "../lib/documents";
import { scopeOfRow, vScopeArg, type Scope } from "../lib/scope";
import { isE2eeActive, spaceE2ee } from "../lib/e2ee/state";
import { sealedFieldsOf } from "../lib/e2ee/sealedRows";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

type SeqRow = { seq: number };
type Stream<T> = { rows: T[]; upTo: number };

/**
 * Rows of one table with seq > cursor through its `by_*_seq` index: at most `cap`, plus every row sharing
 * the last one's seq (rows of one mutation share it), so a page never splits a change.
 */
async function seqStream<T extends SeqRow>(
  page: (after: number) => { take(n: number): Promise<T[]> },
  exactly: (seq: number) => { collect(): Promise<T[]> },
  cursor: number,
  cap: number,
): Promise<Stream<T>> {
  const rows = await page(cursor).take(cap);
  if (rows.length < cap) return { rows, upTo: Infinity };
  const boundary = rows[rows.length - 1]!.seq;
  const rest = await exactly(boundary).collect();
  return { rows: [...rows.filter((r) => r.seq < boundary), ...rest], upTo: boundary };
}

function bySeq<T extends "documents" | "blocks" | "e2eeRecords" | "e2eeNoteKeys">(ctx: QueryCtx, table: T, scope: Scope, cursor: number, cap: number): Promise<Stream<Doc<T>>> {
  // The four tables share the index names by_owner_seq / by_workspace_seq.
  const base = () => ctx.db.query(table) as unknown as {
    withIndex(name: string, f: (q: { eq(f: string, v: unknown): { gt(f: string, v: number): unknown; eq(f: string, v: unknown): unknown } }) => unknown): { take(n: number): Promise<Doc<T>[]>; collect(): Promise<Doc<T>[]> };
  };
  const page = (after: number) =>
    scope.kind === "personal"
      ? base().withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).gt("seq", after))
      : base().withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).gt("seq", after));
  const exactly = (seq: number) =>
    scope.kind === "personal"
      ? base().withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).eq("seq", seq))
      : base().withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).eq("seq", seq));
  return seqStream(page as never, exactly as never, cursor, cap) as unknown as Promise<Stream<Doc<T>>>;
}

/** Folders and tags have a seq but no seq index: the scope's few hundred rows are read and filtered. */
async function smallTable<T extends "folders" | "tags">(ctx: QueryCtx, table: T, scope: Scope, cursor: number): Promise<Doc<T>[]> {
  const base = ctx.db.query(table) as unknown as { withIndex(name: string, f: (q: { eq(f: string, v: unknown): unknown }) => unknown): { take(n: number): Promise<Doc<T>[]> } };
  const rows = await (scope.kind === "personal" ? base.withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId)) : base.withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))).take(5000);
  return rows.filter((r) => r.seq > cursor);
}

/** A file of a note as the replica keeps it: sealed metadata, or plain fields while not converted yet. */
function pulledFile(f: Doc<"files">) {
  return {
    id: f.publicId,
    kind: f.kind,
    size: f.size,
    status: f.status,
    createdAt: f.createdAt,
    ...(f.sealed ? { sealed: f.sealed } : { plain: { filename: f.filename, mimeType: f.mimeType, width: f.width ?? null, height: f.height ?? null, palette: f.palette ?? null } }),
  };
}

async function pulledDocument(ctx: QueryCtx, ids: IdResolver, d: Doc<"documents">, inScope: boolean) {
  const tagLinks = inScope
    ? await ctx.db
        .query("documentTags")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .take(50)
    : [];
  const tagIds: string[] = [];
  for (const l of tagLinks) {
    const t = await ctx.db.get(l.tagId);
    if (t) tagIds.push(t.publicId);
  }
  const files = (
    await ctx.db
      .query("files")
      .withIndex("by_document", (q) => q.eq("documentId", d._id))
      .take(500)
  ).filter((f) => f.status === "ready");
  const sealed = sealedFieldsOf(d);
  return {
    id: d.publicId,
    kind: d.kind,
    parentDocumentId: await ids.document(d.parentDocumentId),
    folderId: inScope ? await ids.folder(d.folderId) : null,
    rank: d.rank,
    dailyDate: d.dailyDate ?? null,
    accessMode: d.accessMode,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    archivedAt: d.archivedAt ?? null,
    inTrash: d.inTrash,
    deletedAt: d.deletedAt ?? null,
    revision: d.revision,
    titleRev: d.titleRev,
    seq: d.seq,
    contentSeq: d.contentSeq,
    createdBy: d.createdBy as string,
    lastEditedBy: d.lastEditedBy as string,
    locked: d.locked === true,
    lockedVia: inScope ? await ids.folder(d.lockedVia) : null,
    tagIds,
    fileIds: d.fileIds ?? [],
    ...(sealed
      ? { sealed }
      : // Only while a migration hasn't reached this note: its readable fields as they are.
        { plain: { title: d.title, icon: d.icon ?? null, cover: d.cover, style: d.style, templateKey: d.templateKey ?? null, collectionId: d.collectionId ? ((await ctx.db.get(d.collectionId))?.publicId ?? null) : null } }),
    files: files.map(pulledFile),
  };
}

/** A page of changes. `nextCursor` is the seq to pass next time; `hasMore` asks for another page right away. */
export const pull = query({
  args: { scope: vScopeArg, cursor: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const head = await headSeq(ctx, scope);
    const space = await spaceE2ee(ctx, scope);
    const empty = { documents: [], blocks: [], folders: [], tags: [], records: [], noteKeys: [], space: null, nextCursor: head, hasMore: false, head };
    if (!space || (!isE2eeActive(space) && space.state === "off" && space.seq <= args.cursor)) return empty;
    // A Standard space with locks: only what is sealed (the rest the server serves as always).
    const sealedOnly = space.level === "standard" && space.state !== "disabling";
    const cap = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    const cursor = Math.max(0, args.cursor);
    const docs = await bySeq(ctx, "documents", scope, cursor, cap);
    const blocks = await bySeq(ctx, "blocks", scope, cursor, cap);
    const records = await bySeq(ctx, "e2eeRecords", scope, cursor, cap);
    const noteKeys = await bySeq(ctx, "e2eeNoteKeys", scope, cursor, cap);
    let upTo = Math.min(docs.upTo, blocks.upTo, records.upTo, noteKeys.upTo);
    const hasMore = upTo !== Infinity;
    if (!hasMore) upTo = head;

    const reader = new PageReader(ctx, profile, standing);
    const docCache = new Map<Id<"documents">, Doc<"documents"> | null>();
    const readable = new Map<Id<"documents">, boolean>();
    const canRead = async (id: Id<"documents"> | undefined): Promise<Doc<"documents"> | null> => {
      if (!id) return null;
      if (!docCache.has(id)) docCache.set(id, await ctx.db.get(id));
      const d = docCache.get(id) ?? null;
      if (!d) return null;
      if (!readable.has(id)) readable.set(id, (await reader.filter([d])).length > 0);
      return readable.get(id) ? d : null;
    };
    const wanted = (d: Doc<"documents">) => !sealedOnly || d.sealedAt !== undefined;

    const ids = new IdResolver(ctx);
    const outDocs = [];
    for (const d of docs.rows) {
      if (d.seq > upTo || !wanted(d)) continue;
      if (!(await canRead(d._id))) continue;
      outDocs.push(await pulledDocument(ctx, ids, d, true));
    }
    const outBlocks = [];
    for (const b of blocks.rows) {
      if (b.seq > upTo) continue;
      const d = await canRead(b.documentId);
      if (!d || !wanted(d)) continue;
      outBlocks.push({ documentId: d.publicId, block: toWireBlock(b), deleted: b.deletedAt !== undefined });
    }
    const outRecords = [];
    for (const r of records.rows) {
      if (r.seq > upTo) continue;
      if (r.profileId !== undefined && r.profileId !== profile._id) continue;
      let documentId: string | null = null;
      if (r.documentId) {
        const d = await canRead(r.documentId);
        if (!d) continue;
        documentId = d.publicId;
      }
      outRecords.push({ kind: r.kind, recordId: r.recordId, documentId, keyVersion: r.keyVersion, sealed: r.sealed, size: r.size, rev: r.rev, updatedAt: r.updatedAt, deletedAt: r.deletedAt ?? null, seq: r.seq });
    }
    const outKeys = [];
    for (const k of noteKeys.rows) {
      if (k.seq > upTo) continue;
      // Members open space-wrapped keys; a key wrapped for one person goes only to them; link wraps never here.
      if (k.wrappedBy === "link") continue;
      if (k.wrappedBy === "grant" && k.profileId !== profile._id) continue;
      const d = await canRead(k.documentId);
      if (!d) continue;
      outKeys.push({ documentId: d.publicId, version: k.version, wrappedBy: k.wrappedBy, spaceVersion: k.spaceVersion ?? null, wrapped: k.wrapped, statement: k.statement ?? null, seq: k.seq });
    }
    // Folders and tags: small tables, read whole and cut at the same boundary.
    const folderIds = new IdResolver(ctx);
    const outFolders = [];
    for (const f of await smallTable(ctx, "folders", scope, cursor)) {
      if (f.seq > upTo || (sealedOnly && !f.locked && !f.sealedName)) continue;
      outFolders.push({
        id: f.publicId,
        parentFolderId: await folderIds.folder(f.parentFolderId),
        rank: f.rank,
        color: f.color ?? null,
        locked: f.locked === true,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        deletedAt: f.deletedAt ?? null,
        seq: f.seq,
        ...(f.sealedName ? { sealedName: f.sealedName } : { name: f.name }),
      });
    }
    const outTags = [];
    for (const t of await smallTable(ctx, "tags", scope, cursor)) {
      if (t.seq > upTo) continue;
      outTags.push({ id: t.publicId, color: t.color, createdAt: t.createdAt, seq: t.seq, ...(t.sealedName ? { sealedName: t.sealedName, nameMac: t.nameMac ?? null } : { name: t.name }) });
    }
    const outSpace =
      space.seq > cursor && space.seq <= upTo
        ? {
            level: space.level,
            state: space.state,
            switches: space.switches,
            currentKeyVersion: space.currentKeyVersion,
            lockedCount: space.lockedCount,
            inboxDocumentId: await ids.document(space.inboxDocumentId),
            migrationId: (space.migrationId as string | undefined) ?? null,
            seq: space.seq,
          }
        : null;
    return { documents: outDocs, blocks: outBlocks, folders: outFolders, tags: outTags, records: outRecords, noteKeys: outKeys, space: outSpace, nextCursor: upTo, hasMore, head };
  },
});

/** The scope's change counter. */
export const head = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    return { seq: await headSeq(ctx, scope) };
  },
});

/** The caller's own stars, recents and hidden recents in the scope (small, reactive, never in the replica's seq). */
export const mine = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const ids = new IdResolver(ctx);
    const inThisScope = (row: { ownerProfileId?: Id<"profiles">; workspaceId?: Id<"workspaces"> }) =>
      scope.kind === "personal" ? row.ownerProfileId === scope.profileId : row.workspaceId === scope.workspaceId;
    const stars = [];
    for (const s of await ctx.db
      .query("stars")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(1000)) {
      if (!inThisScope(s)) continue;
      const id = await ids.document(s.documentId);
      if (id) stars.push({ documentId: id, at: s.createdAt });
    }
    const recents = [];
    for (const r of await ctx.db
      .query("recents")
      .withIndex("by_profile_viewed", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(200)) {
      if (!inThisScope(r)) continue;
      const id = await ids.document(r.documentId);
      if (id) recents.push({ documentId: id, viewedAt: r.viewedAt });
    }
    const hiddenBase = ctx.db.query("recentHidden");
    const hiddenRows = await (
      scope.kind === "personal"
        ? hiddenBase.withIndex("by_profile_owner", (q) => q.eq("profileId", profile._id).eq("ownerProfileId", scope.profileId))
        : hiddenBase.withIndex("by_profile_workspace", (q) => q.eq("profileId", profile._id).eq("workspaceId", scope.workspaceId))
    ).take(500);
    const hidden = [];
    for (const h of hiddenRows) {
      const id = await ids.document(h.documentId);
      if (id) hidden.push({ documentId: id, hiddenAt: h.hiddenAt });
    }
    return { stars, recents, hidden };
  },
});

/**
 * One sealed note for someone who has no replica of its space (a guest on a shared page, §8.4): the note's
 * row, the note key wraps they can open, its files' sealed metadata and its records. Blocks come from
 * blocks.list as for anyone.
 */
export const document = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    if (doc.sealedAt === undefined) return null;
    const info = await documentAccessInfo(ctx, profile, doc);
    const ids = new IdResolver(ctx);
    const keys = [];
    for (const k of await ctx.db
      .query("e2eeNoteKeys")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(500)) {
      const mine = (k.wrappedBy === "grant" && k.profileId === profile._id) || (k.wrappedBy === "space" && info.inScope);
      if (mine) keys.push({ version: k.version, wrappedBy: k.wrappedBy, spaceVersion: k.spaceVersion ?? null, wrapped: k.wrapped, statement: k.statement ?? null });
    }
    const records = [];
    for (const r of await ctx.db
      .query("e2eeRecords")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(2000)) {
      if (r.profileId !== undefined && r.profileId !== profile._id) continue;
      if (r.deletedAt !== undefined) continue;
      records.push({ kind: r.kind, recordId: r.recordId, keyVersion: r.keyVersion, sealed: r.sealed, rev: r.rev, updatedAt: r.updatedAt });
    }
    return {
      document: await pulledDocument(ctx, ids, doc, info.inScope),
      access: await documentAccess(ctx, profile, doc),
      noteKeys: keys,
      records,
      scope: scopeOfRow(doc).kind,
      canEdit: accessAtLeast(info.access, "write"),
    };
  },
});
