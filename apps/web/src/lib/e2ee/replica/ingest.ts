// Pull pages into the replica (docs/E2EE_DESIGN.md §6.5, WP7): every row opened with the key ring, then the
// derived fields (search text, excerpt, preview, counts, links) computed by the same shared code the local
// backend uses on its own writes (lib/local/functions/shared.ts refreshDerived), so device queries answer
// exactly as local mode would for the same notes.
//
// Ingest is idempotent: a row already held at the same or a newer revision (or seq) is left as it is, so the
// pull delivering the router's own accepted writes again changes nothing.
import { blockLinkTargets, DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, normalizeForSearch, type OpResult, type SyncOp, type WireBlock, type WireDocumentCreate } from "@folevi/editor-schema";
import type { Doc } from "@/lib/convex/api";
import { refreshDerived, type LocalProfile } from "@/lib/local/functions/shared";
import type { LocalWriter } from "@/lib/local/registry";
import type {
  LocalBlock,
  LocalCollection,
  LocalCollectionRow,
  LocalDocument,
  LocalFile,
  LocalFileText,
  LocalFolder,
  LocalLink,
  LocalRecent,
  LocalStudyReview,
  LocalTable,
  LocalTables,
  LocalTag,
  StoreWrite,
} from "@/lib/local/store";
import { Sealer, isUnreadableBlock, unreadableBlock } from "../seal";
import type { KeyRingLike, WireScope } from "../router/deps";
import type { E2eePullPage, PulledBlock, PulledDocument, PulledFile, PulledFolder, PulledMine, PulledRecord, PulledTag } from "../router/refs";
import type { SpaceReplicaStore } from "./store";

const slot = (table: LocalTable, id: string, partition?: string) => `${table}\u0000${partition ?? ""}\u0000${id}`;

/** Reads through the writes staged so far, then the store: what one ingest commit will look like. */
class Staged implements LocalWriter {
  private writes = new Map<string, StoreWrite>();
  constructor(private store: SpaceReplicaStore) {}

  async get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined> {
    const w = this.writes.get(slot(table, id, partition));
    if (w) return w.value === null ? undefined : (w.value as LocalTables[T]);
    return await this.store.get(table, id, partition);
  }

  async list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]> {
    const base = await this.store.list(table, partition);
    const own = [...this.writes.values()].filter((w) => w.table === table && (partition === undefined || w.partition === partition));
    if (!own.length) return base;
    const changed = new Set(own.map((w) => w.id));
    const kept = base.filter((r) => !changed.has((r as { id?: string }).id ?? ""));
    for (const w of own) if (w.value !== null) kept.push(w.value as LocalTables[T]);
    return kept;
  }

  put<T extends LocalTable>(table: T, id: string, value: LocalTables[T], partition?: string): void {
    this.writes.set(slot(table, id, partition), { table, id, partition, value } as StoreWrite);
  }

  remove(table: LocalTable, id: string, partition?: string): void {
    this.writes.set(slot(table, id, partition), { table, id, partition, value: null } as StoreWrite);
  }

  pending(): StoreWrite[] {
    return [...this.writes.values()];
  }
}

export interface IngestContext {
  store: SpaceReplicaStore;
  sealer: Sealer;
  keyring: KeyRingLike;
  scope: WireScope;
  /** `personal:<id>` / `workspace:<id>` (§4.5). */
  scopeId: string;
  /** The person (users.me's profile): the local handlers read it as the library's profile. */
  profile: LocalProfile;
  /** A workspace's name (what answers call the place: search's places, an export's name). */
  placeName?: string;
  /** Every id this ingest saw, for the router's space index. */
  onIds?(ids: IngestedIds): void;
}

export interface IngestedIds {
  documents: { id: string; sealed: boolean; title?: string; icon?: string | null }[];
  removed: string[];
  folders: string[];
  tags: string[];
  files: { id: string; documentId: string | null }[];
  collections: { id: string; documentId: string }[];
  /** Blocks seen (tasks and study cards are named by block id alone). */
  blocks: { id: string; documentId: string }[];
}

