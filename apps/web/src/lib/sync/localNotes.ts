// Notes as this device knows them before the server does: a note made here (offline, or in the moment before
// its create is answered) and the title, icon, look or folder changed on one. Lists read from the server (Home's
// recent notes, All notes, Drafts, a folder, search, the tab strip) lay these over the server's answer, so a
// note written on the train shows everywhere at once, marked as waiting, and becomes the server's own row the
// moment its create lands (matched by id). Pure functions of the sync engine's durable state (IndexedDB), so
// the same notes show after a reload or a relaunch with no connection.
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, plainText, scopeIdKey, type DocumentCover, type DocumentStyle, type SyncOp, type SyncState, type WireScope } from "@folevi/editor-schema";

/** What lists need to know about a note that has changes on this device only. */
export interface LocalNote {
  id: string;
  /** The note was made on this device and the server doesn't have it yet. */
  isNew: boolean;
  /** Where a new top-level note goes (`scopeIdKey`); null for a nested page or one with no stamp. */
  scopeKey: string | null;
  parentDocumentId: string | null;
  kind: string;
  /** The latest values queued for it; undefined where nothing queued changes them. */
  title?: string;
  icon?: string | null;
  cover?: DocumentCover;
  style?: DocumentStyle;
  /** The folder it's in once its changes land (undefined: unchanged). */
  folderId?: string | null;
  /** First words of what's written in it (new notes only; others keep the server's excerpt). */
  excerpt: string;
  createdAt: number;
  /** When its latest change was made on this device. */
  updatedAt: number;
  /** Its changes wait to be sent ("queued") or one was refused ("failed"). */
  waiting: "queued" | "failed";
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The time in a ULID (op ids are ULIDs made when the change was made); 0 when it isn't one. */
export function ulidTime(id: string): number {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return 0;
  let t = 0;
  for (let i = 0; i < 10; i++) t = t * 32 + ALPHABET.indexOf(id[i]!);
  return t;
}

const EXCERPT_LENGTH = 200;

/** The first words of each document's top-level text, as this device holds it (one pass over the blocks). */
function excerptsOf(state: Pick<SyncState, "blocks">, ids: Set<string>): Map<string, string> {
  const lines = new Map<string, { rank: string; text: string }[]>();
  if (!ids.size) return new Map();
  for (const id in state.blocks) {
    const e = state.blocks[id]!;
    if (!ids.has(e.documentId) || e.deleted || e.block.parentId !== null) continue;
    const text = Array.isArray(e.block.text) ? plainText(e.block.text).trim() : "";
    if (!text) continue;
    const list = lines.get(e.documentId);
    if (list) list.push({ rank: e.block.rank, text });
    else lines.set(e.documentId, [{ rank: e.block.rank, text }]);
  }
  const out = new Map<string, string>();
  for (const [doc, list] of lines) {
    list.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    out.set(
      doc,
      list
        .map((l) => l.text)
        .join(" ")
        .slice(0, EXCERPT_LENGTH),
    );
  }
  return out;
}

const opDocument = (op: SyncOp): string => (op.kind === "document.create" ? op.document.id : op.documentId);

/**
 * Every note with changes still on this device (queued or in flight), by id. Notes whose only changes are
 * block edits are included too (they're moved to the top of "recent" lists), without new values.
 */
export function localNotes(state: Pick<SyncState, "pending" | "inflight" | "blocks" | "errors">): Map<string, LocalNote> {
  const out = new Map<string, LocalNote>();
  const failed = new Set(state.errors.map((e) => e.opId));
  for (const op of [...state.inflight, ...state.pending]) {
    const id = opDocument(op);
    const at = ulidTime(op.opId) || Date.now();
    let note = out.get(id);
    if (op.kind === "document.create") {
      const d = op.document;
      const scope = d.parentDocumentId ? null : d.scope ? scopeIdKey(d.scope as WireScope) : null;
      note = {
        id,
        isNew: true,
        scopeKey: scope,
        parentDocumentId: d.parentDocumentId ?? null,
        kind: d.kind,
        title: d.title,
        icon: d.icon,
        cover: d.cover ?? DEFAULT_COVER,
        style: d.style ?? DEFAULT_DOCUMENT_STYLE,
        folderId: d.folderId ?? null,
        excerpt: "",
        createdAt: at,
        updatedAt: at,
        waiting: "queued",
      };
      out.set(id, note);
    } else if (!note) {
      note = { id, isNew: false, scopeKey: null, parentDocumentId: null, kind: "document", excerpt: "", createdAt: at, updatedAt: at, waiting: "queued" };
      out.set(id, note);
    }
    note.updatedAt = Math.max(note.updatedAt, at);
    if (failed.has(op.opId)) note.waiting = "failed";
    if (op.kind === "document.update") {
      const p = op.patch;
      if (p.title !== undefined) note.title = p.title;
      if (p.icon !== undefined) note.icon = p.icon;
      if (p.cover !== undefined) note.cover = p.cover;
      if (p.style !== undefined) note.style = p.style;
      if (p.folderId !== undefined) note.folderId = p.folderId;
      if (p.parentDocumentId !== undefined) note.parentDocumentId = p.parentDocumentId;
    }
  }
  const excerpts = excerptsOf(state, new Set([...out.values()].filter((n) => n.isNew).map((n) => n.id)));
  for (const note of out.values()) if (note.isNew) note.excerpt = excerpts.get(note.id) ?? "";
  return out;
}

/** Whether two `localNotes` answers show the same (so a list doesn't re-render on every keystroke elsewhere). */
export function sameLocalNotes(a: Map<string, LocalNote>, b: Map<string, LocalNote>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y) return false;
    for (const k of Object.keys(x) as (keyof LocalNote)[]) {
      const u = x[k];
      const v = y[k];
      if (u === v) continue;
      if (typeof u === "object" && typeof v === "object" && JSON.stringify(u) === JSON.stringify(v)) continue;
      return false;
    }
  }
  return true;
}

