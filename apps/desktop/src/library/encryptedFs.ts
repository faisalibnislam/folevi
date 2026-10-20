// Transparent encryption around the library folder (docs/LOCAL_MODE_PLAN.md §3.9): the page reads and writes
// plain paths and bytes; the folder holds FLV1 envelopes under HMAC names. The same mapping as local-store's
// EncryptedFs (the reference, which encryptedFs.test.ts reads our files with and vice versa), with the key held
// here in the main process and node:crypto doing the work.
import { createHash } from "node:crypto";
import { hmacName, openFile, sealFile, sealStream } from "./crypto";
import { checkDir, checkPath, FILES_DIR, HISTORY_DIR, LIBRARY_FILE, NOTES_DIR, parseNoteFileName, TMP_DIR } from "./paths";
import { LibraryError, type LibraryFs, type LocalFsEntry, type ReadResult, type WriteResult } from "./types";

export class EncryptedNodeFs implements LibraryFs {
  /** HMAC name → note id, and attachment HMAC name → sha256. */
  private readonly noteIds = new Map<string, string>();
  private readonly shas = new Map<string, string>();

  constructor(
    readonly inner: LibraryFs,
    private readonly masterKey: Uint8Array,
  ) {
    if (masterKey.length !== 32) throw new Error("The library key must be 32 bytes.");
  }

  private noteName(id: string): string {
    const name = hmacName(this.masterKey, "note", id);
    this.noteIds.set(name, id);
    return name;
  }

  private fileName(sha: string): string {
    const name = hmacName(this.masterKey, "file", sha);
    this.shas.set(name, sha);
    return name;
  }

  private static plain(path: string): boolean {
    return path === LIBRARY_FILE || path.startsWith(`${TMP_DIR}/`);
  }