const ORDINAL_KEY = "documentOrdinal";
const LINK_ORDINAL_KEY = "linkOrdinal";

/** The local backend's profile key (lib/local/functions/shared.ts PROFILE_KEY). */
const PROFILE_KEY = "profile";

export class ReplicaIngest {
  constructor(private readonly c: IngestContext) {}


  /** Makes sure the handlers find the person's profile. */
  async ensureProfile(): Promise<void> {
    const held = await this.c.store.get("meta", PROFILE_KEY);
    const place = await this.c.store.get("meta", "place");
    const writes: StoreWrite[] = [];
    if (JSON.stringify(held) !== JSON.stringify(this.c.profile)) writes.push({ table: "meta", id: PROFILE_KEY, value: this.c.profile });
    // The handlers' one place: a Personal, or (this replica) a team workspace (lib/local/functions/shared.ts isPersonalPlace).
    const want = { ...this.c.scope, ...(this.c.placeName ? { name: this.c.placeName } : {}) };
    if (JSON.stringify(place) !== JSON.stringify(want)) writes.push({ table: "meta", id: "place", value: want });
    if (writes.length) await this.c.store.ingest(writes);
  }

  /** One pull page: opened, derived, committed together. Returns how many notes the replica holds now. */
  async page(page: E2eePullPage): Promise<void> {
    if (page.noteKeys.length) await this.c.keyring.addNoteKeys(page.noteKeys.map((k) => ({ ...k, scope: this.c.scope })));
    const tx = new Staged(this.c.store);
    const touched = new Set<string>();
    const ids: IngestedIds = { documents: [], removed: [], folders: [], tags: [], files: [], collections: [], blocks: [] };

    for (const d of page.documents) {
      const doc = await this.document(tx, d);
      if (!doc) continue;
      tx.put("documents", doc.id, doc);
      touched.add(doc.id);
      ids.documents.push({ id: doc.id, sealed: d.sealed !== undefined, title: doc.title, icon: doc.icon });
      // The note's files as they are now (a file change moves the note's seq and revision, nothing else):
      // ones no longer listed go.
      const listed = new Set((d.files ?? []).map((f) => f.id));
      for (const held of await tx.list("files")) {
        if (held.documentId !== d.id || listed.has(held.id)) continue;
        tx.remove("files", held.id);
        tx.remove("meta", `fileKey:${held.id}`);
      }
      for (const f of d.files ?? []) {
        const file = await this.file(f, d.id);
        if (file) {
          tx.put("files", file.id, file);
          if (f.sealed) tx.put("meta", `fileKey:${file.id}`, { documentId: d.id, ...f.sealed });
          ids.files.push({ id: file.id, documentId: file.documentId });
        }
      }
    }
    for (const b of page.blocks) {
      const row = await this.block(tx, b, page.nextCursor);
      if (!row) continue;
      tx.put("blocks", row.id, row, row.documentId);
      touched.add(row.documentId);
      ids.blocks.push({ id: row.id, documentId: row.documentId });
    }
    for (const f of page.folders) {
      const folder = await this.folder(tx, f);
      if (folder) {
        tx.put("folders", folder.id, folder);
        ids.folders.push(folder.id);
      }
    }
    for (const t of page.tags) {
      if (t.deletedAt) {
        tx.remove("tags", t.id);
        continue;
      }
      const tag = await this.tag(t, tx);
      if (tag) {
        tx.put("tags", tag.id, tag);
        ids.tags.push(tag.id);
      }
    }
    for (const r of page.records) {
      const collection = await this.record(tx, r);
      if (collection) ids.collections.push(collection);
    }
    // Deleted for good (WP3's tombstones): the note with its blocks, records and files; a tag from every note.
    for (const r of page.removed ?? []) {
      if (r.kind === "document") {
        if (!(await tx.get("documents", r.id))) continue;
        await this.removeDocument(tx, r.id);
        touched.delete(r.id);
        ids.removed.push(r.id);
      } else if (r.kind === "tag") {
        if (!(await tx.get("tags", r.id))) continue;
        tx.remove("tags", r.id);
        for (const d of await tx.list("documents")) if (d.tagIds.includes(r.id)) tx.put("documents", d.id, { ...d, tagIds: d.tagIds.filter((t) => t !== r.id) });
      }
    }
    if (page.space) tx.put("meta", "space", page.space);

    await this.derive(tx, touched);
    await this.c.store.ingest(tx.pending());
    this.c.onIds?.(ids);
  }

