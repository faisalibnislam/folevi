// What the Dropbox and Google Drive LocalFs have in common: an index of the library's files kept current from
// the provider's change feed (a stored cursor or page token, so a sync asks only "what changed?"), reads
// through the device copy (mirror.ts), and a watch loop for `shell.library.watch`. The providers implement
// the requests. Platform neutral.
//
// Reads, writes and removes go straight to the provider; nothing is queued here. While offline, writes fail
// with CloudError "offline" and the edits wait in the journal (LOCAL_MODE_PLAN.md §3.6) until a later sync
// flushes them; reads and listings answer from the device copy meanwhile.
import { isImmutablePath, type MirrorStore } from "./mirror";
import {
  checkDir,
  checkPath,
  CloudError,
  isCloudError,
  notFound,
  realSleep,
  underDir,
  type CloudChange,
  type CloudProvider,
  type LocalFs,
  type LocalFsEntry,
  type ReadResult,
  type Sleep,
  type WriteResult,
} from "./types";

export interface RemoteEntry {
  path: string;
  etag: string;
  size: number;
  mtimeMs: number;
}

export interface CloudFsOptions {
  /** Waits between watch rounds and after errors. */
  sleep?: Sleep;
  /** A listing asks the provider for changes at most this often (ms); 0 asks every time. */
  refreshEveryMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

export interface WatchHandle {
  stop(): void;
  /** Resolves when the loop has ended. */
  done: Promise<void>;
}

export abstract class CloudFs<E extends RemoteEntry = RemoteEntry> implements LocalFs {
  abstract readonly provider: CloudProvider;
  /** Library path → what the provider holds there. */
  protected readonly entries = new Map<string, E>();
  protected loaded = false;
  private refreshing: Promise<CloudChange[]> | null = null;
  private lastRefresh = -Infinity;
  private saving: Promise<void> | null = null;
  private saveAgain = false;
  protected readonly sleep: Sleep;
  protected readonly now: () => number;
  protected readonly log: (message: string) => void;
  private readonly refreshEveryMs: number;

  constructor(
    protected readonly mirror: MirrorStore,
    options: CloudFsOptions = {},
  ) {
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.refreshEveryMs = options.refreshEveryMs ?? 0;
  }

  // ---------------------------------------------------------------- provider hooks

  /** Brings `entries` up to date (a full listing the first time, then the change feed). Returns what changed. */
  protected abstract pullChanges(): Promise<CloudChange[]>;
  /** The current bytes and etag (not_found when missing). */
  protected abstract download(path: string, entry: E | undefined): Promise<{ bytes: Uint8Array; etag: string; entry: E }>;
  /** The write with `ifMatch` semantics; on success, the new entry. */
  protected abstract upload(path: string, bytes: Uint8Array, ifMatch: string | null | undefined): Promise<{ entry: E } | { mismatch: true; etag: string; entry?: E }>;
  /** Removes the file; a missing file is fine, a changed one rejects with "mismatch". */
  protected abstract delete(path: string, ifMatch: string | undefined): Promise<void>;
  /** Resolves when the provider may have changes (Dropbox's longpoll; Drive polls). */
  protected abstract waitForChanges(signal: AbortSignal): Promise<void>;
  /** Provider state to save with the index (cursor, page token, folder ids…). */
  protected abstract providerState(): unknown;
  protected abstract restoreProviderState(state: unknown): boolean;
  protected abstract restoreEntry(raw: unknown): E | null;

  // ---------------------------------------------------------------- state

  /** Loads the saved index and cursor; false when there is none (the first listing will be a full one). */
  async open(): Promise<boolean> {
    if (this.loaded) return true;
    const state = (await this.mirror.loadState()) as { v?: number; provider?: string; entries?: unknown[]; p?: unknown } | null;
    if (!state || state.v !== 1 || state.provider !== this.provider || !Array.isArray(state.entries) || !this.restoreProviderState(state.p)) return false;
    this.entries.clear();
    for (const raw of state.entries) {
      const e = this.restoreEntry(raw);
      if (e) this.entries.set(e.path, e);
    }
    this.loaded = true;
    return true;
  }

