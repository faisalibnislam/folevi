// Moving or copying between any two places (docs/MULTI_ACCOUNT_PLAN.md §7.1): the same copy (copy.ts) over a
// source reshaped on the way. Each shape is a MigrationSource wrapping another, so they stack:
//
// - `pickedSource`: only some folders and notes (a picked folder brings its subfolders and every note in them; a
//   picked note brings the notes under it, its collection rows and the synced content it shows);
// - `freshSource`: new ids for everything that comes along. Note, block, folder, collection and version ids are
//   unique on the server (`by_public_id`, `by_block_id`), so a copy into an account that may already hold them
//   (account to account, a copy made twice, a Takeout import) can't reuse them. A new id is derived from the old
//   one and the move's key (its time part, then 16 characters of SHA-256(key, id)), so a copy that stops and
//   goes on makes the same ones, and every mention of a copied id inside the copied content follows.
//
// `trashOriginals` finishes a move: the copied notes go to Trash where they came from (restorable for 30 days)
// and the emptied folders go.
import { sha256, utf8 } from "@folevi/local-store";
import { inboxDocumentId, PERSONAL_SCOPE_KEY, syncedSourceIds, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { MigrationClient, MigrationSource, SourceCollection, SourceNote } from "./types";

/** What to bring: some folders and notes; null or empty for everything. */
export interface Pick {
  folders: string[];
  notes: string[];
}

export function pickIsEverything(pick: Pick | null | undefined): boolean {
  return !pick || (!pick.folders.length && !pick.notes.length);
}

/** Everything the picked folders and notes stand for, worked out from the source once. */
export async function resolvePick(source: MigrationSource, pick: Pick): Promise<{ folders: Set<string>; notes: Set<string> }> {
  const { folders } = await source.organization();
  const notes = await source.notes();
  const folderIds = new Set(pick.folders);
  // Subfolders of a picked folder.
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) {
      if (f.parentFolderId && folderIds.has(f.parentFolderId) && !folderIds.has(f.id)) {
        folderIds.add(f.id);
        grew = true;
      }
    }
  }
  const noteIds = new Set(pick.notes);
  for (const n of notes) if (n.folderId && folderIds.has(n.folderId) && n.kind !== "synced") noteIds.add(n.id);
  // Notes under the picked ones (nested pages and collection rows), and the synced content they show.
  const children = new Map<string, SourceNote[]>();
  for (const n of notes) if (n.parentDocumentId) children.set(n.parentDocumentId, [...(children.get(n.parentDocumentId) ?? []), n]);
  const queue = [...noteIds];
  const synced = new Set<string>();
  while (queue.length) {
    const id = queue.pop()!;
    for (const c of children.get(id) ?? []) {
      if (noteIds.has(c.id)) continue;
      noteIds.add(c.id);
      queue.push(c.id);
    }
    for (const s of syncedSourceIds(await source.blocks(id))) {
      if (noteIds.has(s) || synced.has(s)) continue;
      synced.add(s);
      noteIds.add(s);
      queue.push(s);
    }
  }
  return { folders: folderIds, notes: noteIds };
}

/** Only the picked folders and notes. A note whose folder didn't come along lands at the top (Drafts) there. */
export function pickedSource(source: MigrationSource, pick: Pick): MigrationSource {
  let resolved: Promise<{ folders: Set<string>; notes: Set<string> }> | null = null;
  const sets = () => (resolved ??= resolvePick(source, pick));
  return {
    ...source,
    async organization() {
      const [{ folders, tags }, s, notes] = await Promise.all([source.organization(), sets(), source.notes()]);
      const used = new Set(notes.filter((n) => s.notes.has(n.id)).flatMap((n) => n.tagIds));
      return {
        folders: folders.filter((f) => s.folders.has(f.id)).map((f) => (f.parentFolderId && !s.folders.has(f.parentFolderId) ? { ...f, parentFolderId: null } : f)),
        tags: tags.filter((t) => used.has(t.id)),
      };
    },
    async notes() {
      const [notes, s] = await Promise.all([source.notes(), sets()]);
      return notes.filter((n) => s.notes.has(n.id)).map((n) => (n.folderId && !s.folders.has(n.folderId) ? { ...n, folderId: null } : n));
    },
  };
}

// ---------------------------------------------------------------------------------------------------- fresh ids

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A new id for `id` in the move with this key: always the same for the same two. */
export function freshId(key: string, id: string): string {
  const digest = sha256(utf8(`folevi-move:${key}:${id}`));
  let rand = "";
  for (let i = 0; i < 26; i++) rand += CROCKFORD[(digest[i] ?? 0) % 32];
  // A ULID keeps its time (so the copies sort like the originals); anything else gets a time of its own.
  const time = ULID.test(id) ? id.slice(0, 10) : CROCKFORD[(digest[26] ?? 0) % 8]! + rand.slice(16, 25);
  return time + rand.slice(0, 16);
}