  /** The person's profile changed (a setting the handlers read, like new study cards a day). */
  async setProfile(profile: LocalProfile): Promise<void> {
    this.c.profile = profile;
    await this.ensureProfile();
  }

  /** The person's stars and recents in the space (e2ee.pull.mine). */
  async mine(mine: PulledMine): Promise<void> {
    const tx = new Staged(this.c.store);
    const stars = new Map(mine.stars.map((s, i) => [s.documentId, { at: s.at, order: i + 1 }]));
    for (const d of await this.c.store.list("documents")) {
      const star = stars.get(d.id);
      const starred = star !== undefined;
      const starOrder = star ? star.order : null;
      if (d.starred !== starred || (d.starOrder ?? null) !== starOrder) tx.put("documents", d.id, { ...d, starred, starOrder });
    }
    const keep = new Set<string>();
    const rows = new Map<string, LocalRecent>();
    // Newest visit first from the server; ordinals count up in the order visits were made.
    const visits = [...mine.recents].reverse();
    visits.forEach((r, i) => rows.set(r.documentId, { documentId: r.documentId, viewedAt: r.viewedAt, hiddenAt: null, ordinal: i + 1 }));
    for (const h of mine.hidden ?? []) {
      const row = rows.get(h.documentId) ?? { documentId: h.documentId, viewedAt: null, hiddenAt: null, ordinal: 0 };
      rows.set(h.documentId, { ...row, hiddenAt: h.hiddenAt });
    }
    for (const [id, row] of rows) {
      keep.add(id);
      const had = await this.c.store.get("recents", id);
      if (JSON.stringify(had) !== JSON.stringify(row)) tx.put("recents", id, row);
    }
    for (const r of await this.c.store.list("recents")) if (!keep.has(r.documentId)) tx.remove("recents", r.documentId);
    await this.c.store.ingest(tx.pending());
  }

  /**
   * The router's own writes the server accepted (§6.5): applied at once, so a device query right after the
   * mutation already sees them. `ops` are the plaintext ops that were sent, matched to `results` by op id.
   */
  async accepted(results: readonly (OpResult & { document?: unknown })[], ops: readonly SyncOp[]): Promise<void> {
    const byOp = new Map(ops.map((o) => [o.opId, o]));
    const tx = new Staged(this.c.store);
    const touched = new Set<string>();
    const now = Date.now();
    for (const r of results) {
      if (r.status !== "applied" && r.status !== "duplicate") continue;
      const op = byOp.get(r.opId);
      if (!op) continue;
      if (op.kind === "block.upsert" || op.kind === "block.restore") {
        const block = r.block ?? (op.kind === "block.upsert" ? op.block : null);
        if (!block) continue;
        const prev = await tx.get("blocks", block.id, op.documentId);
        const revision = r.revision ?? block.revision ?? (prev?.revision ?? 0) + 1;
        if (prev && prev.revision > revision) continue;
        tx.put("blocks", block.id, this.toLocalBlock(op.documentId, { ...block, revision }, prev, now), op.documentId);
        touched.add(op.documentId);
      } else if (op.kind === "block.delete") {
        const prev = await tx.get("blocks", op.blockId, op.documentId);
        if (prev) tx.put("blocks", prev.id, { ...prev, deletedAt: now, revision: r.revision ?? prev.revision + 1 }, op.documentId);
        touched.add(op.documentId);
      } else if (op.kind === "document.create" || op.kind === "document.update") {
        const id = op.kind === "document.create" ? op.document.id : op.documentId;
        const summary = r.document as Partial<LocalDocument> & { id?: string; deletedAt?: number | null } | undefined;
        const prev = await tx.get("documents", id);
        const base = prev ?? (op.kind === "document.create" ? this.newDocumentFromCreate(op.document, now) : null);
        if (!base) continue;
        const patch = op.kind === "document.update" ? op.patch : op.document;
        const next: LocalDocument = {
          ...base,
          // The server's answer, opened, is what was stored (a cleaned-up title, the icon picked for it).
          title: typeof summary?.title === "string" && summary.title !== undefined && (patch.title !== undefined || op.kind === "document.create") ? summary.title : (patch.title ?? base.title),
          icon: summary && "icon" in summary ? (summary.icon ?? null) : patch.icon !== undefined ? patch.icon : base.icon,
          cover: (patch.cover ?? base.cover) as LocalDocument["cover"],
          style: (patch.style ?? base.style) as LocalDocument["style"],
          folderId: patch.folderId !== undefined ? patch.folderId : base.folderId,
          parentDocumentId: patch.parentDocumentId !== undefined ? patch.parentDocumentId : base.parentDocumentId,
          revision: summary?.revision ?? r.revision ?? base.revision,
          titleRev: summary?.titleRev ?? base.titleRev,
          seq: summary?.seq ?? base.seq,
          updatedAt: summary?.updatedAt ?? now,
        };
        if (summary?.rank) next.rank = summary.rank;
        tx.put("documents", id, next);
        touched.add(id);
      }
    }
    await this.derive(tx, touched);
    await this.c.store.ingest(tx.pending());
  }