  /** Logical path → on-disk path (the logical path is checked first: a name can't hide a `..`). */
  physical(path: string): string {
    const parts = checkPath(path).split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (parsed && !parsed.placeholder) return `${NOTES_DIR}/${this.noteName(parsed.id) + parts[1]!.slice(parsed.id.length)}`;
    }
    if (parts[0] === HISTORY_DIR && parts.length >= 2) return [HISTORY_DIR, this.noteName(parts[1]!), ...parts.slice(2)].join("/");
    if (parts[0] === FILES_DIR && parts.length === 3) {
      const name = this.fileName(parts[2]!);
      return `${FILES_DIR}/${name.slice(0, 2)}/${name}`;
    }
    return path;
  }

  /** The path a file's key comes from: its canonical on-disk path (a provider's copy uses the original's). */
  static keyPath(physical: string): string {
    const parts = physical.split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (parsed) return `${NOTES_DIR}/${parsed.id}.fnote`;
    }
    if (parts[0] === HISTORY_DIR && parts.length === 3) {
      const file = parts[2]!;
      const cut = file.search(/[ (]/);
      if (cut > 0 && file.endsWith(".fver")) return `${parts[0]}/${parts[1]}/${file.slice(0, cut)}.fver`;
    }
    return physical;
  }

  seal(physical: string, bytes: Uint8Array): Uint8Array {
    if (EncryptedNodeFs.plain(physical)) return bytes;
    const keyPath = EncryptedNodeFs.keyPath(physical);
    return physical.startsWith(`${FILES_DIR}/`) ? sealStream(this.masterKey, keyPath, bytes) : sealFile(this.masterKey, keyPath, bytes);
  }

  open(physical: string, bytes: Uint8Array): Uint8Array {
    if (EncryptedNodeFs.plain(physical)) return bytes;
    try {
      return openFile(this.masterKey, EncryptedNodeFs.keyPath(physical), bytes);
    } catch (error) {
      throw new LibraryError("unreadable", (error as Error).message, physical);
    }
  }

  /** On-disk path → logical path, learning unknown names by decrypting the file. Null if it can't be read. */
  async logical(physical: string): Promise<string | null> {
    const parts = physical.split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (!parsed || parsed.placeholder) return physical;
      let id = this.noteIds.get(parsed.id);
      if (!id) {
        try {
          const r = await this.inner.read(physical);
          if ("notDownloaded" in r) return physical;
          const value = JSON.parse(Buffer.from(this.open(physical, r.bytes)).toString("utf8")) as { id?: unknown };
          if (typeof value.id !== "string") return null;
          id = value.id;
          if (this.noteName(id) !== parsed.id) return null;
        } catch {
          return null;
        }
      }
      return `${NOTES_DIR}/${id + parts[1]!.slice(parsed.id.length)}`;
    }
    if (parts[0] === HISTORY_DIR && parts.length >= 2) {
      const id = this.noteIds.get(parts[1]!);
      return id ? [HISTORY_DIR, id, ...parts.slice(2)].join("/") : null;
    }
    if (parts[0] === FILES_DIR && parts.length === 3) {
      let sha = this.shas.get(parts[2]!);
      if (!sha) {
        try {
          const r = await this.inner.read(physical);
          if ("notDownloaded" in r) return null;
          sha = createHash("sha256").update(this.open(physical, r.bytes)).digest("hex");
          if (this.fileName(sha) !== parts[2]) return null;
        } catch {
          return null;
        }
      }
      return `${FILES_DIR}/${sha.slice(0, 2)}/${sha}`;
    }
    return physical;
  }

  /** The logical path for a physical one already seen (no file reads); null when unknown. */
  knownLogical(physical: string): string | null {
    const parts = physical.split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (!parsed) return null;
      if (parsed.placeholder) return physical;
      const id = this.noteIds.get(parsed.id);
      return id ? `${NOTES_DIR}/${id + parts[1]!.slice(parsed.id.length)}` : null;
    }
    if (parts[0] === HISTORY_DIR && parts.length >= 2) {
      const id = this.noteIds.get(parts[1]!);
      return id ? [HISTORY_DIR, id, ...parts.slice(2)].join("/") : null;
    }
    if (parts[0] === FILES_DIR && parts.length === 3) {
      const sha = this.shas.get(parts[2]!);
      return sha ? `${FILES_DIR}/${sha.slice(0, 2)}/${sha}` : null;
    }
    return physical;
  }

  async list(dir: string): Promise<LocalFsEntry[]> {
    checkDir(dir);
    if (dir === "" || dir === HISTORY_DIR || dir.startsWith(`${HISTORY_DIR}/`)) {
      // History folders are named after notes: learn the note names first.
      for (const e of await this.inner.list(NOTES_DIR)) await this.logical(e.path);
    }
    const entries = await this.inner.list(dir === "" ? "" : this.physical(dir));
    const out: LocalFsEntry[] = [];
    for (const e of entries) {
      const path = await this.logical(e.path);
      if (path) out.push({ ...e, path });
    }
    return out;
  }

  /** WatchSource.entries: logical entries for on-disk paths, or null when a name is new (list everything then). */
  async entries(physical: string[]): Promise<Map<string, LocalFsEntry | null> | null> {
    const inner = this.inner as LibraryFs & { entries?(p: string[]): Promise<Map<string, LocalFsEntry | null>> };
    if (!inner.entries) return null;
    const found = await inner.entries(physical);
    const out = new Map<string, LocalFsEntry | null>();
    for (const [phys, e] of found) {
      if (EncryptedNodeFs.plain(phys) && phys !== LIBRARY_FILE) continue;
      const logical = this.knownLogical(phys);
      if (!logical) return null;
      out.set(logical, e ? { ...e, path: logical } : null);
    }
    return out;
  }

  async read(path: string): Promise<ReadResult> {
    const physical = this.physical(path);
    const r = await this.inner.read(physical);
    if ("notDownloaded" in r) return r;
    return { bytes: this.open(physical, r.bytes), etag: r.etag };
  }

  async write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult> {
    const physical = this.physical(path);
    return this.inner.write(physical, this.seal(physical, bytes), o);
  }

  async remove(path: string, o?: { ifMatch?: string }): Promise<void> {
    return this.inner.remove(this.physical(path), o);
  }

  async conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    const physical = this.physical(path);
    const out: { id: string; bytes: Uint8Array }[] = [];
    for (const v of await this.inner.conflictVersions(physical)) out.push({ id: v.id, bytes: this.open(physical, v.bytes) });
    return out;
  }

  async resolveConflicts(path: string, ids: string[]): Promise<void> {
    return this.inner.resolveConflicts(this.physical(path), ids);
  }

  async startDownload(paths: string[]): Promise<void> {
    return this.inner.startDownload(paths.map((p) => this.physical(p)));
  }
}