/** The fields of a server note summary that a local note fills in (any list row with at least these). */
export interface NoteRow {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: number;
  folderId?: string | null;
  parentDocumentId?: string | null;
  kind?: string;
}

/** A server-shaped summary for a note that so far exists only on this device. */
export function localSummary(note: LocalNote, scope: WireScope): Record<string, unknown> {
  return {
    id: note.id,
    workspaceId: scope.kind === "workspace" ? scope.workspaceId : null,
    ownerProfileId: null,
    parentDocumentId: note.parentDocumentId,
    folderId: note.folderId ?? null,
    kind: note.kind,
    title: note.title ?? "",
    icon: note.icon ?? null,
    cover: note.cover ?? DEFAULT_COVER,
    style: note.style ?? DEFAULT_DOCUMENT_STYLE,
    dailyDate: null,
    accessMode: "inherit",
    rank: `~${note.id}`,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    createdBy: "",
    archivedAt: null,
    deletedAt: null,
    revision: 0,
    titleRev: 0,
    seq: 0,
    excerpt: note.excerpt,
    preview: null,
    wordCount: note.excerpt ? note.excerpt.split(/\s+/).filter(Boolean).length : 0,
    charCount: note.excerpt.length,
    blockCount: 0,
    starred: false,
    tags: [],
    homeFolder: null,
    waiting: note.waiting,
  };
}

export interface OverlayOptions {
  /** The place the list is for: new notes made for another place don't show in it. */
  scope: WireScope;
  /**
   * Which notes the list holds, for the new ones: "recent"/"all" every top-level note, "drafts" those in no
   * folder, "folder" those in `folderId`, "none" no new ones (Starred, Archive, Trash, Templates).
   */
  include: "recent" | "all" | "drafts" | "folder" | "none";
  folderId?: string;
  /** Order by latest change, newest first (recent notes, or a list sorted by "updated"). */
  byUpdated?: boolean;
  /** At most this many (recent notes on Home). */
  limit?: number;
}

/**
 * A list of note rows with this device's notes laid over it: changed titles, icons and looks; notes moved out
 * of the folder shown leave it; and notes made here (not on the server yet) added at the top. Rows that
 * aren't changed are returned as they were (the same objects); with nothing to lay over, the same list.
 */
export function overlayNotes<T extends NoteRow>(list: readonly T[], locals: Map<string, LocalNote>, opts: OverlayOptions): T[] {
  if (!locals.size) return list as T[];
  const key = scopeIdKey(opts.scope);
  let changed = false;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of list) {
    seen.add(row.id);
    const note = locals.get(row.id);
    if (!note) {
      out.push(row);
      continue;
    }
    if (opts.include === "folder" && note.folderId !== undefined && note.folderId !== opts.folderId) {
      changed = true;
      continue;
    }
    if (opts.include === "drafts" && note.folderId !== undefined && note.folderId !== null) {
      changed = true;
      continue;
    }
    const next = {
      ...row,
      ...(note.title !== undefined ? { title: note.title } : {}),
      ...(note.icon !== undefined ? { icon: note.icon } : {}),
      ...(note.cover !== undefined ? { cover: note.cover } : {}),
      ...(note.style !== undefined ? { style: note.style } : {}),
      ...(note.folderId !== undefined ? { folderId: note.folderId } : {}),
      updatedAt: Math.max(row.updatedAt, note.updatedAt),
      waiting: note.waiting,
    } as T;
    changed = true;
    out.push(next);
  }
  if (opts.include !== "none") {
    for (const note of locals.values()) {
      if (!note.isNew || seen.has(note.id) || note.parentDocumentId || note.kind !== "document") continue;
      if (note.scopeKey !== null && note.scopeKey !== key) continue;
      if (opts.include === "folder" && (note.folderId ?? null) !== (opts.folderId ?? null)) continue;
      if (opts.include === "drafts" && (note.folderId ?? null) !== null) continue;
      out.unshift(localSummary(note, opts.scope) as unknown as T);
      changed = true;
    }
  }
  if (!changed) return list as T[];
  if (opts.byUpdated) out.sort((a, b) => b.updatedAt - a.updatedAt);
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/** The latest title this device gave a note (its create's, or a queued rename's); undefined when none is queued. */
export function localTitle(state: Pick<SyncState, "pending" | "inflight">, documentId: string): string | undefined {
  let title: string | undefined;
  for (const op of [...state.inflight, ...state.pending]) {
    if (op.kind === "document.create" && op.document.id === documentId) title = op.document.title;
    else if (op.kind === "document.update" && op.documentId === documentId && op.patch.title !== undefined) title = op.patch.title;
  }
  return title;
}

/** This device's new notes (and renamed ones) whose title or first words match `query` (case-insensitive). */
export function searchLocalNotes(locals: Map<string, LocalNote>, query: string, scope: WireScope): LocalNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const key = scopeIdKey(scope);
  return [...locals.values()].filter((n) => (n.isNew ? n.scopeKey === null || n.scopeKey === key : n.title !== undefined) && `${n.title ?? ""} ${n.excerpt}`.toLowerCase().includes(q));
}
