// The merge (LOCAL_MODE_PLAN.md §3.4): a state-based CRDT over note files.
//
// Every rule is commutative and idempotent, and associative for the note's content. What a merge *reports*
// (losses, and the notices it adds for them) depends on which states meet: three-way concurrent edits merged
// in different orders can report a superseded edit once more. Notices are a grow-only set with a
// deterministic join, so replicas still converge once they have exchanged files.
import { canonicalJson, compareSiblings, flattenTree, type WireBlock } from "@folevi/editor-schema";
import { blockToWire } from "./edits";
import { hlcDevice, hlcMs } from "./hlc";
import { conflictVersionName } from "./history";
import {
  DOC_REGISTER_FIELDS,
  NOTICED_DOC_FIELDS,
  NOTE_FORMAT,
  NOTE_VERSION,
  isStub,
  type BlockEntry,
  type CollectionDef,
  type DocRegisterField,
  type NoteDoc,
  type NoteFile,
  type NoteLike,
  type NoteStub,
  type Notice,
  type Register,
  type RowData,
  type TagEntry,
} from "./noteFile";
import { sha256Hex } from "./sha256";
import { compareVv, dominates, mergeVv, type VersionVector } from "./vv";

/** A concurrent change that lost. It goes to history as `version`, and a notice points at it. */
export type Loss =
  | {
      kind: "block";
      docId: string;
      blockId: string;
      /** The losing block, as its device had it. */
      state: BlockEntry;
      /** The device whose edit lost. */
      from: string;
      /** The losing content stamp. */
      c: string;
      winner: { c: string; from: string; deleted: boolean };
      version: string;
      noticeId: string;
    }
  | {
      kind: "field";
      docId: string;
      field: DocRegisterField;
      state: Register<unknown>;
      from: string;
      c: string;
      winner: { c: string; from: string };
      version: string;
      noticeId: string;
    };

export interface MergeResult<T extends NoteLike = NoteLike> {
  file: T;
  losses: Loss[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic pick between two values with equal stamps (should not happen; keeps merges total). */
function byCanonical<T>(a: T, b: T): T {
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

/** Last writer wins on `c`; equal stamps fall back to canonical order. */
export function lww<T extends { c: string }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  const order = cmp(a.c, b.c);
  return order > 0 ? a : order < 0 ? b : byCanonical(a, b);
}

/** Merges two maps of last-writer-wins entries key by key. */
export function lwwMap<T extends { c: string }>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of unionKeys(a, b)) out[key] = lww(a?.[key], b?.[key])!;
  return out;
}

export interface RegisterMerge<T> {
  value: Register<T> | undefined;
  /** The concurrent loser, when both sides changed the register without seeing each other. */
  loser?: Register<T>;
  winner?: Register<T>;
}

/**
 * Merges two registers. With version vectors on both sides, a side that has seen the other wins outright;
 * concurrent changes go to the newer `c`, the winner takes both vectors, and the other is reported as the loser.
 * Without vectors it's plain last writer wins.
 */
export function mergeRegister<T>(
  a: Register<T> | undefined,
  b: Register<T> | undefined,
): RegisterMerge<T> {
  if (!a) return { value: b };
  if (!b) return { value: a };
  if (!a.cv || !b.cv) return { value: lww(a, b) };
  const order = compareVv(a.cv, b.cv);
  if (order === "after") return { value: a };
  if (order === "before") return { value: b };
  if (order === "equal") return { value: lww(a, b) };
  const winner = lww(a, b)!;
  const loser = winner === a ? b : a;
  const value: Register<T> = { ...winner, cv: mergeVv(a.cv, b.cv) };
  if (canonicalJson(a.v) === canonicalJson(b.v)) return { value };
  return { value, loser, winner };
}

function unionKeys(...maps: (Record<string, unknown> | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const m of maps) if (m) for (const k of Object.keys(m)) keys.add(k);
  return [...keys].sort();
}