  // ---- rows -------------------------------------------------------------------------------------------

  private async nextOrdinal(tx: Staged, key: string): Promise<number> {
    const n = (((await tx.get("meta", key)) as number | undefined) ?? 0) + 1;
    tx.put("meta", key, n);
    return n;
  }

  private newDocumentFromCreate(d: Pick<WireDocumentCreate, "id" | "parentDocumentId" | "folderId" | "kind" | "title" | "icon" | "cover" | "style" | "dailyDate" | "collectionId">, now: number): LocalDocument {
    return {
      id: d.id,
      parentDocumentId: d.parentDocumentId,
      folderId: d.folderId,
      kind: d.kind,
      title: d.title,
      icon: d.icon,
      cover: (d.cover ?? DEFAULT_COVER) as LocalDocument["cover"],
      style: (d.style ?? DEFAULT_DOCUMENT_STYLE) as LocalDocument["style"],
      dailyDate: d.dailyDate ?? null,
      templateKey: null,
      collectionId: d.collectionId ?? null,
      rank: "",
      createdAt: now,
      ordinal: 0,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      inTrash: false,
      revision: 1,
      titleRev: 1,
      seq: 0,
      contentSeq: 0,
      searchText: d.title,
      wordCount: 0,
      charCount: 0,
      blockCount: 0,
      excerpt: "",
      preview: null,
      starred: false,
      tagIds: [],
    };
  }