/** Replaces every known id in a value: exact strings, and ids inside longer strings (JSON a block keeps, links). */
export function replaceIds<T>(value: T, map: (id: string) => string | undefined): T {
  const token = /[0-9A-Za-z_-]{12,64}/g;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = map(v);
      if (whole !== undefined) return whole;
      return v.length >= 12 ? v.replace(token, (t) => map(t) ?? t) : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[map(k) ?? k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * New ids for everything that comes along. The source's Inbox keeps its id (unless `keepInbox` is false), so the
 * copy can still pour it into the Inbox there. Ids the copied content names that aren't coming along (a link to another note) stay as they are.
 */
export function freshSource(source: MigrationSource, key: string, o: { keepInbox?: boolean } = {}): MigrationSource {
  const keepInbox = o.keepInbox ?? true;
  const fresh = new Map<string, string>();
  const back = new Map<string, string>();
  let inbox: string | null = null;
  const add = (id: string | null | undefined) => {
    if (!id || id === inbox || fresh.has(id)) return;
    const n = freshId(key, id);
    fresh.set(id, n);
    back.set(n, id);
  };
  const to = (id: string) => fresh.get(id);
  const orig = (id: string) => back.get(id) ?? id;
  let known: Promise<SourceNote[]> | null = null;
  const notes = () =>
    (known ??= (async () => {
      if (keepInbox) inbox = inboxDocumentId(await source.profileId(), PERSONAL_SCOPE_KEY);
      const list = await source.notes();
      for (const n of list) add(n.id);
      for (const f of (await source.organization()).folders) add(f.id);
      for (const n of list) if (n.collectionId) add(n.collectionId);
      return list;
    })());
  const mapBlocks = (blocks: WireBlock[]): WireBlock[] => {
    for (const b of blocks) add(b.id);
    return blocks.map((b) => replaceIds({ ...b, id: to(b.id) ?? b.id, parentId: b.parentId ? (to(b.parentId) ?? b.parentId) : null }, to));
  };
  return {
    profileId: () => source.profileId(),
    async organization() {
      await notes();
      const org = await source.organization();
      return { folders: org.folders.map((f) => ({ ...f, id: to(f.id) ?? f.id, parentFolderId: f.parentFolderId ? (to(f.parentFolderId) ?? f.parentFolderId) : null })), tags: org.tags };
    },
    async notes() {
      const list = await notes();
      return list.map((n) => ({
        ...replaceIds(n, to),
        id: to(n.id) ?? n.id,
        tagIds: n.tagIds,
      }));
    },
    async blocks(documentId) {
      await notes();
      return mapBlocks(await source.blocks(orig(documentId)));
    },
    async collection(collectionId) {
      await notes();
      const c = await source.collection(orig(collectionId));
      if (!c) return null;
      for (const p of c.properties) add(p.id);
      for (const v of c.views) add(v.id);
      for (const r of c.rows) add(r.id);
      return replaceIds(c, to) satisfies SourceCollection;
    },
    async file(fileId, documentId, kind) {
      return await source.file(fileId, orig(documentId), kind);
    },
    async fileTexts(documentId) {
      await notes();
      return (await source.fileTexts(orig(documentId))).map((t) => ({ ...t, blockId: to(t.blockId) ?? t.blockId }));
    },
    async versions(documentId) {
      await notes();
      return (await source.versions(orig(documentId))).map((v) => {
        add(v.id);
        return { ...v, id: to(v.id) ?? v.id, blocks: mapBlocks(v.blocks) };
      });
    },
  };
}

/** A random key for a move (kept with it, so it can go on with the same new ids). */
export function newMoveKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CROCKFORD[b % 32]).join("");
}

// ---------------------------------------------------------------------------------------------------- moving

/**
 * Finishes a move: every note that came along goes to Trash where it was (its notes under it go with it), then
 * the folders that came along, now empty, are deleted. The Inbox stays (its lines came along; the page is the
 * place's own).
 */
export async function trashOriginals(o: { client: MigrationClient; notes: SourceNote[]; folders: string[]; inboxId: string | null; onProgress?: (done: number, total: number) => void }): Promise<void> {
  const ids = new Set(o.notes.map((n) => n.id));
  const tops = o.notes.filter((n) => n.id !== o.inboxId && !n.inTrash && !(n.parentDocumentId && ids.has(n.parentDocumentId) && n.kind !== "synced"));
  let done = 0;
  for (const n of tops) {
    try {
      await o.client.mutation(api.documents.moveToTrash, { documentId: n.id });
    } catch {
      // Already gone there, or not ours to move: it stays where it is.
    }
    o.onProgress?.(++done, tops.length);
  }
  for (const f of [...o.folders].reverse()) {
    try {
      await o.client.mutation(api.organization.deleteFolder, { folderId: f });
    } catch {
      // A folder that still holds something (a note added meanwhile) stays.
    }
  }
}
