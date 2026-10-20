// An in-memory LocalFs for tests and the FakeShell: etags, ifMatch, placeholders and conflict versions.
import { assertLibraryPath, isValidLibraryPath } from "../layout";
import {
  LocalFsError,
  type LocalFs,
  type LocalFsEntry,
  type ReadResult,
  type WriteResult,
} from "../io";

interface MemoryFile {
  bytes: Uint8Array;
  etag: string;
  mtimeMs: number;
  downloaded: boolean;
  conflicts: { id: string; bytes: Uint8Array }[];
}

export interface MemoryFsOptions {
  now?: () => number;
}

export class MemoryFs implements LocalFs {
  private files = new Map<string, MemoryFile>();
  private generation = 0;
  private readonly now: () => number;

  constructor(options: MemoryFsOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  private nextEtag(): string {
    this.generation += 1;
    return `m${this.generation.toString(36)}`;
  }

  private check(path: string): string {
    if (!isValidLibraryPath(path))
      throw new LocalFsError("invalid_path", `Invalid library path: ${JSON.stringify(path)}`, path);
    return path;
  }

  async list(dir: string): Promise<LocalFsEntry[]> {
    if (dir !== "") assertLibraryPath(dir);
    const prefix = dir === "" ? "" : `${dir}/`;
    const out: LocalFsEntry[] = [];
    for (const [path, f] of this.files) {
      if (!path.startsWith(prefix)) continue;
      out.push({
        path,
        size: f.bytes.length,
        mtimeMs: f.mtimeMs,
        etag: f.etag,
        downloaded: f.downloaded,
        hasConflicts: f.conflicts.length > 0,
      });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async read(path: string): Promise<ReadResult> {
    const f = this.files.get(this.check(path));
    if (!f) throw new LocalFsError("not_found", `No such file: ${path}`, path);
    if (!f.downloaded) return { notDownloaded: true };
    return { bytes: f.bytes.slice(), etag: f.etag };
  }

  async write(
    path: string,
    bytes: Uint8Array,
    o: { ifMatch?: string | null },
  ): Promise<WriteResult> {
    this.check(path);
    const f = this.files.get(path);
    if (o.ifMatch === null && f) return { mismatch: true, etag: f.etag };
    if (typeof o.ifMatch === "string" && (!f || f.etag !== o.ifMatch))
      return { mismatch: true, etag: f?.etag ?? "" };
    return { etag: this.put(path, bytes, f?.conflicts ?? []) };
  }

  async remove(path: string, o: { ifMatch?: string } = {}): Promise<void> {
    const f = this.files.get(this.check(path));
    if (!f) return;
    if (o.ifMatch !== undefined && f.etag !== o.ifMatch)
      throw new LocalFsError("mismatch", `Changed since read: ${path}`, path);
    this.files.delete(path);
  }

  async conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    return (this.files.get(this.check(path))?.conflicts ?? []).map((c) => ({
      id: c.id,
      bytes: c.bytes.slice(),
    }));
  }

  async resolveConflicts(path: string, ids: string[]): Promise<void> {
    const f = this.files.get(this.check(path));
    if (f) f.conflicts = f.conflicts.filter((c) => !ids.includes(c.id));
  }

  // ---- Test hooks ----

  /** Writes without any check (a provider delivering a file). Returns the new etag. */
  put(
    path: string,
    bytes: Uint8Array,
    conflicts: { id: string; bytes: Uint8Array }[] = this.files.get(path)?.conflicts ?? [],
  ): string {
    const etag = this.nextEtag();
    this.files.set(path, {
      bytes: bytes.slice(),
      etag,
      mtimeMs: this.now(),
      downloaded: true,
      conflicts,
    });
    return etag;
  }

  /** Turns a file into a placeholder (not downloaded yet). */
  evict(path: string): void {
    const f = this.files.get(path);
    if (f) f.downloaded = false;
  }

  /** Adds an NSFileVersion-style conflict version. */
  addConflictVersion(path: string, bytes: Uint8Array): string {
    const f = this.files.get(path);
    if (!f) throw new LocalFsError("not_found", `No such file: ${path}`, path);
    const id = `v${this.nextEtag()}`;
    f.conflicts.push({ id, bytes: bytes.slice() });
    return id;
  }

  /** Synchronous peek for assertions. */
  peek(path: string): Uint8Array | undefined {
    return this.files.get(path)?.bytes.slice();
  }

  etagOf(path: string): string | undefined {
    return this.files.get(path)?.etag;
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  delete(path: string): void {
    this.files.delete(path);
  }
}
