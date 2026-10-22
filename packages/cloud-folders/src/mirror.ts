// The library's copy on this device for a cloud connection. Every file read from or written to Dropbox or
// Drive is kept here with the provider's etag, so unchanged files are never downloaded twice, attachments and
// versions open offline, and signing out of the provider leaves a usable library folder on the Mac (the same
// layout as the cloud folder). Provider state (the list cursor or page token and the file index) is saved
// next to it. Platform neutral: the Mac's implementation is nodeMirror.ts.

export interface MirrorFile {
  bytes: Uint8Array;
  etag: string;
}

export interface MirrorStore {
  readFile(path: string): Promise<MirrorFile | null>;
  writeFile(path: string, bytes: Uint8Array, etag: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Library paths this copy holds. */
  paths(): Promise<string[]>;
  loadState(): Promise<unknown>;
  saveState(state: unknown): Promise<void>;
}

export class MemoryMirror implements MirrorStore {
  readonly files = new Map<string, MirrorFile>();
  state: unknown = null;
  /** For tests: how often each path was written here. */
  readonly writes = new Map<string, number>();

  async readFile(path: string): Promise<MirrorFile | null> {
    const f = this.files.get(path);
    return f ? { bytes: f.bytes.slice(), etag: f.etag } : null;
  }
  async writeFile(path: string, bytes: Uint8Array, etag: string): Promise<void> {
    this.files.set(path, { bytes: bytes.slice(), etag });
    this.writes.set(path, (this.writes.get(path) ?? 0) + 1);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async paths(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }
  async loadState(): Promise<unknown> {
    return this.state === null ? null : JSON.parse(JSON.stringify(this.state));
  }
  async saveState(state: unknown): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state));
  }
}

/** Attachments and version files never change once written, so a local copy is always good. */
export function isImmutablePath(path: string): boolean {
  return path.startsWith("files/") || path.startsWith("history/");
}
