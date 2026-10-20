// Transparent encryption around a LocalFs, the way natives do it inside `shell.library` (§3.9): the page
// reads and writes plain paths and bytes; the folder holds FLV1 envelopes under HMAC names. This TypeScript
// version is the reference for natives and runs under the FakeShell in tests.
import { sha256Hex } from "../sha256";
import { fromUtf8 } from "../bytes";
import {
  LocalFsError,
  type LocalFs,
  type LocalFsEntry,
  type ReadResult,
  type WriteResult,
} from "../io";
import {
  FILES_DIR,
  HISTORY_DIR,
  LIBRARY_FILE,
  NOTES_DIR,
  TMP_DIR,
  isValidLibraryPath,
  parseNoteFileName,
} from "../layout";
import { hmacName, openFile, sealFile, sealStream } from "./envelope";

export class EncryptedFs implements LocalFs {
  /** HMAC name → note id, and attachment HMAC name → sha256. */
  private readonly noteIds = new Map<string, string>();
  private readonly shas = new Map<string, string>();

  constructor(
    private readonly inner: LocalFs,
    private readonly masterKey: Uint8Array,
  ) {}

  private async noteName(id: string): Promise<string> {
    const name = await hmacName(this.masterKey, "note", id);
    this.noteIds.set(name, id);
    return name;
  }

  private async fileName(sha: string): Promise<string> {
    const name = await hmacName(this.masterKey, "file", sha);
    this.shas.set(name, sha);
    return name;
  }

  private static plain(path: string): boolean {
    return path === LIBRARY_FILE || path.startsWith(`${TMP_DIR}/`);
  }

  /** Logical path → on-disk path. The logical path is checked first, so a mapped name can't hide a `..`. */
  async physical(path: string): Promise<string> {
    if (!isValidLibraryPath(path))
      throw new LocalFsError("invalid_path", `Invalid library path: ${JSON.stringify(path)}`, path);
    const parts = path.split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (parsed && !parsed.placeholder)
        return `${NOTES_DIR}/${(await this.noteName(parsed.id)) + parts[1]!.slice(parsed.id.length)}`;
    }
    if (parts[0] === HISTORY_DIR && parts.length >= 2)
      return [HISTORY_DIR, await this.noteName(parts[1]!), ...parts.slice(2)].join("/");
    if (parts[0] === FILES_DIR && parts.length === 3) {
      const name = await this.fileName(parts[2]!);
      return `${FILES_DIR}/${name.slice(0, 2)}/${name}`;
    }
    return path;
  }

  /** The path a file's key is derived from: its canonical on-disk path (a copy uses the original's). */
  private static keyPath(physical: string): string {
    const parts = physical.split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (parsed) return `${NOTES_DIR}/${parsed.id}.fnote`;
    }
    if (parts[0] === HISTORY_DIR && parts.length === 3) {
      // A provider's copy of a version file ("<name> 2.fver", "<name>(1).fver", Dropbox's): version names have
      // no spaces or parentheses, so the original name is everything before the first one.
      const file = parts[2]!;
      const cut = file.search(/[ (]/);
      if (cut > 0 && file.endsWith(".fver"))
        return `${parts[0]}/${parts[1]}/${file.slice(0, cut)}.fver`;
    }
    return physical;
  }

  private async seal(physical: string, bytes: Uint8Array): Promise<Uint8Array> {
    if (EncryptedFs.plain(physical)) return bytes;
    const keyPath = EncryptedFs.keyPath(physical);
    return physical.startsWith(`${FILES_DIR}/`)
      ? sealStream(this.masterKey, keyPath, bytes)
      : sealFile(this.masterKey, keyPath, bytes);
  }

  private async open(physical: string, bytes: Uint8Array): Promise<Uint8Array> {
    if (EncryptedFs.plain(physical)) return bytes;
    try {
      return await openFile(this.masterKey, EncryptedFs.keyPath(physical), bytes);
    } catch (error) {
      throw new LocalFsError("unreadable", (error as Error).message, physical);
    }
  }

  /** On-disk path → logical path, learning unknown names by decrypting the file. Null if it can't be read. */
  private async logical(physical: string): Promise<string | null> {
    const parts = physical.split("/");
    if (parts[0] === NOTES_DIR && parts.length === 2) {
      const parsed = parseNoteFileName(parts[1]!);
      if (!parsed || parsed.placeholder) return physical;
      let id = this.noteIds.get(parsed.id);
      if (!id) {
        try {
          const r = await this.inner.read(physical);
          if ("notDownloaded" in r) return physical;
          const value = JSON.parse(fromUtf8(await this.open(physical, r.bytes))) as {
            id?: unknown;
          };
          if (typeof value.id !== "string") return null;
          id = value.id;
          if ((await this.noteName(id)) !== parsed.id) return null;
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
          sha = sha256Hex(await this.open(physical, r.bytes));
          if ((await this.fileName(sha)) !== parts[2]) return null;
        } catch {
          return null;
        }
      }
      return `${FILES_DIR}/${sha.slice(0, 2)}/${sha}`;
    }
    return physical;
  }

  async list(dir: string): Promise<LocalFsEntry[]> {
    if (dir === "" || dir === HISTORY_DIR || dir.startsWith(`${HISTORY_DIR}/`)) {
      // History directories are named after notes: learn the note names first.
      for (const e of await this.inner.list(NOTES_DIR)) await this.logical(e.path);
    }
    const entries = await this.inner.list(dir === "" ? "" : await this.physical(dir));
    const out: LocalFsEntry[] = [];
    for (const e of entries) {
      const path = await this.logical(e.path);
      if (path) out.push({ ...e, path });
    }
    return out;
  }

  async read(path: string): Promise<ReadResult> {
    const physical = await this.physical(path);
    const r = await this.inner.read(physical);
    if ("notDownloaded" in r) return r;
    return { bytes: await this.open(physical, r.bytes), etag: r.etag };
  }

  async write(
    path: string,
    bytes: Uint8Array,
    o: { ifMatch?: string | null },
  ): Promise<WriteResult> {
    const physical = await this.physical(path);
    return this.inner.write(physical, await this.seal(physical, bytes), o);
  }

  async remove(path: string, o?: { ifMatch?: string }): Promise<void> {
    return this.inner.remove(await this.physical(path), o);
  }

  async conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    const physical = await this.physical(path);
    const out: { id: string; bytes: Uint8Array }[] = [];
    for (const v of await this.inner.conflictVersions(physical))
      out.push({ id: v.id, bytes: await this.open(physical, v.bytes) });
    return out;
  }

  async resolveConflicts(path: string, ids: string[]): Promise<void> {
    return this.inner.resolveConflicts(await this.physical(path), ids);
  }
}