  private async document(tx: Staged, d: PulledDocument): Promise<LocalDocument | null> {
    const prev = await tx.get("documents", d.id);
    if (prev && prev.seq > d.seq) return null;
    let title = "";
    let icon: string | null = null;
    let cover: unknown = DEFAULT_COVER;
    let style: unknown = DEFAULT_DOCUMENT_STYLE;
    let templateKey: string | null = null;
    let row: LocalCollectionRow | null = null;
    let collectionId: string | null = null;
    if (d.sealed) {
      try {
        const opened = await this.c.sealer.openDocumentFields(d.id, d.sealed);
        title = opened.title;
        icon = opened.icon;
        cover = opened.cover;
        style = opened.style;
        templateKey = opened.templateKey;
        if (opened.row) {
          const prevRow = prev?.row ?? null;
          row = {
            id: opened.row.id ?? prevRow?.id ?? d.id,
            collectionId: opened.row.collectionId,
            rank: opened.row.rank,
            values: opened.row.values,
            createdAt: opened.row.createdAt ?? prevRow?.createdAt ?? d.createdAt,
            updatedAt: d.updatedAt,
            deletedAt: d.inTrash ? (d.deletedAt ?? d.updatedAt) : null,
          };
          collectionId = opened.row.collectionId;
        }
      } catch {
        console.warn(`[e2ee] A note's title couldn't be decrypted (${d.id}).`);
      }
    } else if (d.plain) {
      title = d.plain.title;
      icon = d.plain.icon;
      cover = d.plain.cover ?? DEFAULT_COVER;
      style = d.plain.style ?? DEFAULT_DOCUMENT_STYLE;
      templateKey = d.plain.templateKey ?? null;
      collectionId = d.plain.collectionId ?? null;
    }
    const base: LocalDocument = prev ?? {
      ...this.newDocumentFromCreate({ id: d.id, parentDocumentId: d.parentDocumentId, folderId: d.folderId, kind: d.kind as LocalDocument["kind"], title, icon }, d.createdAt),
      ordinal: await this.nextOrdinal(tx, ORDINAL_KEY),
    };
    const doc: LocalDocument = {
      ...base,
      parentDocumentId: d.parentDocumentId,
      folderId: d.folderId,
      kind: d.kind as LocalDocument["kind"],
      title,
      icon,
      cover: cover as LocalDocument["cover"],
      style: style as LocalDocument["style"],
      dailyDate: d.dailyDate,
      templateKey,
      collectionId,
      rank: d.rank,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      archivedAt: d.archivedAt,
      deletedAt: d.inTrash ? (d.deletedAt ?? d.updatedAt) : null,
      inTrash: d.inTrash,
      revision: d.revision,
      titleRev: d.titleRev,
      seq: d.seq,
      contentSeq: d.contentSeq,
      tagIds: d.tagIds ?? [],
      row,
      // Locks travel plainly: features read them here instead of asking the server per note (WP8).
      locked: d.locked === true,
      lockedVia: d.lockedVia ?? null,
      ...(d.createdBy ? { createdBy: d.createdBy } : {}),
    };
    return doc;
  }

  private toLocalBlock(documentId: string, b: WireBlock, prev: LocalBlock | undefined, now: number, row?: { revision?: number; seq?: number; createdAt?: number; updatedAt?: number; contentRev?: number; positionRev?: number; deletedAt?: number | null }): LocalBlock {
    const revision = b.revision ?? row?.revision ?? (prev?.revision ?? 0) + 1;
    return {
      id: b.id,
      type: b.type,
      parentId: b.parentId,
      rank: b.rank,
      schemaVersion: b.schemaVersion,
      text: b.text,
      props: b.props,
      documentId,
      revision,
      contentRev: row?.contentRev ?? revision,
      positionRev: row?.positionRev ?? revision,
      seq: row?.seq ?? prev?.seq ?? 0,
      deletedAt: row?.deletedAt ?? null,
      createdAt: row?.createdAt ?? prev?.createdAt ?? now,
      updatedAt: row?.updatedAt ?? now,
    };
  }

  private blockClock = 0;

  private async block(tx: Staged, p: PulledBlock, seq: number): Promise<LocalBlock | null> {
    const b = p.block;
    const prev = await tx.get("blocks", b.id, p.documentId);
    const revision = b.revision ?? (prev?.revision ?? 0) + 1;
    // A row held as "couldn't be decrypted" (its key wasn't here yet) is opened again when it comes back.
    if (prev && prev.revision >= revision && (prev.deletedAt !== null) === p.deleted && !isUnreadableBlock(prev)) return null;
    const shell = { id: b.id, parentId: b.parentId, rank: b.rank, revision };
    let wire: WireBlock;
    if (p.deleted && b.sealed) {
      // A tombstone keeps its place; its content is opened only if it can be (restore shows it again).
      wire = await this.c.sealer.openBlock(p.documentId, { ...shell, sealed: b.sealed }).catch(() => unreadableBlock(shell));
    } else if (b.sealed) {
      wire = await this.c.sealer.openBlockOrUnreadable(p.documentId, { ...shell, sealed: b.sealed });
    } else {
      wire = { ...shell, type: b.type, schemaVersion: b.schemaVersion, text: b.text as WireBlock["text"], props: b.props };
    }
    const now = Date.now();
    // The server's row times don't travel; the order blocks were first seen stands in for creation order.
    const createdAt = prev?.createdAt ?? now * 1000 + (this.blockClock++ % 1000);
    return {
      ...this.toLocalBlock(p.documentId, wire, prev, now, { revision, seq, createdAt, updatedAt: now }),
      deletedAt: p.deleted ? (prev?.deletedAt ?? now) : null,
    };
  }