  /** Saves the index (coalesced: one write at a time, the last state wins). */
  protected save(): Promise<void> {
    if (this.saving) {
      this.saveAgain = true;
      return this.saving;
    }
    this.saving = (async () => {
      try {
        do {
          this.saveAgain = false;
          await this.mirror.saveState({ v: 1, provider: this.provider, entries: [...this.entries.values()], p: this.providerState() });
        } while (this.saveAgain);
      } catch (error) {
        this.log(`Couldn't save the ${this.provider} index: ${(error as Error).message}`);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** Asks the provider what changed (one request at a time). Throws when it can't be reached. */
  refresh(): Promise<CloudChange[]> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        await this.open();
        const changes = await this.pullChanges();
        this.loaded = true;
        this.lastRefresh = this.now();
        await this.save();
        return changes;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // ---------------------------------------------------------------- LocalFs

  async list(dir: string): Promise<LocalFsEntry[]> {
    checkDir(dir);
    if (!this.loaded || this.now() - this.lastRefresh >= this.refreshEveryMs) {
      try {
        await this.refresh();
      } catch (error) {
        // Offline: answer from the last index, unless there has never been one.
        if (!isCloudError(error, "offline") || !(await this.open())) throw error;
      }
    }
    const out: LocalFsEntry[] = [];
    for (const e of this.entries.values())
      if (underDir(e.path, dir))
        out.push({ path: e.path, size: e.size, mtimeMs: e.mtimeMs, etag: e.etag, downloaded: true, hasConflicts: this.hasConflicts(e.path) });
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  protected hasConflicts(_path: string): boolean {
    return false;
  }

  async read(path: string): Promise<ReadResult> {
    checkPath(path);
    await this.open();
    const entry = this.entries.get(path);
    const local = await this.mirror.readFile(path);
    if (local && (isImmutablePath(path) || (entry && local.etag === entry.etag))) return { bytes: local.bytes, etag: entry?.etag ?? local.etag };
    try {
      const r = await this.download(path, entry);
      this.entries.set(path, r.entry);
      await this.mirror.writeFile(path, r.bytes, r.etag);
      void this.save();
      return { bytes: r.bytes, etag: r.etag };
    } catch (error) {
      if ((error as { code?: string })?.code === "not_found") {
        if (this.entries.delete(path)) void this.save();
        throw notFound(path);
      }
      // Offline: the device copy (writes are refused while offline, so a stale etag can't overwrite anything).
      if (isCloudError(error, "offline") && local) return { bytes: local.bytes, etag: local.etag };
      throw error;
    }
  }

  async write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult> {
    checkPath(path);
    await this.open();
    const r = await this.upload(path, bytes, o.ifMatch);
    if ("mismatch" in r) {
      // The index was behind: the next read downloads the current file.
      if (r.entry) this.entries.set(path, r.entry);
      else if (r.etag === "") this.entries.delete(path);
      void this.save();
      return { mismatch: true, etag: r.etag };
    }
    this.entries.set(path, r.entry);
    await this.mirror.writeFile(path, bytes, r.entry.etag);
    void this.save();
    return { etag: r.entry.etag };
  }

  async remove(path: string, o: { ifMatch?: string } = {}): Promise<void> {
    checkPath(path);
    await this.open();
    await this.delete(path, o.ifMatch);
    this.entries.delete(path);
    await this.mirror.deleteFile(path);
    void this.save();
  }

  async conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    checkPath(path);
    return [];
  }

  async resolveConflicts(path: string, _ids: string[]): Promise<void> {
    checkPath(path);
  }

  // ---------------------------------------------------------------- watching

  /**
   * Reports changes as they happen until stopped. Network trouble backs off and keeps going; a revoked
   * sign-in ends the loop (the connection shows "Reconnect").
   */
  watch(cb: (changes: CloudChange[]) => void, onError?: (error: unknown) => void): WatchHandle {
    const controller = new AbortController();
    const done = (async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          const changes = await this.refresh();
          failures = 0;
          if (changes.length && !controller.signal.aborted) cb(changes);
          await this.waitForChanges(controller.signal);
        } catch (error) {
          if (controller.signal.aborted) break;
          onError?.(error);
          if (isCloudError(error, "reconnect")) break;
          failures++;
          await this.sleep(Math.min(300_000, 5_000 * 2 ** Math.min(6, failures - 1)));
        }
      }
    })();
    return { stop: () => controller.abort(), done };
  }

  /** For tests and Library health: what the index holds. */
  indexedPaths(): string[] {
    return [...this.entries.keys()].sort();
  }
}

export function abortable(signal: AbortSignal, sleep: Sleep, ms: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    void sleep(ms).then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

export function protocolError(what: string, status?: number): CloudError {
  return new CloudError("protocol", what, status);
}
