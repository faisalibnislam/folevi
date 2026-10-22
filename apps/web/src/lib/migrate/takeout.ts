// Takeout (docs/MULTI_ACCOUNT_PLAN.md §8): one file with everything an account has (notes, files, history,
// folders, tags), that a library or another account can import. It's a library folder in a zip, written by the
// same code a library on a Mac or a phone is (packages/local-store, lib/local/store), never encrypted, with
// `folevi-takeout.json` at the top and `exported/server-only.json` (comments, sharing, workspace members), so it
// can also be opened as a library as it is.
//
// Making one: a library in memory, the account copied into it (Personal, and the workspaces the person manages as
// folders of their own, with history), the library's files zipped. Importing one: the zip unpacked into memory,
// opened as a library, and copied into this place with new ids, inside a folder named after it, so importing the
// same file twice gives two copies and never a mix.
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from "fflate";
import { MemoryFs, type LocalFs } from "@folevi/local-store";
import { ulid } from "@folevi/editor-schema";
import { LocalBackend } from "@/lib/local/backend";
import { LocalClient } from "@/lib/local/client";
import { LibraryStore, MemoryLibraryHost, MemoryReplicaDb } from "@/lib/local/store/index";
import { api } from "@/lib/convex/api";
import { copyLibrary } from "./copy";
import { serverOnlyRecord, workspaceFolderId, writeServerOnly, type ExportableWorkspace } from "./exportToLocal";
import { memoryProgress } from "./progress";
import { freshSource, newMoveKey } from "./reshape";
import { accountFiles, clientSource, libraryFiles } from "./source";
import { clientTarget, libraryPutFile } from "./target";
import type { MigrationClient, MigrationProgress, MigrationState, MigrationTarget } from "./types";

export const TAKEOUT_FILE = "folevi-takeout.json";
export const TAKEOUT_FORMAT = "folevi-takeout";
/** The most a takeout may hold, attachments included: about what a page can keep in memory. */
export const TAKEOUT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface TakeoutManifest {
  format: typeof TAKEOUT_FORMAT;
  v: 1;
  createdAt: string;
  account: { name: string; email: string };
  /** What's inside: Personal, and these workspaces as folders of their own. */
  places: { name: string; folderId: string | null }[];
  notes: number;
  app: string;
}