  private async folder(tx: Staged, f: PulledFolder): Promise<LocalFolder | null> {
    const prev = await tx.get("folders", f.id);
    let name = f.name ?? "";
    if (f.sealedName) {
      try {
        name = await this.c.sealer.openFolderName(this.c.scope, this.c.scopeId, f.id, f.sealedName.c);
      } catch {
        console.warn(`[e2ee] A folder name couldn't be decrypted (${f.id}).`);
      }
    }
    return { id: f.id, name, color: f.color, parentFolderId: f.parentFolderId, rank: f.rank, createdAt: f.createdAt, ordinal: prev?.ordinal ?? (await this.nextOrdinal(tx, "folderOrdinal")), updatedAt: f.updatedAt, deletedAt: f.deletedAt, locked: f.locked === true };
  }

  private async tag(t: PulledTag, tx: Staged): Promise<LocalTag | null> {
    const prev = await tx.get("tags", t.id);
    let name = t.name ?? "";
    if (t.sealedName) {
      try {
        name = await this.c.sealer.openTagName(this.c.scope, this.c.scopeId, t.id, t.sealedName.c);
      } catch {
        console.warn(`[e2ee] A tag name couldn't be decrypted (${t.id}).`);
      }
    }
    return { id: t.id, name, normalizedName: normalizeForSearch(name), color: t.color, createdAt: t.createdAt, ordinal: prev?.ordinal ?? (await this.nextOrdinal(tx, "tagOrdinal")) };
  }

  private async file(f: PulledFile, documentId: string): Promise<LocalFile | null> {
    let name = f.plain?.filename ?? "file";
    let mimeType = f.plain?.mimeType ?? "application/octet-stream";
    let width = f.plain?.width ?? null;
    let height = f.plain?.height ?? null;
    let palette = (f.plain?.palette as Doc<"files">["palette"] | undefined) ?? null;
    let sha256 = "";
    let size = f.size;
    if (f.sealed) {
      let raw: Uint8Array | null = null;
      try {
        raw = await this.c.sealer.openFileKey(documentId, f.id, f.sealed.key);
        const meta = (await Sealer.openFileMeta(raw, documentId, f.id, f.sealed.meta)) as { name?: string; mime?: string; width?: number; height?: number; palette?: Doc<"files">["palette"]; sha256?: string };
        name = meta.name ?? name;
        mimeType = meta.mime ?? mimeType;
        width = meta.width ?? null;
        height = meta.height ?? null;
        palette = meta.palette ?? null;
        sha256 = meta.sha256 ?? "";
        size = f.sealed.plainSize;
      } catch {
        console.warn(`[e2ee] A file's details couldn't be decrypted (${f.id}).`);
      } finally {
        raw?.fill(0);
      }
    }
    // The bytes stay on the server until something needs them (files.ts FileCache); an export fetches them first.
    return { id: f.id, documentId, name, mimeType, size, sha256, kind: f.kind, blob: new Blob([]), createdAt: f.createdAt, width, height, palette };
  }

