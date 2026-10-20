// Helpers the local handlers share: the profile, the one scope (Personal), page summaries as the server
// shapes them (convex/lib/documents.ts toSummary and documents.ts withExtras), live blocks, derived text.
import {
  blockLinkTargets,
  DEFAULT_COVER,
  DEFAULT_DOCUMENT_STYLE,
  deriveDocumentText,
  newDocumentRank,
  randomNoteEmoji,
  sanitizeTitle,
  ulid,
  validateWireBlock,
  type WireBlock,
  type WireScope,
} from "@folevi/editor-schema";
import type { FunctionReturnType } from "convex/server";
import type { DocumentSummary } from "@convex/lib/documents";
import type { api } from "@/lib/convex/api";
import { fail } from "../errors";
import type { LocalMutationCtx, LocalQueryCtx, LocalReader, LocalWriter } from "../registry";
import type { LocalBlock, LocalDocument, LocalFolder, LocalLink } from "../store";

/** The library's profile, in exactly the shape users.me returns it. */
export type LocalProfile = Extract<FunctionReturnType<typeof api.users.me>, { state: "ready" }>["profile"];

export const PROFILE_KEY = "profile";

export async function getProfile(db: LocalReader): Promise<LocalProfile | null> {
  return ((await db.get("meta", PROFILE_KEY)) as LocalProfile | undefined) ?? null;
}

/** The profile, or the error the server gives a caller without one. */
export async function requireProfile(ctx: LocalQueryCtx | LocalMutationCtx): Promise<LocalProfile> {
  const p = await getProfile(ctx.db);
  if (!p) fail("profile_missing", "Set up this library first.");
  return p;
}

/** A local library has one place, Personal. A workspace scope names nothing here. */
export function checkScope(scope: WireScope | null | undefined): void {
  if (scope && scope.kind !== "personal") fail("not_found", "Workspace not found.");
}

export function toWireBlock(row: LocalBlock): WireBlock {
  return { id: row.id, type: row.type, parentId: row.parentId, rank: row.rank, schemaVersion: row.schemaVersion, text: row.text, props: row.props, revision: row.revision };
}

/** A note's blocks that aren't deleted. */
export async function liveBlocks(db: LocalReader, documentId: string): Promise<LocalBlock[]> {
  return (await db.list("blocks", documentId)).filter((b) => b.deletedAt === null);
}

export function toSummary(doc: LocalDocument, profileId: string): DocumentSummary {
  return {
    id: doc.id,
    workspaceId: null,
    ownerProfileId: profileId,
    parentDocumentId: doc.parentDocumentId,
    folderId: doc.folderId,
    kind: doc.kind,
    title: doc.title,
    icon: doc.icon,
    cover: doc.cover,
    style: doc.style,
    dailyDate: doc.dailyDate,
    accessMode: "workspace",
    rank: doc.rank,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: profileId,
    archivedAt: doc.archivedAt,
    deletedAt: doc.deletedAt,
    revision: doc.revision,
    titleRev: doc.titleRev,
    seq: doc.seq,
    excerpt: doc.excerpt,
    preview: doc.preview,
    wordCount: doc.wordCount,
    charCount: doc.charCount,
    blockCount: doc.blockCount,
  };
}

export interface HomeFolder {
  id: string;
  name: string;
  color: string | null;
}

/** Each note's home folder: its own, or its nearest ancestor note's (convex/lib/documents.ts HomeFolders). */
export class HomeFolders {
  private folders: Map<string, LocalFolder> | null = null;
  private byDoc = new Map<string, HomeFolder | null>();
  constructor(private db: LocalReader) {}

  private async folder(id: string): Promise<HomeFolder | null> {
    this.folders ??= new Map((await this.db.list("folders")).map((f) => [f.id, f]));
    const f = this.folders.get(id);
    return f && f.deletedAt === null ? { id: f.id, name: f.name, color: f.color } : null;
  }

  async of(doc: LocalDocument): Promise<HomeFolder | null> {
    const chain: string[] = [];
    let cur: LocalDocument | undefined = doc;
    let found: HomeFolder | null = null;
    for (let depth = 0; cur && depth < 12; depth++) {
      if (this.byDoc.has(cur.id)) {
        found = this.byDoc.get(cur.id) ?? null;
        break;
      }
      chain.push(cur.id);
      if (cur.folderId) {
        found = await this.folder(cur.folderId);
        break;
      }
      cur = cur.parentDocumentId ? await this.db.get("documents", cur.parentDocumentId) : undefined;
    }
    for (const id of chain) this.byDoc.set(id, found);
    return found;
  }
}

export type DocumentWithExtras = DocumentSummary & { starred: boolean; tags: { id: string; name: string; color: string }[]; homeFolder: HomeFolder | null };

