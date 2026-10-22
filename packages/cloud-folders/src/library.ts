// A library on Dropbox or Google Drive, for the Mac's library service (../service.ts): the provider's LocalFs
// (also a LibraryFs, so ../encryptedFs.ts wraps it for an encrypted library exactly as it wraps a folder),
// the library file made on first connect (or the one another device made adopted), change batches in the
// shape `shell.library.watch` sends, and a "copy everything here" pass so the Mac keeps a whole library. The
// journal stays in Application Support like a folder library's (../journal.ts): it doesn't depend on where the
// files are. Platform neutral.
import type { CloudFs } from "./cloudFs";
import type { CloudConnections } from "./connection";
import type { CloudChange, CloudProvider } from "./types";

export const LIBRARY_FILE = "folevi-library.json";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID for a new library (the same shape as ../service.ts newLibraryId). */
export function newLibraryUlid(now = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const r = new Uint8Array(16);
  crypto.getRandomValues(r);
  let rand = "";
  for (const b of r) rand += CROCKFORD[b % 32];
  return time + rand;
}

export interface CloudLibraryManifest {
  format: "folevi-library";
  v: number;
  libraryId: string;
  createdAt: number;
  minWriterVersion: number;
  encryption: unknown;
  [k: string]: unknown;
}

export interface CloudLibraryInfo {
  kind: CloudProvider;
  /** "Dropbox › Apps › Folevi", "Google Drive › Folevi". */
  displayPath: string;
  available: boolean;
  libraryId: string | null;
  encrypted: boolean;
}

export const DISPLAY_PATHS: Record<CloudProvider, string> = {
  dropbox: "Dropbox › Apps › Folevi",
  googleDrive: "Google Drive › Folevi",
};

function decodeManifest(bytes: Uint8Array): CloudLibraryManifest {
  const m = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CloudLibraryManifest>;
  if (!m || m.format !== "folevi-library" || typeof m.libraryId !== "string" || typeof m.createdAt !== "number" || typeof m.minWriterVersion !== "number")
    throw new Error("Not a Folevi library.");
  return { encryption: null, v: 1, ...m } as CloudLibraryManifest;
}

export class CloudLibrary {
  constructor(
    private readonly connections: CloudConnections,
    private readonly newLibraryId: () => string = () => newLibraryUlid(),
    private readonly now: () => number = Date.now,
  ) {}

  /** The provider's files, or null when no connection is set up. */
  fs(): CloudFs | null {
    return this.connections.fs;
  }

  private need(): CloudFs {
    const fs = this.connections.fs;
    if (!fs) throw Object.assign(new Error("No Dropbox or Google Drive connection is set up."), { code: "not_set_up" });
    return fs;
  }

  /** The library in the provider's Folevi folder: the one already there, or a new one. */
  async prepare(): Promise<CloudLibraryManifest> {
    const fs = this.need();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fs.read(LIBRARY_FILE);
        if ("bytes" in r) return decodeManifest(r.bytes);
      } catch (error) {
        if ((error as { code?: string })?.code !== "not_found") throw error;
      }
      const m: CloudLibraryManifest = { format: "folevi-library", v: 1, libraryId: this.newLibraryId(), createdAt: this.now(), minWriterVersion: 1, encryption: null };
      const w = await fs.write(LIBRARY_FILE, new TextEncoder().encode(`${JSON.stringify(m, null, 2)}\n`), { ifMatch: null });
      if (!("mismatch" in w)) return m;
      // Another device made it a moment ago: read theirs.
    }
    throw Object.assign(new Error("The library file in the cloud can't be read yet."), { code: "unreadable" });
  }

  async info(): Promise<CloudLibraryInfo | null> {
    const s = this.connections.status();
    if (!s.provider) return null;
    let manifest: CloudLibraryManifest | null = null;
    try {
      const r = await this.need().read(LIBRARY_FILE);
      if ("bytes" in r) manifest = decodeManifest(r.bytes);
    } catch {
      manifest = null;
    }
    return {
      kind: s.provider,
      displayPath: DISPLAY_PATHS[s.provider],
      available: s.state === "connected" && !!manifest,
      libraryId: manifest?.libraryId ?? null,
      encrypted: !!manifest?.encryption,
    };
  }

  /** Change batches for `shell.library.watch` ("library:changes"). */
  watch(cb: (changes: { path: string; kind: "changed" | "removed" }[]) => void): () => void {
    return this.connections.watch((changes: CloudChange[]) => cb(changes.map((c) => ({ path: c.path, kind: c.kind }))));
  }

  /** Copies every file to the Mac (after connecting, and before signing out). Returns how many are here. */
  async downloadAll(onProgress?: (done: number, total: number) => void): Promise<number> {
    const fs = this.need();
    const entries = await fs.list("");
    let done = 0;
    for (const e of entries) {
      await fs.startDownload([e.path]);
      done++;
      onProgress?.(done, entries.length);
    }
    return done;
  }
}
