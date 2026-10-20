// From "Keep notes on my devices" to a Folevi account (docs/LOCAL_MODE_PLAN.md §6.1). Runs in the signed-in
// app with the library open beside the account: its notes go up through the account's own functions (folders
// with their ids, notes and blocks through the SyncEngine with their ULIDs, attachments uploaded first, found
// text, history through documents.importSnapshot), the Inbox becomes the account's Inbox and the library's
// profile the account's. What's done is kept in the library's copy on this device, so it goes on after a stop.
// When it's done the library's folder says where it went (`migratedTo` in folevi-library.json) and is
// otherwise left as it was.
import { LIBRARY_FILE, decodeManifest, encodeManifest, type LocalFs } from "@folevi/local-store";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import type { LocalBackend } from "@/lib/local/backend";
import { blockFiles, coverFile } from "./remap";
import { copyLibrary } from "./copy";
import { libraryProgress, progressKey } from "./progress";
import { clientSource, libraryFiles } from "./source";
import { accountUpload, clientTarget, engineWriter, type EngineLike } from "./target";
import type { MigrationClient, MigrationProgress, MigrationState, SourceFile } from "./types";

/** What a library holds, for the account's preflight (migration.preflight). */
export interface LibraryCounts {
  notes: number;
  folders: number;
  tags: number;
  files: number;
  fileBytes: number;
  largestFileBytes: number;
  versions: number;
  /** Notes whose files haven't reached this device yet (they can't go up until they have). */
  downloading: number;
}

export type Preflight = FunctionReturnType<typeof api.migration.preflight>;

/** Counts what the library would send: its notes, folders, tags, the files its notes show, and their history. */
export async function libraryCounts(backend: Pick<LocalBackend, "store">): Promise<LibraryCounts> {
  const store = backend.store;
  const docs = await store.list("documents");
  const live = docs.filter((d) => !d.pending);
  const shown = new Set<string>();
  let versions = 0;
  for (const d of live) {
    for (const b of await store.list("blocks", d.id)) {
      if (b.deletedAt !== null) continue;
      for (const f of blockFiles(b)) shown.add(f.fileId);
    }
    const cover = coverFile(d.cover);
    if (cover) shown.add(cover);
    versions += (await store.list("versions", d.id)).length;
  }
  let fileBytes = 0;
  let largest = 0;
  let files = 0;
  for (const id of shown) {
    const f = await store.get("files", id);
    if (!f) continue;
    files++;
    fileBytes += f.size;
    largest = Math.max(largest, f.size);
  }
  return {
    notes: live.length,
    folders: (await store.list("folders")).filter((f) => !f.deletedAt).length,
    tags: (await store.list("tags")).length,
    files,
    fileBytes,
    largestFileBytes: largest,
    versions,
    downloading: docs.length - live.length,
  };
}

/** Asks the account whether the library fits (counts and storage against the plan; never a price). */
export async function preflightUpload(account: MigrationClient, counts: LibraryCounts): Promise<Preflight> {
  const { downloading: _downloading, ...args } = counts;
  return await account.query(api.migration.preflight, args);
}

export interface UploadOptions {
  /** The library, open in a LocalBackend in this window, and a client over it. */
  library: { client: MigrationClient; backend: Pick<LocalBackend, "store" | "run"> };
  /** The signed-in account's client. */
  account: MigrationClient;
  /** This device's id (sync.push names it). */
  deviceId: string;
  /** The account's SyncEngine: notes and blocks go through it. Without one, straight through sync.push. */
  engine?: EngineLike | null;
  /** Stores an attachment in the account (default: the app's upload, files.generateUploadUrl and finalize). */
  putFile?: (file: SourceFile, documentId: string) => Promise<string>;
  /** Bring history along (default true). */
  versions?: boolean;
  onProgress?: (p: MigrationProgress) => void;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Copies the library into the account (or goes on with a copy that stopped). */
export async function uploadLibrary(o: UploadOptions): Promise<MigrationState> {
  const source = clientSource(o.library.client, { readFile: libraryFiles(o.library.backend.store) });
  const target = clientTarget(o.account, {
    deviceId: o.deviceId,
    putFile: o.putFile ?? accountUpload(o.account),
    ...(o.engine ? { notes: engineWriter(o.engine, o.account, o.deviceId) } : {}),
  });
  return await copyLibrary({
    source,
    target,
    progress: libraryProgress(o.library.backend, progressKey("upload")),
    direction: "upload",
    versions: o.versions ?? true,
    mapInbox: true,
    onProgress: o.onProgress,
    signal: o.signal,
    sleep: o.sleep,
  });
}

/** The move's record so far, if one was started (the interface shows it, and goes on from it). */
export async function uploadState(backend: Pick<LocalBackend, "store" | "run">): Promise<MigrationState | null> {
  return await libraryProgress(backend, progressKey("upload")).load();
}

/** Forgets a finished or abandoned move's record (a later move starts afresh). */
export async function forgetUpload(backend: Pick<LocalBackend, "store" | "run">): Promise<void> {
  await backend.run((ctx) => ctx.db.remove("meta", progressKey("upload")));
}

/**
 * Writes `migratedTo` (the account's profile id) into the library's folevi-library.json and leaves everything
 * else in the folder as it was (plan §6.1 step 7). A manifest that changed meanwhile is read again.
 */
export async function markMigrated(fs: Pick<LocalFs, "read" | "write">, accountProfileId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fs.read(LIBRARY_FILE);
    if (!("bytes" in r)) throw new Error("The library's folder isn't on this device yet.");
    const manifest = decodeManifest(r.bytes);
    if (manifest.migratedTo === accountProfileId) return;
    const w = await fs.write(LIBRARY_FILE, encodeManifest({ ...manifest, migratedTo: accountProfileId }), { ifMatch: r.etag });
    if (!("mismatch" in w)) return;
  }
  throw new Error("The library's folder kept changing. Try again in a moment.");
}

/** The account a library was moved to, or null. */
export async function migratedTo(fs: Pick<LocalFs, "read">): Promise<string | null> {
  try {
    const r = await fs.read(LIBRARY_FILE);
    return "bytes" in r ? (decodeManifest(r.bytes).migratedTo ?? null) : null;
  } catch {
    return null;
  }
}