/** A library held in memory: its folder, and a client over it as the app has one. */
export interface MemoryLibrary {
  fs: LocalFs & { list: MemoryFs["list"] };
  client: LocalClient;
  backend: LocalBackend;
  store: LibraryStore;
  deviceId: string;
  /** Writes every note and the index into the folder. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Opens a library in memory: on `fs` (a takeout unpacked), or a new one set up for `displayName`. */
export async function openMemoryLibrary(o: { fs?: MemoryFs; displayName?: string; timeZone?: string } = {}): Promise<MemoryLibrary> {
  const fs = o.fs ?? new MemoryFs();
  const host = new MemoryLibraryHost({ fs });
  const deviceId = `takeout_${ulid()}`;
  const run = ulid();
  const store = await LibraryStore.open({
    host,
    deviceId,
    openDb: async (libraryId) => MemoryReplicaDb.open(`takeout:${run}:${libraryId}`),
    page: null,
    scanMs: 0,
    libraryIds: { recall: () => null, remember: () => {} },
  });
  const backend = new LocalBackend(store, { deviceId });
  const client = new LocalClient(backend);
  // A folder that came in a takeout: read it all now (a library reads its folder in the background).
  if (o.fs) await store.library.syncNow();
  const me = (await client.query(api.users.me, {})) as { state: string };
  if (me.state !== "ready") {
    if (o.fs) throw new Error("This file isn't a Folevi takeout (it has no library in it).");
    await client.local.setup({ timeZone: o.timeZone ?? "UTC", locale: "en", displayName: o.displayName ?? "Takeout", seed: false });
  }
  return {
    fs: fs as MemoryLibrary["fs"],
    client,
    backend,
    store,
    deviceId,
    flush: () => store.library.flush(),
    async close() {
      await client.close();
      await backend.close();
    },
  };
}

/** The library's files in a zip (attachments stored as they are; everything else compressed). */
export async function zipLibrary(fs: Pick<MemoryFs, "list" | "read">, extra: Record<string, Uint8Array> = {}): Promise<Uint8Array> {
  const files: Zippable = {};
  let total = 0;
  for (const e of await fs.list("")) {
    if (e.path.startsWith(".folevi-tmp/")) continue;
    const r = await fs.read(e.path);
    if (!("bytes" in r)) continue;
    total += r.bytes.byteLength;
    if (total > TAKEOUT_MAX_BYTES) throw new TakeoutError("too_large", "This account holds more than a takeout file can (about 2 GB). Use Settings > Export instead, which Folevi prepares for you.");
    files[e.path] = e.path.startsWith("files/") ? [r.bytes, { level: 0 }] : r.bytes;
  }
  for (const [path, bytes] of Object.entries(extra)) files[path] = bytes;
  return zipSync(files, { level: 6 });
}

export class TakeoutError extends Error {
  constructor(
    readonly code: "too_large" | "not_takeout" | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "TakeoutError";
  }
}

export interface MakeTakeoutOptions {
  account: MigrationClient;
  /** Who it is, for the file's own description. */
  who: { name: string; email: string };
  workspaces?: ExportableWorkspace[];
  versions?: boolean;
  fetchBytes?: (url: string) => Promise<Blob>;
  onProgress?: (p: MigrationProgress & { place: string }) => void;
  signal?: AbortSignal;
  now?: () => number;
  appVersion?: string;
}

/** Makes the takeout file: the account (Personal and the workspaces given) as a library in a zip. */
export async function makeTakeout(o: MakeTakeoutOptions): Promise<{ bytes: Uint8Array; manifest: TakeoutManifest; states: MigrationState[] }> {
  const now = o.now ?? Date.now;
  const lib = await openMemoryLibrary({ displayName: o.who.name || o.who.email });
  try {
    const readFile = accountFiles(o.account, o.fetchBytes);
    const target = clientTarget(lib.client, { deviceId: lib.deviceId, putFile: libraryPutFile(lib.client.local) });
    const states: MigrationState[] = [];
    const places = [{ name: "Personal", folderId: null as string | null }];
    states.push(
      await copyLibrary({ source: clientSource(o.account, { readFile }), target, progress: memoryProgress(), direction: "export", versions: o.versions ?? true, mapInbox: true, onProgress: (p) => o.onProgress?.({ ...p, place: "Personal" }), signal: o.signal, now, sleep: noWait }),
    );
    for (const w of o.workspaces ?? []) {
      const folder = { id: workspaceFolderId(w.id), name: w.name };
      places.push({ name: w.name, folderId: folder.id });
      states.push(
        await copyLibrary({
          source: clientSource(o.account, { scope: { kind: "workspace", workspaceId: w.id }, readFile }),
          target,
          progress: memoryProgress(),
          direction: "export",
          versions: o.versions ?? true,
          mapInbox: false,
          intoFolder: folder,
          onProgress: (p) => o.onProgress?.({ ...p, place: w.name }),
          signal: o.signal,
          now,
          sleep: noWait,
        }),
      );
    }
    await writeServerOnly(lib.fs, await serverOnlyRecord(o.account, o.workspaces ?? [], now()));
    await lib.flush();
    const manifest: TakeoutManifest = {
      format: TAKEOUT_FORMAT,
      v: 1,
      createdAt: new Date(now()).toISOString(),
      account: { name: o.who.name, email: o.who.email },
      places,
      notes: states.reduce((n, s) => n + Object.keys(s.notes).length, 0),
      app: o.appVersion ?? "web",
    };
    const bytes = await zipLibrary(lib.fs, { [TAKEOUT_FILE]: strToU8(`${JSON.stringify(manifest, null, 2)}\n`) });
    return { bytes, manifest, states };
  } finally {
    await lib.close();
  }
}

/** Waits out a rate limit at once in memory; the account side's own waits still apply through copy.ts. */
const noWait = async (ms: number, signal?: AbortSignal) => {
  if (signal?.aborted) throw new TakeoutError("cancelled", "The takeout was stopped.");
  await new Promise((r) => setTimeout(r, Math.min(ms, 60_000)));
};

/** A takeout file's library, unpacked into memory and opened, with what the file says of itself. */
export async function readTakeout(zip: Uint8Array): Promise<{ library: MemoryLibrary; manifest: TakeoutManifest | null }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new TakeoutError("not_takeout", "This file isn't a Folevi takeout (it isn't a zip Folevi can read).");
  }
  let manifest: TakeoutManifest | null = null;
  const fs = new MemoryFs();
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    if (path === TAKEOUT_FILE) {
      try {
        const parsed = JSON.parse(strFromU8(bytes)) as TakeoutManifest;
        if (parsed.format === TAKEOUT_FORMAT) manifest = parsed;
      } catch {
        /* a takeout without its description still imports */
      }
      continue;
    }
    // Only the library's own layout comes in; anything else in the zip is ignored.
    if (path.includes("..") || path.startsWith("/") || /[\u0000-\u001f\\]/.test(path)) continue;
    await fs.write(path, bytes, {});
  }
  if (!files["folevi-library.json"]) throw new TakeoutError("not_takeout", "This file isn't a Folevi takeout (it has no library in it).");
  return { library: await openMemoryLibrary({ fs }), manifest };
}

/** "Takeout from ana@example.com, 22 Oct 2026": the folder an import goes into. */
export function takeoutFolderName(manifest: TakeoutManifest | null, now = Date.now()): string {
  const when = new Date(manifest?.createdAt ?? now).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const who = manifest?.account.email || manifest?.account.name;
  return who ? `Takeout from ${who}, ${when}` : `Takeout, ${when}`;
}

export interface ImportTakeoutOptions {
  zip: Uint8Array;
  /** Where it goes: this place's client, and how attachments are stored there. */
  target: MigrationTarget;
  versions?: boolean;
  onProgress?: (p: MigrationProgress) => void;
  signal?: AbortSignal;
  now?: () => number;
}

/** Imports a takeout file into this place, with new ids, inside a folder of its own. */
export async function importTakeout(o: ImportTakeoutOptions): Promise<{ state: MigrationState; manifest: TakeoutManifest | null; folder: { id: string; name: string } }> {
  const { library, manifest } = await readTakeout(o.zip);
  try {
    const key = newMoveKey();
    // The takeout's Inbox comes as a page of its own in the folder, like every other note: new id too.
    const source = freshSource(clientSource(library.client, { readFile: libraryFiles(library.store) }), key, { keepInbox: false });
    const folder = { id: ulid(), name: takeoutFolderName(manifest, o.now?.()) };
    const state = await copyLibrary({ source, target: o.target, progress: memoryProgress(), direction: "upload", versions: o.versions ?? true, mapInbox: false, intoFolder: folder, onProgress: o.onProgress, signal: o.signal, now: o.now });
    return { state, manifest, folder };
  } finally {
    await library.close();
  }
}