/** The id of the notice for a loss: derived from what lost, so every device derives the same one. */
export function lossNoticeId(target: string, loserC: string): string {
  return `cf${sha256Hex(`${target}\n${loserC}`).slice(0, 24)}`;
}

/** The id of the "restored" notice a permanent-delete stub leaves on a note that comes back. */
export function restoredNoticeId(docId: string, stubC: string): string {
  return `rs${sha256Hex(`${docId}\n${stubC}`).slice(0, 24)}`;
}

type ContentGroup = Pick<
  BlockEntry,
  "type" | "schemaVersion" | "text" | "props" | "deleted" | "by" | "cv"
> & { c: string };

function contentGroup(b: BlockEntry): ContentGroup {
  return {
    type: b.type,
    schemaVersion: b.schemaVersion,
    text: b.text,
    props: b.props,
    deleted: b.deleted,
    by: b.by,
    cv: b.cv,
    c: b.c.content,
  };
}

/** What a reader sees of the content, for "did they actually differ?" */
function visibleContent(g: ContentGroup): string {
  return canonicalJson({ type: g.type, text: g.text, props: g.props, deleted: g.deleted !== null });
}

interface BlockMerge {
  block: BlockEntry;
  loss?: { loser: BlockEntry; winner: ContentGroup };
}

function mergeBlock(a: BlockEntry, b: BlockEntry): BlockMerge {
  // Content group, with a delete counted as a content write.
  const ga = contentGroup(a);
  const gb = contentGroup(b);
  const order = compareVv(ga.cv, gb.cv);
  let content: ContentGroup;
  let loss: BlockMerge["loss"];
  if (order === "after") content = ga;
  else if (order === "before") content = gb;
  else if (order === "equal") content = lww(ga, gb)!;
  else {
    const winner = lww(ga, gb)!;
    const loserGroup = winner === ga ? gb : ga;
    content = { ...winner, cv: mergeVv(ga.cv, gb.cv) };
    if (visibleContent(winner) !== visibleContent(loserGroup))
      loss = { loser: winner === ga ? b : a, winner };
  }
  // Position group: last writer wins on (parentId, rank). No notice.
  const pa = { c: a.c.position, parentId: a.parentId, rank: a.rank };
  const pb = { c: b.c.position, parentId: b.parentId, rank: b.rank };
  const position = lww(pa, pb)!;
  // Collapsed: last writer wins. No notice.
  const ca = a.c.collapsed ? { c: a.c.collapsed, v: a.collapsed } : undefined;
  const cb = b.c.collapsed ? { c: b.c.collapsed, v: b.collapsed } : undefined;
  const collapsed = lww(ca, cb);
  const block: BlockEntry = {
    type: content.type,
    schemaVersion: content.schemaVersion,
    text: content.text,
    props: content.props,
    parentId: position.parentId,
    rank: position.rank,
    c: { content: content.c, position: position.c },
    cv: content.cv,
    deleted: content.deleted,
    by: content.by,
  };
  if (collapsed) {
    block.c.collapsed = collapsed.c;
    if (collapsed.v !== undefined) block.collapsed = collapsed.v;
  } else if (a.collapsed !== undefined || b.collapsed !== undefined) {
    block.collapsed =
      a.collapsed !== undefined && b.collapsed !== undefined
        ? byCanonical(a.collapsed, b.collapsed)
        : (a.collapsed ?? b.collapsed)!;
  }
  return { block, loss };
}

function mergeNotices(
  a: Record<string, Notice>,
  b: Record<string, Notice>,
): Record<string, Notice> {
  const out: Record<string, Notice> = {};
  for (const key of unionKeys(a, b)) {
    const x = a[key];
    const y = b[key];
    if (!x || !y) {
      out[key] = (x ?? y)!;
      continue;
    }
    // Same notice id: keep the payload about the newest winner; dismissal is last writer wins.
    const base =
      x.at === y.at ? byCanonical(strip(x), strip(y)) : x.at > y.at ? strip(x) : strip(y);
    const dismissed = lww(x.dismissed, y.dismissed);
    out[key] = dismissed ? { ...base, dismissed } : base;
  }
  return out;
}

