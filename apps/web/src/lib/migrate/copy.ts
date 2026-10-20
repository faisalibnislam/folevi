// The copy both moves are made of (docs/LOCAL_MODE_PLAN.md §6): every folder, tag and note of a source into a
// target, with the same ids for folders, notes, blocks, synced content and collections, in an order the target
// takes them in (parents first, synced content before the notes showing it, a collection's host before its
// rows), attachments stored there before the blocks that show them, found text, and optionally history.
//
// It can stop anywhere (the app quits, the Mac sleeps, a rate limit) and go on later: what's done is recorded
// as it's done (progress.ts), and every step is idempotent on both backends, so a step done twice changes
// nothing (a create sent again returns what it made; identical content is "applied" again).
import { ConvexError } from "convex/values";
import { inboxDocumentId, PERSONAL_SCOPE_KEY, rankSequence, type WireBlock, type WireDocumentCreate } from "@folevi/editor-schema";
import { freshState } from "./progress";
import { blockFile, coverFile, parentsFirst, remapBlock, remapRowValues, type IdMaps } from "./remap";
import type { FileProblem, MigrationProblem, MigrationProgress, MigrationSource, MigrationState, MigrationTarget, ProgressStore, SourceCollection, SourceFolder, SourceNote } from "./types";

export interface CopyOptions {
  source: MigrationSource;
  target: MigrationTarget;
  progress: ProgressStore;
  direction: MigrationState["direction"];
  /** Bring each note's saved versions along (documents.importSnapshot). */
  versions: boolean;
  /** The source's Inbox becomes the target's (Personal to Personal). */
  mapInbox: boolean;
  /** A workspace coming down as a folder of its own: its folders go inside it, and so do its loose notes. */
  intoFolder?: { id: string; name: string };
  onProgress?: (p: MigrationProgress) => void;
  signal?: AbortSignal;
  now?: () => number;
  /** Waits (tests make it instant). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Why a move stopped, for people to read; `code` for the interface. */
export class MigrationError extends Error {
  constructor(
    readonly code: "other_account" | "cancelled" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

/** The code and data of an error a backend threw (ConvexError's data), or nothing. */
export function errorData(error: unknown): { code?: string; message?: string; retryAfterMs?: number } {
  if (error instanceof ConvexError && error.data && typeof error.data === "object") return error.data as { code?: string };
  if (error && typeof error === "object" && "data" in error && (error as { data?: unknown }).data && typeof (error as { data: unknown }).data === "object") return (error as { data: { code?: string } }).data;
  return {};
}

export function errorText(error: unknown): string {
  return errorData(error).message ?? (error instanceof Error ? error.message : String(error));
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new MigrationError("cancelled", "The move was stopped."));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new MigrationError("cancelled", "The move was stopped."));
      },
      { once: true },
    );
  });

/** Folders with every parent before its children (one whose parent isn't listed sits at the top). */
export function foldersParentsFirst(folders: readonly SourceFolder[]): SourceFolder[] {
  const ids = new Set(folders.map((f) => f.id));
  const kids = new Map<string | null, SourceFolder[]>();
  for (const f of folders) {
    const parent = f.parentFolderId && ids.has(f.parentFolderId) ? f.parentFolderId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), parent === f.parentFolderId ? f : { ...f, parentFolderId: null }]);
  }
  const out: SourceFolder[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of (kids.get(parent) ?? []).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
      if (depth < 32) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const f of folders) if (!seen.has(f.id)) out.push({ ...f, parentFolderId: null });
  return out;
}

/**
 * The order notes go in: synced content first (a note showing it needs it there), then every note before the
 * notes under it (a collection's rows are notes under their host). Among siblings, the one changed longest ago
 * first, so on the other side the one changed last is still the most recent.
 */
export function orderNotes(notes: readonly SourceNote[]): SourceNote[] {
  const ids = new Set(notes.map((n) => n.id));
  const kids = new Map<string | null, SourceNote[]>();
  for (const n of notes) {
    const parent = n.kind !== "synced" && n.parentDocumentId && ids.has(n.parentDocumentId) ? n.parentDocumentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), n]);
  }
  const older = (a: SourceNote, b: SourceNote) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
  const out: SourceNote[] = [];
  const seen = new Set<string>();
  const walk = (list: SourceNote[], depth: number) => {
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
      if (depth < 64) walk([...(kids.get(n.id) ?? [])].sort(older), depth + 1);
    }
  };
  const roots = [...(kids.get(null) ?? [])];
  walk(roots.filter((n) => n.kind === "synced").sort(older), 0);
  walk(roots.filter((n) => n.kind !== "synced").sort(older), 0);
  for (const n of notes) if (!seen.has(n.id)) out.push(n);
  return out;
}

