// Local mode's search index (docs/LOCAL_MODE_PLAN.md §3.1 and §5.1): the library's notes (title and text, as
// the server's `search_title` and `search_text` indexes hold them) and the text found in their files (the
// server's `fileTexts.search_text`), kept on this device beside the library, never in it. One per backend.
//
// It follows the library rather than being told about writes: each search first brings the index up to date
// with the rows it reads (a note whose stamp changed is indexed again, one that's gone is dropped), so edits
// from this window, another window and another device (read from disk) are all found the same way, and an
// index loaded from storage only re-reads what changed since it was saved. What it holds is saved through the
// store's `searchIndexStorage` hook (IndexedDB in the persistent store), a moment after it last changed.
import type { LocalDocument, LocalFileText, LocalIndexStorage } from "../store";
import { TextIndex, type TextIndexSnapshot } from "./textIndex";

export { queryTerms, tokenize, TextIndex, type TextIndexSnapshot } from "./textIndex";

/** What the index was built from: anything that changes a note's indexed text changes this. */
export function noteStamp(d: LocalDocument): string {
  return `${d.seq}|${d.updatedAt}|${d.textRev ?? 0}|${d.title.length}|${d.searchText.length}`;
}

export function fileTextStamp(r: LocalFileText): string {
  return `${r.updatedAt}|${r.text.length}|${r.hash}`;
}

/** The stored form (versioned: a different version is ignored and the index is rebuilt). */
interface Snapshot {
  format: "folevi-search-index";
  v: 1;
  notes: TextIndexSnapshot;
  files: TextIndexSnapshot;
}

export interface LocalSearchIndexOptions {
  storage?: LocalIndexStorage;
  /** How long after the last change it's saved (default 2 s). */
  saveDelayMs?: number;
}

export class LocalSearchIndex {
  /** Notes: the title alone (search_title) and the whole search text, title included (search_text). */
  readonly notes = new TextIndex(["title", "text"] as const);
  /** Found text, by row id (a file's id, or `hw:<block>` for a whiteboard's handwriting). */
  readonly files = new TextIndex(["text"] as const);
  private loading: Promise<void> | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly opts: LocalSearchIndexOptions = {}) {}

  /** Loads what was saved (once). A snapshot that can't be read is dropped and the index starts empty. */
  ready(): Promise<void> {
    this.loading ??= (async () => {
      const storage = this.opts.storage;
      if (!storage) return;
      try {
        const snap = (await storage.load()) as Snapshot | null | undefined;
        if (snap && snap.format === "folevi-search-index" && snap.v === 1 && this.notes.restore(snap.notes) && this.files.restore(snap.files)) return;
      } catch (e) {
        console.warn("[local mode] The saved search index couldn't be read; it's built again.", e);
      }
      this.notes.clear();
      this.files.clear();
    })();
    return this.loading;
  }

  /** Brings the notes index up to date with these rows (every note in the library). Synchronous. */
  syncNotes(docs: readonly LocalDocument[]): void {
    const live = new Set<string>();
    for (const d of docs) {
      live.add(d.id);
      const stamp = noteStamp(d);
      if (this.notes.stampOf(d.id) === stamp) continue;
      // Synced content has no title and no search text of its own (the notes showing it are found).
      this.notes.set(d.id, stamp, { title: d.title, text: d.searchText });
      this.dirty = true;
    }
    for (const id of [...this.notes.ids()]) {
      if (live.has(id)) continue;
      this.notes.remove(id);
      this.dirty = true;
    }
    this.scheduleSave();
  }

  /** The same for found text (every row in the library). */
  syncFileTexts(rows: readonly LocalFileText[]): void {
    const live = new Set<string>();
    for (const r of rows) {
      const key = fileTextKey(r);
      live.add(key);
      const stamp = fileTextStamp(r);
      if (this.files.stampOf(key) === stamp) continue;
      this.files.set(key, stamp, { text: r.text });
      this.dirty = true;
    }
    for (const id of [...this.files.ids()]) {
      if (live.has(id)) continue;
      this.files.remove(id);
      this.dirty = true;
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.dirty || !this.opts.storage || this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, this.opts.saveDelayMs ?? 2000);
  }

  private save(): Promise<void> {
    const storage = this.opts.storage;
    if (!storage || !this.dirty) return this.saving;
    this.dirty = false;
    const snap: Snapshot = { format: "folevi-search-index", v: 1, notes: this.notes.snapshot(), files: this.files.snapshot() };
    this.saving = this.saving
      .then(() => storage.save(snap))
      .catch((e: unknown) => {
        // Not fatal: the index is rebuilt from the library next time.
        this.dirty = true;
        console.warn("[local mode] The search index couldn't be saved.", e);
      });
    return this.saving;
  }

  /** Saves now what's waiting to be saved (closing the library). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.save();
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }
}

/** A found-text row's key in the index: unique per file, or per whiteboard for handwriting. */
export function fileTextKey(r: Pick<LocalFileText, "documentId" | "id">): string {
  return `${r.documentId}\u0000${r.id}`;
}