/** The summary with the note's star, tags and home folder (documents.ts withExtras). */
export async function withExtras(db: LocalReader, profileId: string, docs: LocalDocument[]): Promise<DocumentWithExtras[]> {
  const homes = new HomeFolders(db);
  const tags = docs.some((d) => d.tagIds.length) ? new Map((await db.list("tags")).map((t) => [t.id, t])) : new Map();
  const out: DocumentWithExtras[] = [];
  for (const d of docs) {
    const docTags = d.tagIds.flatMap((id) => {
      const t = tags.get(id);
      return t ? [{ id: t.id, name: t.name, color: t.color }] : [];
    });
    out.push({ ...toSummary(d, profileId), starred: d.starred, tags: docTags, homeFolder: await homes.of(d) });
  }
  return out;
}

/** Recomputes a note's search text, counts, excerpt and preview from its live blocks (lib/documents.ts refreshDerived). */
export async function refreshDerived(db: LocalWriter, doc: LocalDocument): Promise<LocalDocument> {
  const own = (await liveBlocks(db, doc.id)).map(toWireBlock);
  // Everyone reading the note sees these, so links in them carry the linked notes' current titles (sharedLabels).
  const derived = deriveDocumentText(doc.title, await new ReaderLabels(db).blocks(own), { synced: doc.kind === "synced" });
  return {
    ...doc,
    searchText: derived.searchText,
    wordCount: derived.wordCount,
    charCount: derived.charCount,
    blockCount: own.length,
    excerpt: derived.excerpt,
    preview: derived.preview,
  };
}

const LAST_RANK_KEY = "lastDocumentRank";
const ORDINAL_KEY = "documentOrdinal";

/** The rank of the note made last (lib/documents.ts lastRootRank): a new note goes after it. */
export async function lastRootRank(db: LocalReader): Promise<string | null> {
  const kept = (await db.get("meta", LAST_RANK_KEY)) as string | undefined;
  if (kept !== undefined) return kept;
  let latest: LocalDocument | null = null;
  for (const d of await db.list("documents")) if (!latest || d.createdAt > latest.createdAt || (d.createdAt === latest.createdAt && d.ordinal > latest.ordinal)) latest = d;
  return latest?.rank ?? null;
}

export interface NewDocument {
  id?: string;
  title: string;
  icon?: string | null;
  kind?: LocalDocument["kind"];
  parentDocumentId?: string | null;
  folderId?: string | null;
  style?: LocalDocument["style"];
  cover?: LocalDocument["cover"];
  dailyDate?: string | null;
  templateKey?: string | null;
  collectionId?: string | null;
  tagIds?: string[];
  blocks?: WireBlock[];
}

/**
 * Makes a note and its blocks (convex/lib/create.ts createDocument): validated blocks, the next rank, an
 * icon for a plain note, derived text from the start. `seq` is the mutation's change counter.
 */
