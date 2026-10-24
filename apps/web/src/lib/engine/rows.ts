// Pure mappings from the data layer's answers (Convex query results with the outbox and the sync engine laid over
// them) to the bridge's view models (protocol.ts). No React, no client: the views call these, and the tests seed
// them directly.
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, type SyncState as EngineSyncState } from "@folevi/editor-schema";
import type { OutboxEntry } from "@/lib/sync/outbox";
import { withHash } from "./diff";
import type { CardCover, CardStyle, FolderCard, FolderChip, FolderNode, NoteRow, PreviewLine, SyncMark, TagChip, TagRow } from "./protocol";

/** The fields of a documents.list / recentNotes summary the bridge reads (the E2EE router has opened them). */
export interface SummaryLike {
  id: string;
  title: string;
  icon: string | null;
  kind: string;
  excerpt: string;
  preview: PreviewLine[] | null;
  cover: CardCover;
  style: CardStyle;
  starred?: boolean;
  createdAt: number;
  updatedAt: number;
  folderId: string | null;
  parentDocumentId?: string | null;
  archivedAt?: number | null;
  deletedAt?: number | null;
  homeFolder?: { id: string; name: string; color: string | null } | null;
  tags?: { id: string; name: string; color: string }[];
  sealed?: unknown;
  locked?: true;
}

/** Which notes and folders have changes waiting, refused, or in conflict on this device. */
export interface SyncMarks {
  waiting: Set<string>;
  failed: Set<string>;
  conflict: Set<string>;
}

export const NO_MARKS: SyncMarks = { waiting: new Set(), failed: new Set(), conflict: new Set() };

/**
 * The marks from the sync engine's queue (page edits, creates, uploads) and the outbox (moves, folders): an
 * entry names what it touches in its keys (`note:<id>`, `folder:<id>`).
 */
export function syncMarksOf(state: Pick<EngineSyncState, "pending" | "inflight" | "uploads" | "conflicts"> | null, entries: readonly OutboxEntry[]): SyncMarks {
  const marks: SyncMarks = { waiting: new Set(), failed: new Set(), conflict: new Set() };
  if (state) {
    for (const op of [...state.inflight, ...state.pending]) marks.waiting.add(op.kind === "document.create" ? op.document.id : op.documentId);
    for (const u of state.uploads) if (u.state !== "done") marks.waiting.add(u.documentId);
    for (const c of state.conflicts) marks.conflict.add(c.documentId);
  }
  for (const e of entries) {
    for (const key of e.keys) {
      const m = /^(?:note|folder):(.+)$/.exec(key);
      if (!m) continue;
      (e.failed ? marks.failed : marks.waiting).add(m[1]!);
    }
    for (const a of e.after ?? []) if (a.blockId === null && e.name === "documents.bulkUpdate") (e.failed ? marks.failed : marks.waiting).add(a.documentId);
  }
  return marks;
}

export function markOf(id: string, marks: SyncMarks): SyncMark {
  if (marks.conflict.has(id)) return "conflict";
  if (marks.failed.has(id)) return "failed";
  if (marks.waiting.has(id)) return "waiting";
  return "saved";
}

function styleOf(style: Partial<CardStyle> | null | undefined): CardStyle {
  const s = { ...(DEFAULT_DOCUMENT_STYLE as unknown as CardStyle), ...(style ?? {}) };
  const out: CardStyle = { font: String(s.font), width: String(s.width), background: String(s.background), accent: String(s.accent), card: String(s.card) };
  if (s.backdrop !== undefined) out.backdrop = String(s.backdrop);
  if (s.sheet !== undefined) out.sheet = String(s.sheet);
  if (s.text !== undefined) out.text = String(s.text);
  if (s.separator !== undefined) out.separator = String(s.separator);
  if (s.blur !== undefined) out.blur = Boolean(s.blur);
  return out;
}

function coverOf(cover: Partial<CardCover> | null | undefined): CardCover {
  const c: CardCover = cover && typeof cover.kind === "string" ? (cover as CardCover) : (DEFAULT_COVER as unknown as CardCover);
  return c.value !== undefined ? { kind: c.kind, value: String(c.value) } : { kind: c.kind };
}

