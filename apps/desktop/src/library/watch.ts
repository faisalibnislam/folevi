// Change detection for the library folder (docs/LOCAL_MODE_PLAN.md §3.7): `fs.watch(root, { recursive: true })`
// (FSEvents) for speed, plus a full listing every 30 seconds, on wake and on focus, because FSEvents can
// coalesce or drop events and providers write behind its back. Everything is diffed against the state last
// reported, so the page gets one batch per burst of changes, with each path once, and never its own writes
// echoed back (fs.ts tells the watcher about them).
//
// Kinds: "changed" (new or different etag), "removed", "downloaded" (a placeholder's contents arrived) and
// "uploaded" (iCloud says the file is in the cloud; from folevi-files' status reports).
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { TMP_DIR } from "./paths";
import type { LibraryChange, LocalFsEntry } from "./types";

export interface WatchSource {
  /** The whole library, as logical entries. */
  list(dir: string): Promise<LocalFsEntry[]>;
  /**
   * Entries for paths fs.watch reported (relative to the root, as on disk), or null when the source can't
   * map them (an encrypted library with names it hasn't seen): the watcher lists everything instead.
   */
  entries?(physical: string[]): Promise<Map<string, LocalFsEntry | null> | null>;
}

export interface WatcherOptions {
  root: string;
  source: WatchSource;
  onChanges: (changes: LibraryChange[]) => void;
  /** Full listing interval (30 s). */
  scanIntervalMs?: number;
  /** Quiet time before a burst of fs.watch events is reported. */
  debounceMs?: number;
  /** Off in tests that drive scans by hand. */
  useFsEvents?: boolean;
}

interface Known {
  etag: string;
  downloaded: boolean;
  uploaded: boolean | null;
}

export class LibraryWatcher {
  private state = new Map<string, Known>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private pendingPhysical = new Set<string>();
  private fullPending = false;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private ready: Promise<void>;

  constructor(private readonly o: WatcherOptions) {
    this.ready = this.baseline();
  }

  /** Starts watching; the first listing is the baseline (nothing is reported for it). */
  async start(): Promise<void> {
    await this.ready;
    if (this.stopped) return;
    if (this.o.useFsEvents !== false) {
      try {
        this.watcher = fsWatch(this.o.root, { recursive: true, persistent: false }, (_event, name) => this.onEvent(name ? String(name) : null));
        this.watcher.on("error", () => this.schedule(true));
      } catch {
        // No FSEvents for this folder (a network volume): the scans still run.
        this.watcher = null;
      }
    }
    this.timer = setInterval(() => this.rescan(), this.o.scanIntervalMs ?? 30_000);
    this.timer.unref();
  }

  private async baseline() {
    try {
      for (const e of await this.o.source.list("")) this.state.set(e.path, { etag: e.etag, downloaded: e.downloaded, uploaded: null });
    } catch {
      // The folder isn't there right now; the first scan that works becomes the baseline's diff.
    }
  }

  private onEvent(name: string | null) {
    if (this.stopped) return;
    if (!name) return this.schedule(true);
    const path = name.split("\\").join("/");
    if (path === TMP_DIR || path.startsWith(`${TMP_DIR}/`)) return;
    this.pendingPhysical.add(path);
    this.schedule(false);
  }

  private schedule(full: boolean) {
    if (full) this.fullPending = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.flush();
    }, this.o.debounceMs ?? 250);
    this.debounce.unref();
  }

  /** Paths (relative, as on disk) something else saw change: folevi-files' status reports. */
  touch(physical: string[]) {
    if (this.stopped || !physical.length) return;
    for (const p of physical) this.pendingPhysical.add(p);
    this.schedule(false);
  }

  /** A full listing now (the 30 s timer, wake, focus, "Sync now"). */
  rescan(): Promise<void> {
    this.fullPending = true;
    return this.flush();
  }

  /** The page wrote or removed this file itself: remember it so it isn't reported back. */
  noteOwnChange(path: string, entry: LocalFsEntry | null, o: { pendingUpload?: boolean } = {}) {
    if (entry) this.state.set(path, { etag: entry.etag, downloaded: entry.downloaded, uploaded: o.pendingUpload ? false : (this.state.get(path)?.uploaded ?? null) });
    else this.state.delete(path);
  }

  /** Upload and download state from folevi-files (iCloud): logical paths. */
  noteStatus(items: { path: string; downloaded: boolean; uploaded: boolean }[]) {
    const changes: LibraryChange[] = [];
    for (const it of items) {
      const k = this.state.get(it.path);
      if (!k) continue;
      if (it.uploaded && k.uploaded === false) changes.push({ path: it.path, kind: "uploaded" });
      k.uploaded = it.uploaded;
    }
    if (changes.length) this.o.onChanges(changes);
  }

  private flush(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      await this.ready;
      do {
        this.again = false;
        const full = this.fullPending;
        const physical = [...this.pendingPhysical];
        this.fullPending = false;
        this.pendingPhysical.clear();
        if (this.stopped) return;
        try {
          if (full) await this.diffAll();
          else if (physical.length) await this.diffSome(physical);
        } catch {
          // The folder went away mid-scan; the next scan tries again.
        }
      } while (this.again || this.fullPending || this.pendingPhysical.size);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private compare(path: string, e: LocalFsEntry, changes: LibraryChange[]) {
    const k = this.state.get(path);
    if (!k) changes.push({ path, kind: "changed" });
    else if (!k.downloaded && e.downloaded) changes.push({ path, kind: "downloaded" });
    else if (k.etag !== e.etag) changes.push({ path, kind: "changed" });
    this.state.set(path, { etag: e.etag, downloaded: e.downloaded, uploaded: k?.uploaded ?? null });
  }

  private async diffAll() {
    const entries = await this.o.source.list("");
    const changes: LibraryChange[] = [];
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.path);
      this.compare(e.path, e, changes);
    }
    for (const path of [...this.state.keys()]) {
      if (!seen.has(path)) {
        this.state.delete(path);
        changes.push({ path, kind: "removed" });
      }
    }
    this.emit(changes);
  }

  private async diffSome(physical: string[]) {
    const found = this.o.source.entries ? await this.o.source.entries(physical) : null;
    if (!found) return this.diffAll();
    const changes: LibraryChange[] = [];
    for (const [path, e] of found) {
      if (e) this.compare(path, e, changes);
      else {
        // Gone: the file itself, or a whole folder of them.
        for (const known of [...this.state.keys()]) {
          if (known === path || known.startsWith(`${path}/`)) {
            this.state.delete(known);
            changes.push({ path: known, kind: "removed" });
          }
        }
      }
    }
    this.emit(changes);
  }

  private emit(changes: LibraryChange[]) {
    if (!changes.length || this.stopped) return;
    // One entry per path (the last word wins), in path order.
    const byPath = new Map<string, LibraryChange>();
    for (const c of changes) byPath.set(c.path, c);
    this.o.onChanges([...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1)));
  }

  stop() {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.debounce = null;
  }
}
