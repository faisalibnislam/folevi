// A LibraryHost in memory (store/types.ts): the library part of the shell bridge over any LocalFs, with a
// journal, change events and the passphrase. For tests (over packages/local-store's MemoryFs, or a FaultyCloud
// mount for several devices) and as the reference for what the native layers do: encryption is transparent
// (EncryptedFs, the TypeScript reference of the natives' crypto) and the page never sees the key.
import {
  EncryptedFs,
  LIBRARY_FILE,
  LocalFsError,
  MemoryFs,
  MemoryJournal,
  createEncryption,
  createManifest,
  decodeManifest,
  encodeManifest,
  unlockMasterKey,
  type EncryptionHeader,
  type LocalFs,
  type LocalFsEntry,
  type ReadResult,
  type WriteResult,
} from "@folevi/local-store";
import type { LibraryChange, LibraryInfo, LibraryKind } from "@/lib/shell/types";
import type { LibraryHost } from "./types";

export interface MemoryLibraryHostOptions {
  /** The folder as this device sees it (default: a new MemoryFs). */
  fs?: LocalFs;
  /** This device's journal (kept across "launches" by passing the same one). */
  journal?: MemoryJournal;
  kind?: LibraryKind;
  /** An unlocked library's key (a device that has it in its keychain). */
  masterKey?: Uint8Array;
}

export class MemoryLibraryHost implements LibraryHost {
  readonly inner: LocalFs;
  readonly journal: MemoryJournal;
  kind: LibraryKind;
  available = true;
  private encrypted: LocalFs | null = null;
  private header: EncryptionHeader | null | undefined = undefined;
  private watchers = new Set<(changes: LibraryChange[]) => void>();
  readonly downloads: string[] = [];

  constructor(opts: MemoryLibraryHostOptions = {}) {
    this.inner = opts.fs ?? new MemoryFs();
    this.journal = opts.journal ?? new MemoryJournal();
    this.kind = opts.kind ?? "device";
    if (opts.masterKey) this.pendingKey = opts.masterKey;
  }

  private pendingKey: Uint8Array | null = null;

  private async encryption(): Promise<EncryptionHeader | null> {
    if (this.header !== undefined) return this.header;
    try {
      const r = await this.inner.read(LIBRARY_FILE);
      this.header = "bytes" in r ? decodeManifest(r.bytes).encryption : null;
    } catch {
      this.header = null;
    }
    if (this.header && this.pendingKey) this.encrypted = new EncryptedFs(this.inner, this.pendingKey);
    return this.header;
  }

  /** The files as the page sees them: decrypted when the library is encrypted and unlocked. */
  private async fs(path: string): Promise<LocalFs> {
    const header = await this.encryption();
    if (!header || path === LIBRARY_FILE) return this.inner;
    if (!this.encrypted) throw new LocalFsError("unreadable", "The library is locked.", path);
    return this.encrypted;
  }

  async info(): Promise<LibraryInfo> {
    const header = await this.encryption();
    return { kind: this.kind, displayPath: "Test library", available: this.available, encrypted: !!header, locked: !!header && !this.encrypted };
  }

  async setup(o: { kind: LibraryKind }): Promise<LibraryInfo | null> {
    this.kind = o.kind;
    return await this.info();
  }

  async unlock(passphrase: string): Promise<boolean> {
    const header = await this.encryption();
    if (!header) return true;
    const key = await unlockMasterKey(header, passphrase);
    if (!key) return false;
    this.encrypted = new EncryptedFs(this.inner, key);
    return true;
  }

  /** Forgets the key (the app relaunched without it in the keychain). */
  lock(): void {
    this.encrypted = null;
    this.pendingKey = null;
    this.header = undefined;
  }

  async list(dir: string): Promise<LocalFsEntry[]> {
    const header = await this.encryption();
    if (!header) return await this.inner.list(dir);
    if (!this.encrypted) throw new LocalFsError("unreadable", "The library is locked.", dir);
    return await this.encrypted.list(dir);
  }

  async read(path: string): Promise<ReadResult> {
    return await (await this.fs(path)).read(path);
  }

  async write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult> {
    const r = await (await this.fs(path)).write(path, bytes, o);
    if (!("mismatch" in r)) this.emit([{ path, kind: "changed" }]);
    return r;
  }

  async remove(path: string, o?: { ifMatch?: string }): Promise<void> {
    await (await this.fs(path)).remove(path, o);
    this.emit([{ path, kind: "removed" }]);
  }

  async conflictVersions(path: string) {
    return await (await this.fs(path)).conflictVersions(path);
  }

  async resolveConflicts(path: string, ids: string[]) {
    await (await this.fs(path)).resolveConflicts(path, ids);
  }

  async startDownload(paths: string[]): Promise<void> {
    this.downloads.push(...paths);
  }

  watch(cb: (changes: LibraryChange[]) => void): () => void {
    this.watchers.add(cb);
    return () => {
      this.watchers.delete(cb);
    };
  }

  /** Tells watchers about changes made behind the page's back (another device's sync landing). */
  notify(changes: LibraryChange[]): void {
    this.emit(changes);
  }

  private emit(changes: LibraryChange[]) {
    for (const w of [...this.watchers]) queueMicrotask(() => w(changes));
  }
}

/**
 * Makes a new encrypted library in `fs` (what the native layer does for "Encrypt with a passphrase"): its
 * manifest with the wrapped key. Returns the master key, which a device keeps in its keychain.
 */
export async function createEncryptedLibrary(fs: LocalFs, libraryId: string, passphrase: string, opts: { iterations?: number; now?: number } = {}): Promise<Uint8Array> {
  const { header, masterKey } = await createEncryption(passphrase, { iterations: opts.iterations });
  const w = await fs.write(LIBRARY_FILE, encodeManifest(createManifest(libraryId, opts.now ?? Date.now(), header)), { ifMatch: null });
  if ("mismatch" in w) throw new Error("There's a library here already.");
  return masterKey;
}