/** A summary as a card or row. `folders` names folders by id for a summary without its home folder. */
export function noteRowOf(d: SummaryLike, marks: SyncMarks = NO_MARKS, o: { folders?: ReadonlyMap<string, FolderChip>; inTrash?: boolean; starred?: boolean; folderId?: string | null } = {}): NoteRow {
  const folderId = o.folderId !== undefined ? o.folderId : d.folderId;
  const folder: FolderChip | null = d.homeFolder && o.folderId === undefined ? { id: d.homeFolder.id, name: d.homeFolder.name, color: d.homeFolder.color ?? null } : folderId ? (o.folders?.get(folderId) ?? null) : null;
  return withHash({
    id: d.id,
    title: d.title ?? "",
    icon: d.icon ?? null,
    kind: d.kind,
    excerpt: d.excerpt ?? "",
    preview: d.preview ?? null,
    cover: coverOf(d.cover),
    style: styleOf(d.style),
    starred: o.starred ?? Boolean(d.starred),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    folder,
    tags: (d.tags ?? []).map((t): TagChip => ({ id: t.id, name: t.name, color: t.color })),
    encrypted: Boolean(d.sealed || d.locked),
    archived: d.archivedAt !== null && d.archivedAt !== undefined,
    inTrash: o.inTrash ?? (d.deletedAt !== null && d.deletedAt !== undefined),
    deletedAt: d.deletedAt ?? null,
    sync: markOf(d.id, marks),
  });
}

/** Notes made on this device that the server doesn't have yet (the engine's queued creates), newest first. */
export function pendingCreates(state: Pick<EngineSyncState, "pending" | "inflight"> | null, o: { scopeKey: string; folderId?: string | null; topLevelOnly?: boolean } ): SummaryLike[] {
  if (!state) return [];
  const out: SummaryLike[] = [];
  for (const op of [...state.inflight, ...state.pending]) {
    if (op.kind !== "document.create") continue;
    const d = op.document;
    if ((d.kind ?? "document") === "template") continue;
    if (o.topLevelOnly !== false && d.parentDocumentId) continue;
    if (o.folderId !== undefined && (d.folderId ?? null) !== o.folderId) continue;
    const scope = d.scope;
    if (scope && (scope.kind === "personal" ? "personal" : scope.workspaceId) !== o.scopeKey) continue;
    // (The time in the note's ULID, so the row is the same on every pass: a row's hash must not drift.)
    const at = ulidTime(d.id) ?? ulidTime(op.opId) ?? 0;
    out.push({
      id: d.id,
      title: d.title ?? "",
      icon: d.icon ?? null,
      kind: d.kind ?? "document",
      excerpt: "",
      preview: null,
      cover: (d.cover ?? DEFAULT_COVER) as unknown as CardCover,
      style: (d.style ?? DEFAULT_DOCUMENT_STYLE) as unknown as CardStyle,
      createdAt: at,
      updatedAt: at,
      folderId: d.folderId ?? null,
      parentDocumentId: d.parentDocumentId ?? null,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The milliseconds in a ULID's first ten characters, or null when it isn't one. */
export function ulidTime(id: string): number | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) return null;
  let t = 0;
  for (const ch of id.slice(0, 10).toUpperCase()) t = t * 32 + CROCKFORD.indexOf(ch);
  return t;
}

/** organization.sidebar's folders (sorted by rank) and tags, as the protocol's folder tree: flat, depth first. */
export function folderTree(
  folders: readonly { id: string; name: string; color: string | null; parentFolderId: string | null; rank: string; sealedName?: unknown }[],
  counts: ReadonlyMap<string, number> | null,
  marks: SyncMarks = NO_MARKS,
): FolderNode[] {
  const children = new Map<string | null, typeof folders[number][]>();
  const known = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    // A folder whose parent isn't known (deleted, or not synced yet) shows at the top level rather than vanishing.
    const parent = f.parentFolderId && known.has(f.parentFolderId) ? f.parentFolderId : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const out: FolderNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({
        id: f.id,
        name: f.name,
        color: f.color ?? null,
        parentId: parent,
        depth,
        rank: f.rank,
        childCount: (children.get(f.id) ?? []).length,
        noteCount: counts ? (counts.get(f.id) ?? 0) : null,
        encrypted: Boolean(f.sealedName),
        sync: markOf(f.id, marks),
      });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function tagRows(tags: readonly { id: string; name: string; color: string }[]): TagRow[] {
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
}

/** A folder of organization.index as a folder card. */
export function folderCardOf(
  f: { id: string; name: string; color: string | null; parentFolderId: string | null; updatedAt: number; documentCount: number; previews?: { cover: CardCover; title: string; excerpt: string; sealed?: unknown }[]; sealedName?: unknown },
  childCount: number,
  marks: SyncMarks = NO_MARKS,
): FolderCard {
  return {
    id: f.id,
    name: f.name,
    color: f.color ?? null,
    parentId: f.parentFolderId ?? null,
    noteCount: f.documentCount,
    childCount,
    updatedAt: f.updatedAt,
    previews: (f.previews ?? []).slice(0, 3).map((p) => ({ title: p.title ?? "", excerpt: p.excerpt ?? "", cover: coverOf(p.cover) })),
    encrypted: Boolean(f.sealedName),
    sync: markOf(f.id, marks),
  };
}