function strip(n: Notice): Notice {
  const copy = { ...n };
  delete copy.dismissed;
  return copy;
}

function mergeTags(
  a: Record<string, TagEntry>,
  b: Record<string, TagEntry>,
): Record<string, TagEntry> {
  const out: Record<string, TagEntry> = {};
  for (const key of unionKeys(a, b)) {
    const x = a[key];
    const y = b[key];
    if (!x || !y) {
      out[key] = (x ?? y)!;
      continue;
    }
    const rm = x.rm === null ? y.rm : y.rm === null ? x.rm : x.rm > y.rm ? x.rm : y.rm;
    out[key] = { add: x.add > y.add ? x.add : y.add, rm };
  }
  return out;
}

function mergeCollections(
  a: Record<string, CollectionDef>,
  b: Record<string, CollectionDef>,
): Record<string, CollectionDef> {
  const out: Record<string, CollectionDef> = {};
  for (const key of unionKeys(a, b)) {
    const x = a[key];
    const y = b[key];
    if (!x || !y) {
      out[key] = (x ?? y)!;
      continue;
    }
    const merged: CollectionDef = {
      properties: lwwMap(x.properties, y.properties),
      views: lwwMap(x.views, y.views),
    };
    const name = mergeRegister(x.name, y.name).value;
    if (name) merged.name = name;
    out[key] = merged;
  }
  return out;
}

function mergeRow(a: RowData | undefined, b: RowData | undefined): RowData | undefined {
  if (!a) return b;
  if (!b) return a;
  const row: RowData = {
    collectionId: a.collectionId <= b.collectionId ? a.collectionId : b.collectionId,
    values: lwwMap(a.values, b.values),
  };
  const rank = mergeRegister(a.rank, b.rank).value;
  if (rank) row.rank = rank;
  return row;
}