/** Why an upload was refused, as a file problem; null for anything else (the copy stops and can go on). */
function fileProblem(error: unknown): FileProblem | null {
  const { code, message } = errorData(error);
  if (code === "quota_exceeded") return "space";
  if (code === "invalid_argument" && /up to \d+ MB/.test(message ?? "")) return "size";
  if (code === "unsupported_file" || code === "invalid_argument") return "refused";
  return null;
}

/** Copies the source into the target, going on from where a run before stopped. Returns what was done. */
export async function copyLibrary(o: CopyOptions): Promise<MigrationState> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const { source, target } = o;
  const [sourceProfileId, targetProfileId] = [await source.profileId(), await target.profileId()];
  let state = await o.progress.load();
  if (state && (state.sourceProfileId !== sourceProfileId || state.targetProfileId !== targetProfileId || state.direction !== o.direction)) {
    throw new MigrationError("other_account", "This move was started with another account. Sign in with that account to finish it.");
  }
  if (!state) {
    state = freshState(o.direction, sourceProfileId, targetProfileId, now());
    await o.progress.save(state);
  }
  if (state.finishedAt) return state;
  const s: MigrationState = state;
  const save = () => o.progress.save(s);
  const progress: MigrationProgress = { phase: "organizing", notesDone: 0, notesTotal: 0, filesDone: Object.keys(s.files).length, current: null, waitingUntil: null };
  const report = (patch: Partial<MigrationProgress> = {}) => {
    Object.assign(progress, patch);
    o.onProgress?.({ ...progress });
  };
  const checkStop = () => {
    if (o.signal?.aborted) throw new MigrationError("cancelled", "The move was stopped.");
  };
  /** Runs a step, waiting out the target's rate limits (uploads are limited per hour) and trying again. */
  const patiently = async <T>(step: () => Promise<T>): Promise<T> => {
    for (;;) {
      checkStop();
      try {
        const out = await step();
        if (progress.waitingUntil !== null) report({ waitingUntil: null });
        return out;
      } catch (error) {
        const data = errorData(error);
        if (data.code !== "rate_limited") throw error;
        const wait = Math.min(Math.max(1000, data.retryAfterMs ?? 30_000), 15 * 60_000);
        report({ waitingUntil: now() + wait });
        await sleep(wait, o.signal);
      }
    }
  };
  const problem = (p: MigrationProblem) => {
    s.problems.push(p);
  };

  // ---- folders and tags ------------------------------------------------------------------------------
  report({ phase: "organizing" });
  const { folders, tags } = await source.organization();
  const folderIds = new Set(folders.map((f) => f.id));
  if (o.intoFolder && !s.folders[o.intoFolder.id]) {
    await patiently(() => target.createFolder({ id: o.intoFolder!.id, name: o.intoFolder!.name, parentFolderId: null, color: null }));
    s.folders[o.intoFolder.id] = true;
    await save();
  }
  for (const f of foldersParentsFirst(folders)) {
    if (s.folders[f.id]) continue;
    await patiently(() => target.createFolder({ id: f.id, name: f.name, parentFolderId: f.parentFolderId ?? o.intoFolder?.id ?? null, color: f.color }));
    s.folders[f.id] = true;
    await save();
  }
  for (const t of tags) {
    if (s.tags[t.id]) continue;
    s.tags[t.id] = await patiently(() => target.ensureTag({ name: t.name, color: t.color }));
    await save();
  }

  // ---- notes ---------------------------------------------------------------------------------------
  const notes = orderNotes(await source.notes());
  const byId = new Map(notes.map((n) => [n.id, n]));
  const sourceInbox = o.mapInbox ? inboxDocumentId(sourceProfileId, PERSONAL_SCOPE_KEY) : null;
  const hasInbox = sourceInbox !== null && byId.has(sourceInbox);
  if (hasInbox && !s.inbox) {
    const inbox = await patiently(() => target.inbox());
    s.inbox = { documentId: inbox.documentId, base: inbox.lastRank };
    await save();
  }
  const documents = new Map<string, string>(hasInbox && s.inbox && sourceInbox ? [[sourceInbox, s.inbox.documentId]] : []);
  const mapped = (id: string) => documents.get(id) ?? id;
  const maps = (): IdMaps => {
    const files = new Map<string, string>();
    const missingFiles = new Map<string, { problem: FileProblem; name: string }>();
    for (const [id, v] of Object.entries(s.files)) {
      if (typeof v === "string") files.set(id, v);
      else missingFiles.set(id, { problem: v.problem, name: v.name });
    }
    return { documents, files, missingFiles, profiles: new Map([[sourceProfileId, targetProfileId]]) };
  };
  const collections = new Map<string, SourceCollection | null>();
  const collectionOf = async (id: string) => {
    if (!collections.has(id)) collections.set(id, await source.collection(id));
    return collections.get(id) ?? null;
  };
  report({ phase: "notes", notesTotal: notes.length, notesDone: notes.filter((n) => s.notes[n.id]).length });

  const copyNote = async (note: SourceNote) => {
    const isInbox = note.id === sourceInbox && hasInbox;
    const id = mapped(note.id);
    const parent = note.kind !== "synced" && note.parentDocumentId && byId.has(note.parentDocumentId) ? mapped(note.parentDocumentId) : null;
    const folder = parent || note.kind === "synced" ? null : note.folderId && folderIds.has(note.folderId) ? note.folderId : (o.intoFolder?.id ?? null);
    const blocks = await source.blocks(note.id);
    const cover = coverFile(note.cover);

    // The note itself (the Inbox is already there).
    let madeAsRow = false;
    if (!isInbox && note.kind === "collectionRow" && note.collectionId) {
      const coll = await collectionOf(note.collectionId);
      const row = coll?.rows.find((r) => r.documentId === note.id);
      if (coll && row && s.collections[coll.id]) {
        await patiently(() => target.addRow(coll.id, { id: row.id, documentId: note.id, title: note.title, values: remapRowValues(row.values, coll.properties, maps()) }));
        madeAsRow = true;
      }
    }
    if (!isInbox && !madeAsRow) {
      const kind = note.kind === "collectionRow" || (note.kind === "daily" && s.dailyAsPage[note.id]) ? "document" : note.kind;
      const doc: WireDocumentCreate = {
        id,
        parentDocumentId: parent,
        folderId: folder,
        kind,
        title: note.title,
        icon: note.icon,
        style: note.style,
        // A theme image is stored first (below), then set.
        ...(cover ? {} : { cover: note.cover }),
        dailyDate: kind === "daily" ? note.dailyDate : null,
        scope: { kind: "personal" },
      };
      const made = await patiently(() => target.createDocument(doc));
      if (made === "exists") {
        // A Daily Note for that date is already there: this one comes as an ordinary page.
        s.dailyAsPage[note.id] = true;
        await save();
        await patiently(() => target.createDocument({ ...doc, kind: "document", dailyDate: null }));
      }
    }

    // Its collections: properties, views and rows, before the blocks that show them.
    const hosted = new Set<string>();
    for (const b of blocks) if (b.type === "collection" && typeof (b.props as { collectionId?: unknown }).collectionId === "string") hosted.add((b.props as { collectionId: string }).collectionId);
    for (const n of notes) if (n.kind === "collectionRow" && n.parentDocumentId === note.id && n.collectionId) hosted.add(n.collectionId);
    for (const cid of hosted) {
      if (s.collections[cid]) continue;
      const coll = await collectionOf(cid);
      if (!coll || coll.hostDocumentId !== note.id) continue;
      await patiently(() => target.putCollection(coll));
      const values = maps();
      for (const row of [...coll.rows].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))) {
        const rowNote = byId.get(row.documentId);
        if (!rowNote) continue;
        await patiently(() => target.addRow(coll.id, { id: row.id, documentId: row.documentId, title: rowNote.title, values: remapRowValues(row.values, coll.properties, values) }));
      }
      s.collections[cid] = true;
      await save();
    }

    // Attachments, stored there first so the blocks can point at them.
    const wanted: { fileId: string; kind: "image" | "file" | "audio" | "cover"; name: string }[] = [];
    for (const b of blocks) {
      const f = blockFile(b);
      if (f) wanted.push(f);
    }
    if (cover) wanted.push({ fileId: cover, kind: "cover", name: "Theme image" });
    for (const f of wanted) {
      if (s.files[f.fileId] !== undefined) continue;
      checkStop();
      const file = await source.file(f.fileId, note.id, f.kind);
      if (!file) {
        s.files[f.fileId] = { problem: "missing", name: f.name };
        problem({ kind: "file", documentId: note.id, title: note.title, detail: "missing", name: f.name, problem: "missing" });
      } else {
        try {
          s.files[f.fileId] = await patiently(() => target.putFile(file, id));
        } catch (error) {
          const why = fileProblem(error);
          if (!why) throw error;
          s.files[f.fileId] = { problem: why, name: file.name || f.name };
          problem({ kind: "file", documentId: note.id, title: note.title, detail: errorText(error), name: file.name || f.name, problem: why });
        }
      }
      await save();
      report({ filesDone: progress.filesDone + 1 });
    }

    // The blocks, parents first, pointing at what's there.
    const m = maps();
    let out: WireBlock[] = parentsFirst(blocks).map((b) => remapBlock(b, m));
    if (isInbox && s.inbox) {
      // Appended after what the Inbox there already holds (its lines from before the move come first).
      const roots = out.filter((b) => b.parentId === null);
      const ranks = rankSequence(roots.length, s.inbox.base, null);
      const rankOf = new Map(roots.map((b, i) => [b.id, ranks[i]!]));
      out = out.map((b) => (rankOf.has(b.id) ? { ...b, rank: rankOf.get(b.id)! } : b));
    }
    if (out.length) {
      const { refused } = await patiently(() => target.putBlocks(id, out));
      for (const r of refused) problem({ kind: "block", documentId: note.id, title: note.title, detail: r.message });
    }

    // What needs a stored file (the theme image) or a row's look.
    const patch: Record<string, unknown> = {};
    if (cover) {
      const there = s.files[cover];
      if (typeof there === "string") patch.cover = { ...note.cover, value: there };
    }
    if (madeAsRow && (note.icon || note.cover.kind !== "none")) {
      if (note.icon) patch.icon = note.icon;
      if (!cover && note.cover.kind !== "none") patch.cover = note.cover;
    }
    if (Object.keys(patch).length) await patiently(() => target.updateDocument(id, patch));

    if (!isInbox) {
      if (note.starred) await patiently(() => target.setStarred(id, true));
      if (note.archivedAt !== null) await patiently(() => target.setArchived(id, true));
      const tagIds = note.tagIds.map((t) => s.tags[t]).filter((t): t is string => Boolean(t));
      if (tagIds.length) await patiently(() => target.setTags(id, tagIds));
    }

    // Text found in its files and drawings (a file that didn't come along has none).
    for (const ft of await source.fileTexts(note.id)) {
      const there = ft.fileId ? s.files[ft.fileId] : null;
      if (ft.fileId && typeof there !== "string") continue;
      const fileId = typeof there === "string" ? there : null;
      try {
        await patiently(() => target.saveFileText(id, { ...ft, fileId }));
      } catch (error) {
        // Refused there (Settings > AI turned reading images off, say): reported. Anything else stops the move.
        if (!errorData(error).code) throw error;
        problem({ kind: "fileText", documentId: note.id, title: note.title, detail: errorText(error) });
      }
    }

    // Its history, oldest first.
    if (o.versions) {
      for (const v of await source.versions(note.id)) {
        if (s.versions[v.id]) continue;
        try {
          await patiently(() => target.importVersion(id, { ...v, blocks: v.blocks.map((b) => remapBlock(b, m)) }));
        } catch (error) {
          if (errorData(error).code !== "limit_exceeded") throw error;
          problem({ kind: "version", documentId: note.id, title: note.title, detail: errorText(error) });
        }
        s.versions[v.id] = true;
        await save();
      }
    }
  };

  for (const note of notes) {
    if (s.notes[note.id]) continue;
    checkStop();
    report({ current: note.title || "Untitled" });
    await copyNote(note);
    s.notes[note.id] = "done";
    await save();
    report({ notesDone: progress.notesDone + 1 });
  }

  // ---- Trash, last: nothing can be added under a note in Trash -----------------------------------------
  report({ phase: "trash", current: null });
  for (const note of notes) {
    if (!note.inTrash || s.trashed[note.id] || note.id === sourceInbox) continue;
    // Its parent going to Trash takes it along.
    const parent = note.parentDocumentId ? byId.get(note.parentDocumentId) : undefined;
    if (!(parent?.inTrash && note.kind !== "synced")) await patiently(() => target.moveToTrash(mapped(note.id)));
    s.trashed[note.id] = true;
    await save();
  }

  s.finishedAt = now();
  await save();
  report({ phase: "done" });
  return s;
}