  private async record(tx: Staged, r: PulledRecord): Promise<{ id: string; documentId: string } | null> {
    const target = r.documentId ? { documentId: r.documentId } : { scope: this.c.scope };
    let value: unknown = null;
    if (!r.deletedAt) {
      try {
        value = await this.c.sealer.openRecordValue(target, this.c.scopeId, r.kind, r.recordId, r.sealed);
      } catch {
        console.warn(`[e2ee] A ${r.kind} record couldn't be decrypted (${r.recordId}).`);
        return null;
      }
    }
    const meta = { rev: r.rev, seq: r.seq };
    tx.put("meta", `record:${r.kind}:${r.recordId}`, meta);
    switch (r.kind) {
      case "collection": {
        if (!value) {
          tx.remove("collections", r.recordId);
          return null;
        }
        const c = value as LocalCollection;
        tx.put("collections", r.recordId, { ...c, id: r.recordId, documentId: r.documentId ?? c.documentId, seq: r.seq });
        return { id: r.recordId, documentId: r.documentId ?? c.documentId };
      }
      case "fileText": {
        if (!r.documentId) return null;
        if (!value) tx.remove("fileTexts", r.recordId, r.documentId);
        else tx.put("fileTexts", r.recordId, { ...(value as LocalFileText), id: r.recordId, documentId: r.documentId }, r.documentId);
        return null;
      }
      case "studyReview": {
        if (!r.documentId) return null;
        if (r.profileId && r.profileId !== this.c.profile.id) return null;
        const v = value as LocalStudyReview | null;
        const id = v?.blockId ?? r.recordId;
        if (!v) tx.remove("studyReviews", id, r.documentId);
        else tx.put("studyReviews", id, { ...v, documentId: r.documentId }, r.documentId);
        return null;
      }
      default:
        // aiChat, aiMemory, prefs: kept for their features (WP8), as opened values in meta.
        if (value) tx.put("meta", `record-value:${r.kind}:${r.recordId}`, value);
        else tx.remove("meta", `record-value:${r.kind}:${r.recordId}`);
        return null;
    }
  }

  private async removeDocument(tx: Staged, id: string): Promise<void> {
    tx.remove("documents", id);
    for (const b of await tx.list("blocks", id)) tx.remove("blocks", b.id, id);
    for (const f of await tx.list("fileTexts", id)) tx.remove("fileTexts", f.id, id);
    for (const s of await tx.list("studyReviews", id)) tx.remove("studyReviews", s.blockId, id);
    for (const c of await tx.list("collections")) if (c.documentId === id) tx.remove("collections", c.id);
    for (const f of await tx.list("files")) {
      if (f.documentId !== id) continue;
      tx.remove("files", f.id);
      tx.remove("meta", `fileKey:${f.id}`);
    }
    tx.remove("recents", id);
  }

  // ---- derived ----------------------------------------------------------------------------------------

  /** Search text, counts, excerpt, preview and links of the notes whose rows changed. */
  private async derive(tx: Staged, touched: Set<string>): Promise<void> {
    let linkOrdinal: number | null = null;
    // A note showing synced content reads with it (its search text, its preview): when the content changes,
    // so do the notes that show it.
    const synced = new Set<string>();
    for (const id of touched) if ((await tx.get("documents", id))?.kind === "synced") synced.add(id);
    if (synced.size) for (const d of await tx.list("documents")) if (!touched.has(d.id) && (d.links ?? []).some((l) => synced.has(l.target))) touched.add(d.id);
    for (const id of touched) {
      const doc = await tx.get("documents", id);
      if (!doc) continue;
      const blocks = (await tx.list("blocks", id)).filter((b) => b.deletedAt === null).sort((a, b) => a.createdAt - b.createdAt);
      // Links: one per block and target, ordered as they were first seen (backlinks list in that order).
      const had = new Map((doc.links ?? []).map((l) => [`${l.blockId}\u0000${l.target}`, l]));
      const links: LocalLink[] = [];
      for (const b of blocks) {
        const targets = blockLinkTargets(b);
        targets.delete(id);
        for (const target of targets) {
          const same = had.get(`${b.id}\u0000${target}`);
          if (same) {
            links.push(same);
            continue;
          }
          linkOrdinal ??= ((await tx.get("meta", LINK_ORDINAL_KEY)) as number | undefined) ?? 0;
          linkOrdinal++;
          links.push({ target, blockId: b.id, ordinal: linkOrdinal });
        }
      }
      links.sort((a, b) => a.ordinal - b.ordinal);
      const derived = await refreshDerived(tx, { ...doc, links });
      tx.put("documents", id, derived);
    }
    if (linkOrdinal !== null) tx.put("meta", LINK_ORDINAL_KEY, linkOrdinal);
  }
}