/** Merges two note files (§3.4). */
export function mergeNote(a: NoteFile, b: NoteFile): MergeResult<NoteFile> {
  if (a.id !== b.id) throw new Error(`Can't merge different notes (${a.id}, ${b.id}).`);
  const losses: Loss[] = [];
  const notices = mergeNotices(a.notices, b.notices);
  const addNotice = (id: string, n: Notice) => {
    notices[id] = mergeNotices({ [id]: n }, notices[id] ? { [id]: notices[id]! } : {})[id]!;
  };

  // Document fields: registers, last writer wins by version vector then c.
  const doc: NoteDoc = { tags: mergeTags(a.doc.tags, b.doc.tags) };
  for (const field of DOC_REGISTER_FIELDS) {
    const r = mergeRegister(
      a.doc[field] as Register<unknown> | undefined,
      b.doc[field] as Register<unknown> | undefined,
    );
    if (r.value) (doc as unknown as Record<string, unknown>)[field] = r.value;
    if (r.loser && r.winner && NOTICED_DOC_FIELDS.includes(field)) {
      const target = `doc.${field}`;
      const from = hlcDevice(r.loser.c);
      const winnerFrom = hlcDevice(r.winner.c);
      const version = conflictVersionName(target, r.loser.c);
      const noticeId = lossNoticeId(target, r.loser.c);
      losses.push({
        kind: "field",
        docId: a.id,
        field,
        state: r.loser,
        from,
        c: r.loser.c,
        winner: { c: r.winner.c, from: winnerFrom },
        version,
        noticeId,
      });
      addNotice(noticeId, {
        blockId: null,
        field,
        kind: "changed",
        from: winnerFrom,
        at: r.winner.c,
        version,
        other: from,
      });
    }
  }
  const kind =
    a.doc.kind && b.doc.kind ? byCanonical(a.doc.kind, b.doc.kind) : (a.doc.kind ?? b.doc.kind);
  if (kind) doc.kind = kind;
  const created = [a.doc.createdAt, b.doc.createdAt].filter(
    (v): v is number => typeof v === "number",
  );
  if (created.length) doc.createdAt = Math.min(...created);

  // Blocks: content by version vector, position and collapsed last writer wins.
  const blocks: Record<string, BlockEntry> = {};
  for (const id of unionKeys(a.blocks, b.blocks)) {
    const x = a.blocks[id];
    const y = b.blocks[id];
    if (!x || !y) {
      const only = (x ?? y)!;
      // A tombstone the other side compacted away: the other side has seen this block and dropped it.
      const otherCompacted = x ? b.compacted : a.compacted;
      if (otherCompacted && dominates(otherCompacted, only.cv)) continue;
      blocks[id] = only;
      continue;
    }
    const m = mergeBlock(x, y);
    blocks[id] = m.block;
    if (m.loss) {
      const loser = m.loss.loser;
      const from = hlcDevice(loser.c.content);
      const winnerFrom = hlcDevice(m.loss.winner.c);
      const version = conflictVersionName(id, loser.c.content);
      const noticeId = lossNoticeId(id, loser.c.content);
      const winnerDeleted = m.loss.winner.deleted !== null;
      losses.push({
        kind: "block",
        docId: a.id,
        blockId: id,
        state: loser,
        from,
        c: loser.c.content,
        winner: { c: m.loss.winner.c, from: winnerFrom, deleted: winnerDeleted },
        version,
        noticeId,
      });
      addNotice(noticeId, {
        blockId: id,
        kind: winnerDeleted ? "deleted" : "changed",
        from: winnerFrom,
        at: m.loss.winner.c,
        version,
        other: from,
      });
    }
  }

  const file: NoteFile = {
    format: NOTE_FORMAT,
    v: NOTE_VERSION,
    id: a.id,
    doc,
    blocks,
    files: lwwMap(a.files, b.files),
    collections: mergeCollections(a.collections, b.collections),
    fileText: lwwMap(a.fileText, b.fileText),
    versionNames: lwwMap(a.versionNames, b.versionNames),
    notices,
    seen: mergeVv(a.seen, b.seen),
  };
  const row = mergeRow(a.row, b.row);
  if (row) file.row = row;
  const compacted = mergeVv(a.compacted, b.compacted);
  if (Object.keys(compacted).length) file.compacted = compacted;
  losses.sort((x, y) => cmp(x.noticeId, y.noticeId));
  return { file, losses };
}

/**
 * Merges any two states of one note, including permanent-delete stubs. A stub drops only what it has seen: if
 * the note has a clock from some device newer than `stub.seen`, the note comes back, in Trash (unless a newer
 * edit took it out), with a "restored" notice.
 */
export function mergeNoteFiles(a: NoteLike, b: NoteLike): MergeResult {
  if (a.id !== b.id) throw new Error(`Can't merge different notes (${a.id}, ${b.id}).`);
  const sa = isStub(a);
  const sb = isStub(b);
  if (sa && sb) {
    const stub: NoteStub = {
      format: NOTE_FORMAT,
      v: NOTE_VERSION,
      id: a.id,
      deleted: lww(a.deleted, b.deleted)!,
      seen: mergeVv(a.seen, b.seen),
    };
    return { file: stub, losses: [] };
  }
  if (!sa && !sb) return mergeNote(a, b);
  const stub = (sa ? a : b) as NoteStub;
  const note = (sa ? b : a) as NoteFile;
  if (dominates(stub.seen, note.seen)) {
    return {
      file: {
        format: NOTE_FORMAT,
        v: NOTE_VERSION,
        id: stub.id,
        deleted: stub.deleted,
        seen: mergeVv(stub.seen, note.seen),
      },
      losses: [],
    };
  }
  const trashed: Register<number | null> = { v: hlcMs(stub.deleted.c), c: stub.deleted.c };
  const current = note.doc.trashedAt;
  const trashedAt = current && current.c > trashed.c ? current : trashed;
  const noticeId = restoredNoticeId(note.id, stub.deleted.c);
  const notices = mergeNotices(note.notices, {
    [noticeId]: {
      blockId: null,
      kind: "restored",
      from: hlcDevice(stub.deleted.c),
      at: stub.deleted.c,
      version: null,
    },
  });
  const file: NoteFile = {
    ...note,
    doc: { ...note.doc, trashedAt },
    notices,
    seen: mergeVv(note.seen, stub.seen),
  };
  delete file.sum;
  return { file, losses: [] };
}