export async function insertDocument(ctx: LocalMutationCtx, input: NewDocument): Promise<LocalDocument> {
  const now = ctx.now();
  const seq = await ctx.nextSeq();
  const id = input.id ?? ulid();
  if (await ctx.db.get("documents", id)) fail("conflict", "Document already exists.");
  const blocks = input.blocks ?? [];
  for (const b of blocks) {
    const issues = validateWireBlock(b);
    if (issues.length) fail("invalid_block", `${issues[0]!.path}: ${issues[0]!.message}`);
  }
  const kind = input.kind ?? "document";
  const title = sanitizeTitle(input.title);
  const rank = newDocumentRank(await lastRootRank(ctx.db));
  ctx.db.put("meta", LAST_RANK_KEY, rank);
  const ordinal = (((await ctx.db.get("meta", ORDINAL_KEY)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", ORDINAL_KEY, ordinal);
  const doc: LocalDocument = {
    id,
    parentDocumentId: input.parentDocumentId ?? null,
    folderId: input.folderId ?? null,
    kind,
    title,
    // Every note has an icon (templates and collection rows keep whatever they were given).
    icon: input.icon ?? (kind === "document" ? randomNoteEmoji() : null),
    cover: input.cover ?? DEFAULT_COVER,
    style: input.style ?? DEFAULT_DOCUMENT_STYLE,
    dailyDate: input.dailyDate ?? null,
    templateKey: input.templateKey ?? null,
    collectionId: input.collectionId ?? null,
    rank,
    createdAt: now,
    ordinal,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    inTrash: false,
    revision: 1,
    titleRev: 1,
    seq,
    contentSeq: blocks.length ? 1 : 0,
    searchText: title,
    wordCount: 0,
    charCount: 0,
    blockCount: 0,
    excerpt: "",
    preview: null,
    starred: false,
    tagIds: input.tagIds ?? [],
    editedByDevice: ctx.deviceId,
  };
  for (const b of blocks) {
    const { revision: _revision, ...rest } = b;
    void _revision;
    ctx.db.put("blocks", b.id, { ...rest, documentId: id, revision: 1, contentRev: 1, positionRev: 1, seq, deletedAt: null, createdAt: now, updatedAt: now, updatedByDevice: ctx.deviceId }, id);
  }
  // Synced blocks it starts with are recorded as showing their content (lib/create.ts indexSyncedBlocks); the
  // server records a new note's other links only when their blocks are next written, and so does this.
  const synced = blocks.filter((b) => b.type === "synced");
  if (synced.length) doc.links = await linksAfter(ctx, doc, synced.map((b) => ({ id: b.id, type: b.type, text: b.text, props: b.props, deletedAt: null })));
  const derived = await refreshDerived(ctx.db, doc);
  ctx.db.put("documents", id, derived);
  return derived;
}

// ---- links between notes (the server's documentLinks, lib/syncEngine.ts syncLinks) ------------------------

const LINK_ORDINAL_KEY = "linkOrdinal";

/** A block as far as its links go. */
export interface LinkedBlock {
  id: string;
  type: string;
  text?: unknown;
  props?: unknown;
  deletedAt: number | null;
}

/**
 * The note's links once `changed` blocks are as given: each changed block's links are replaced by what it
 * links to now (none once it's deleted), the rest kept. A link that stays keeps its place in the order.
 */
export async function linksAfter(ctx: LocalMutationCtx, doc: LocalDocument, changed: LinkedBlock[]): Promise<LocalLink[]> {
  const ids = new Set(changed.map((b) => b.id));
  const kept = (doc.links ?? []).filter((l) => !ids.has(l.blockId));
  const had = new Map((doc.links ?? []).filter((l) => ids.has(l.blockId)).map((l) => [`${l.blockId}\u0000${l.target}`, l]));
  let ordinal: number | null = null;
  for (const b of changed) {
    if (b.deletedAt !== null) continue;
    const targets = blockLinkTargets(b);
    targets.delete(doc.id);
    for (const target of targets) {
      const same = had.get(`${b.id}\u0000${target}`);
      if (same) {
        kept.push(same);
        continue;
      }
      ordinal ??= ((await ctx.db.get("meta", LINK_ORDINAL_KEY)) as number | undefined) ?? 0;
      ordinal++;
      kept.push({ target, blockId: b.id, ordinal });
    }
  }
  if (ordinal !== null) ctx.db.put("meta", LINK_ORDINAL_KEY, ordinal);
  return kept.sort((a, b) => a.ordinal - b.ordinal);
}

// ---- labels of links (the server's lib/linkLabels.ts ReaderLabels) ---------------------------------------

/** What a link to a page that isn't there says (the server's HIDDEN_PAGE_LABEL). */
export const HIDDEN_PAGE_LABEL = "Page you can't open";

type Label = { title: string; icon: string | null } | null;

const isPageLinkNode = (n: unknown): n is { type: "pageLink"; documentId: string; label?: string } =>
  Boolean(n && typeof n === "object" && (n as { type?: unknown }).type === "pageLink" && typeof (n as { documentId?: unknown }).documentId === "string");

/**
 * Links as the reader sees them: a page card's cached title and icon and every page link's label show the
 * linked note's current title ("Untitled" for none) and icon; a note that isn't in the library reads as
 * HIDDEN_PAGE_LABEL. Labels are resolved when read, never written back into other notes (plan §5.1).
 */
export class ReaderLabels {
  private labels = new Map<string, Label>();
  constructor(private db: LocalReader) {}

  async blocks<B extends WireBlock>(blocks: B[]): Promise<B[]> {
    const targets = new Set<string>();
    for (const b of blocks) for (const t of blockLinkTargets(b)) if (b.type !== "synced" || (b.props as { sourceId?: unknown }).sourceId !== t) targets.add(t);
    if (!targets.size) return blocks;
    for (const id of targets) {
      if (this.labels.has(id)) continue;
      if (this.labels.size >= 200) {
        this.labels.set(id, null);
        continue;
      }
      const doc = await this.db.get("documents", id);
      this.labels.set(id, doc ? { title: doc.title || "Untitled", icon: doc.icon } : null);
    }
    const title = (id: string) => this.labels.get(id)?.title ?? HIDDEN_PAGE_LABEL;
    const nodes = (list: unknown): unknown => (Array.isArray(list) && list.some(isPageLinkNode) ? list.map((n) => (isPageLinkNode(n) ? { ...n, label: title(n.documentId) } : n)) : list);
    return blocks.map((b) => {
      let next = b;
      const props = b.props as Record<string, unknown>;
      if (b.type === "page" && typeof props.documentId === "string") {
        const label = this.labels.get(props.documentId) ?? null;
        const p: Record<string, unknown> = { ...props, titleCache: label?.title ?? HIDDEN_PAGE_LABEL };
        if (label?.icon) p.iconCache = label.icon;
        else delete p.iconCache;
        next = { ...next, props: p };
      }
      if (Array.isArray(b.text) && b.text.some(isPageLinkNode)) next = { ...next, text: nodes(b.text) as WireBlock["text"] };
      const rows = b.type === "table" && Array.isArray(props.rows) ? (props.rows as unknown[][]) : null;
      if (rows && rows.some((r) => Array.isArray(r) && r.some((c) => Array.isArray(c) && c.some(isPageLinkNode)))) {
        next = { ...next, props: { ...(next.props as Record<string, unknown>), rows: rows.map((r) => (Array.isArray(r) ? r.map(nodes) : r)) } };
      }
      return next;
    });
  }
}

// ---- devices, where the server names people (version history's "who edited") --------------------------

const DEVICE_COLORS = ["accent", "moss", "marigold", "plum", "coral", "ember"] as const;

/** A device as version history shows it, in the shape of the server's PersonView. */
export interface DeviceView {
  key: string;
  name: string;
  color: (typeof DEVICE_COLORS)[number];
  avatarUrl: string | null;
}

/**
 * Looks devices up once each: in local mode "who edited" is which device did (one person owns the library).
 * A device's name is the one its record gives (`meta` "device:<id>", Phase 2: devices/<id>.json), else
 * "This device" or "Another device".
 */
export class Devices {
  private cache = new Map<string, Promise<DeviceView>>();
  constructor(
    private db: LocalReader,
    private here: string,
  ) {}

  get(deviceId: string | undefined): Promise<DeviceView> {
    const id = deviceId || this.here;
    let hit = this.cache.get(id);
    if (!hit) {
      hit = (async () => {
        const record = (await this.db.get("meta", `device:${id}`)) as { name?: unknown } | undefined;
        const named = typeof record?.name === "string" && record.name.trim() ? record.name.trim() : null;
        let h = 0;
        for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return { key: id, name: named ?? (id === this.here ? "This device" : "Another device"), color: DEVICE_COLORS[h % DEVICE_COLORS.length]!, avatarUrl: null };
      })();
      this.cache.set(id, hit);
    }
    return hit;
  }

  async all(): Promise<Record<string, DeviceView>> {
    const out: Record<string, DeviceView> = {};
    for (const d of await Promise.all(this.cache.values())) out[d.key] = d;
    return out;
  }
}

// ---- synced content in Trash (the server's lib/synced.ts refreshSyncedSource) ------------------------------

/** Whether a note that isn't in Trash shows the synced content `source` (lib/syncedRefs.ts syncedReferences). */
async function shownByLiveNote(db: LocalReader, source: LocalDocument): Promise<boolean> {
  for (const note of await db.list("documents")) {
    if (note.kind === "synced" || note.inTrash) continue;
    for (const link of note.links ?? []) {
      if (link.target !== source.id) continue;
      const row = await db.get("blocks", link.blockId, note.id);
      if (row && row.deletedAt === null && row.type === "synced" && (row.props as { sourceId?: unknown }).sourceId === source.id) return true;
    }
  }
  return false;
}

/**
 * After the notes showing synced content may have changed (a synced block written or deleted, a note moved to
 * or out of Trash): content no live note shows goes to Trash with nothing removed, and comes back once shown again.
 */
export async function refreshSyncedSource(ctx: LocalMutationCtx, sourceId: string): Promise<void> {
  const source = await ctx.db.get("documents", sourceId);
  if (!source || source.kind !== "synced") return;
  const live = await shownByLiveNote(ctx.db, source);
  if (live === !source.inTrash) return;
  const now = ctx.now();
  ctx.db.put("documents", source.id, { ...source, inTrash: !live, deletedAt: live ? null : now, seq: await ctx.nextSeq(), revision: source.revision + 1, updatedAt: now });
}

/** refreshSyncedSource for every note the given notes link to (they just went to Trash or came back). */
export async function refreshSourcesShownBy(ctx: LocalMutationCtx, noteIds: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const id of noteIds) {
    const note = await ctx.db.get("documents", id);
    for (const link of note?.links ?? []) {
      if (seen.has(link.target)) continue;
      seen.add(link.target);
      await refreshSyncedSource(ctx, link.target);
    }
  }
}