/** Merges many states of one note (any order gives the same note content). */
export function mergeAll(files: readonly NoteLike[]): MergeResult {
  if (files.length === 0) throw new Error("Nothing to merge.");
  let file = files[0]!;
  const losses = new Map<string, Loss>();
  for (const next of files.slice(1)) {
    const r = mergeNoteFiles(file, next);
    file = r.file;
    for (const l of r.losses) losses.set(l.noticeId, l);
  }
  return { file, losses: [...losses.values()] };
}

export interface TreeRepair {
  blockId: string;
  reason: "missing_parent" | "deleted_parent" | "cycle";
}

/**
 * The live blocks of a merged note in document order, with the tree made valid the way the server does it:
 * a block whose parent is missing or deleted moves to the top level, and a cycle made by concurrent moves is
 * broken at the block moved last. Siblings sort by (rank, id). Shapes (columns, tabs) are left as they are.
 */
export function normalizeBlocks(note: NoteFile): { blocks: WireBlock[]; repairs: TreeRepair[] } {
  const live = new Map<string, BlockEntry>();
  for (const [id, b] of Object.entries(note.blocks)) if (!b.deleted) live.set(id, b);
  const parent = new Map<string, string | null>();
  const repairs: TreeRepair[] = [];
  for (const [id, b] of live) {
    if (b.parentId === null) parent.set(id, null);
    else if (!live.has(b.parentId)) {
      parent.set(id, null);
      repairs.push({
        blockId: id,
        reason: note.blocks[b.parentId] ? "deleted_parent" : "missing_parent",
      });
    } else parent.set(id, b.parentId);
  }
  // Break cycles: walk up from every block; a revisit inside the current walk is a cycle.
  const state = new Map<string, 1 | 2>();
  for (const start of [...live.keys()].sort()) {
    if (state.get(start) === 2) continue;
    const path: string[] = [];
    let cur: string | null = start;
    while (cur !== null && state.get(cur) !== 2) {
      if (state.get(cur) === 1) {
        const cycle = path.slice(path.indexOf(cur));
        const moved = cycle.reduce((best, id) =>
          live.get(id)!.c.position > live.get(best)!.c.position ? id : best,
        );
        parent.set(moved, null);
        repairs.push({ blockId: moved, reason: "cycle" });
        break;
      }
      state.set(cur, 1);
      path.push(cur);
      cur = parent.get(cur) ?? null;
    }
    for (const id of path) state.set(id, 2);
  }
  const wires: WireBlock[] = [...live.entries()].map(([id, b]) => ({
    ...blockToWire(id, b),
    parentId: parent.get(id) ?? null,
  }));
  const ordered = flattenTree(wires).map((e) => e.block);
  repairs.sort((x, y) => cmp(x.blockId, y.blockId));
  return { blocks: ordered, repairs };
}

/** Sibling order used everywhere: by rank, then id. */
export const compareBlockOrder = compareSiblings;

/** Version vector that a note's `seen` must cover before a device's local changes count as written. */
export function needsFlush(
  fileSeen: VersionVector | undefined,
  deviceId: string,
  latestLocal: string | null,
): boolean {
  if (!latestLocal) return false;
  return (fileSeen?.[deviceId] ?? "") < latestLocal;
}
