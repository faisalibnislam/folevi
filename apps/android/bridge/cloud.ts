// Folevi for Android: a library on Dropbox or Google Drive, run in the app's bridge (folevi-bridge.js) with the
// shared provider code (packages/cloud-folders, the same DropboxFs and DriveFs the Mac runs). Built by
// scripts/bundle-bridge.mjs into assets/folevi-cloud.js and handed to the bridge, never put on `window`.
//
// What this side does and what the app's Kotlin side does:
// - every request to the provider goes through FoleviCloud.request: Kotlin allows only the provider's API hosts
//   and adds the token (CloudAuth.kt), so the page never holds one;
// - the library's copy on the phone (the mirror) is kept by Kotlin (FoleviLibrary mirror* calls, MirrorStore.kt),
//   which also serves its attachments at /_files;
// - this side lists, downloads, uploads, merges the change feed and watches, exactly as on the Mac.
import {
  CloudError,
  DropboxFs,
  DriveFs,
  RetryingHttp,
  driveClassifier,
  type ApiHttp,
  type CloudFs,
  type CloudProvider,
  type HttpFetch,
  type LocalFsEntry,
  type MirrorFile,
  type MirrorStore,
  type ReadResult,
  type WriteResult,
} from "../../../packages/cloud-folders/src/index";

export type Call = (plugin: string, method: string, args?: Record<string, unknown>) => Promise<any>;

export interface Bytes {
  toBase64(b: Uint8Array): string;
  fromBase64(s: string): Uint8Array;
}

/** A library file layer, as the bridge sees both kinds (the phone's folder through Kotlin, or a provider here). */
export interface Files {
  list(dir: string): Promise<LocalFsEntry[]>;
  read(path: string): Promise<ReadResult>;
  write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult>;
  remove(path: string, o?: { ifMatch?: string }): Promise<void>;
}

export const LIBRARY_FILE = "folevi-library.json";
export const KIND_PROVIDER = { dropbox: "dropbox", gdrive: "googleDrive" } as const;
export type CloudKind = keyof typeof KIND_PROVIDER;
export const isCloudKind = (k: unknown): k is CloudKind => k === "dropbox" || k === "gdrive";
export const DISPLAY = { dropbox: "Dropbox › Apps › Folevi", googleDrive: "Google Drive › Folevi" } as const;

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function abortError(): Error {
  return typeof DOMException === "function" ? new DOMException("The operation was aborted.", "AbortError") : Object.assign(new Error("aborted"), { name: "AbortError" });
}

async function bodyBytes(body: unknown): Promise<Uint8Array | null> {
  if (body == null) return null;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  throw new TypeError("Folevi's cloud bridge only sends text and bytes.");
}

/** `fetch` for the provider code, through the app (authorized: Kotlin adds the provider's token). */
export function nativeFetch(call: Call, bytes: Bytes, provider: CloudProvider, authorized: boolean): HttpFetch {
  return async (input, init = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = await bodyBytes(init.body);
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    const sent = call("FoleviCloud", "request", {
      provider,
      url: String(input),
      method: (init.method ?? "GET").toUpperCase(),
      headers,
      body: body ? bytes.toBase64(body) : null,
      authorized,
    });
    let r: { status: number; headers: Record<string, string>; body: string };
    try {
      r = signal
        ? await new Promise((resolve, reject) => {
            const onAbort = () => reject(abortError());
            signal.addEventListener("abort", onAbort, { once: true });
            sent.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
          })
        : await sent;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if ((e as { name?: string })?.name === "AbortError") throw e;
      if (code === "reconnect") throw new CloudError("reconnect", (e as Error).message);
      // No network: RetryingHttp retries, then reports "offline".
      throw new TypeError(`Failed to fetch: ${(e as Error)?.message ?? "offline"}`);
    }
    const status = r.status >= 200 && r.status <= 599 ? r.status : 502;
    const data = NULL_BODY.has(status) ? null : bytes.fromBase64(r.body ?? "");
    return new Response(data as BodyInit | null, { status, headers: r.headers });
  };
}

/** The library's copy on the phone, kept by Kotlin (MirrorStore.kt). */
export function nativeMirror(call: Call, bytes: Bytes, provider: CloudProvider): MirrorStore {
  const lib = (method: string, args: Record<string, unknown> = {}) => call("FoleviLibrary", method, { provider, ...args });
  return {
    async readFile(path): Promise<MirrorFile | null> {
      const r = await lib("mirrorRead", { path });
      return r.missing ? null : { bytes: bytes.fromBase64(r.data), etag: r.etag };
    },
    async writeFile(path, b, etag) {
      await lib("mirrorWrite", { path, data: bytes.toBase64(b), etag });
    },
    async deleteFile(path) {
      await lib("mirrorDelete", { path });
    },
    async paths() {
      return (await lib("mirrorPaths")).paths ?? [];
    },
    async loadState() {
      const s = (await lib("mirrorLoadState")).state;
      return typeof s === "string" ? JSON.parse(s) : null;
    },
    async saveState(state) {
      await lib("mirrorSaveState", { state: JSON.stringify(state) });
    },
  };
}

function newLibraryId(now = Date.now()): string {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = A[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const r = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (const b of r) rand += A[b % 32];
  return time + rand;
}

function decodeManifest(b: Uint8Array): { libraryId: string; encryption: unknown } {
  const m = JSON.parse(new TextDecoder().decode(b)) as { format?: string; libraryId?: unknown; encryption?: unknown };
  if (!m || m.format !== "folevi-library" || typeof m.libraryId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(m.libraryId)) throw new Error("Not a Folevi library.");
  return { libraryId: m.libraryId, encryption: m.encryption ?? null };
}

/** Reads the library file there, or makes one (another device's library is joined, never replaced). */
export async function prepareLibrary(fs: Files): Promise<{ libraryId: string; encrypted: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fs.read(LIBRARY_FILE);
      if ("bytes" in r) {
        const m = decodeManifest(r.bytes);
        return { libraryId: m.libraryId, encrypted: !!m.encryption };
      }
    } catch (e) {
      if ((e as { code?: string })?.code !== "not_found") throw e;
    }
    const m = { format: "folevi-library", v: 1, libraryId: newLibraryId(), createdAt: Date.now(), minWriterVersion: 1, encryption: null };
    const w = await fs.write(LIBRARY_FILE, new TextEncoder().encode(`${JSON.stringify(m, null, 2)}\n`), { ifMatch: null });
    if (!("mismatch" in w)) return { libraryId: m.libraryId, encrypted: false };
  }
  throw Object.assign(new Error("The library file in the cloud can't be read yet."), { code: "unreadable" });
}

/** Copies every file of one library layer into another (a move), then the library file last. */
export async function copyLibrary(from: Files, to: Files, onProgress?: (done: number, total: number) => void): Promise<number> {
  const entries = (await from.list("")).filter((e) => e.path !== LIBRARY_FILE);
  let done = 0;
  for (const e of [...entries, { path: LIBRARY_FILE } as LocalFsEntry]) {
    let r: ReadResult;
    try {
      r = await from.read(e.path);
    } catch (err) {
      if ((err as { code?: string })?.code === "not_found") continue;
      throw err;
    }
    if (!("bytes" in r)) continue;
    // Never over a file that's already there (another device's library is merged by local-store, not replaced).
    await to.write(e.path, r.bytes, { ifMatch: null });
    done++;
    onProgress?.(done, entries.length + 1);
  }
  return done;
}

export interface CloudKit {
  fs(kind: CloudKind): Promise<CloudFs>;
  prepare(kind: CloudKind): Promise<{ libraryId: string; encrypted: boolean }>;
  /** What `library.info()` says for a cloud library. */
  info(kind: CloudKind): Promise<{ kind: CloudKind; displayPath: string; available: boolean; encrypted: boolean; locked: boolean; configured: true }>;
  watch(kind: CloudKind, cb: (changes: { path: string; kind: "changed" | "removed" }[]) => void): () => void;
  /** Forgets the provider layers (after signing out). */
  reset(): void;
}

export function createCloudKit(call: Call, bytes: Bytes, log: (m: string) => void = () => undefined): CloudKit {
  const layers = new Map<CloudProvider, Promise<CloudFs>>();

  function build(provider: CloudProvider): Promise<CloudFs> {
    const http = new RetryingHttp(nativeFetch(call, bytes, provider, true), {}, provider === "googleDrive" ? driveClassifier : undefined);
    const api: ApiHttp = {
      async send(url, init) {
        const res = await http.send(url, init);
        if (res.status === 401) throw new CloudError("reconnect", `${provider === "dropbox" ? "Dropbox" : "Google Drive"} needs to be connected again.`, 401);
        return res;
      },
    };
    const mirror = nativeMirror(call, bytes, provider);
    const fs: CloudFs =
      provider === "dropbox" ? new DropboxFs(api, new RetryingHttp(nativeFetch(call, bytes, provider, false)), mirror, { log }) : new DriveFs(api, mirror, { log });
    return fs.open().then(() => fs);
  }

  const fsOf = (kind: CloudKind) => {
    const p = KIND_PROVIDER[kind];
    let f = layers.get(p);
    if (!f) {
      f = build(p);
      f.catch(() => layers.delete(p));
      layers.set(p, f);
    }
    return f;
  };

  return {
    fs: fsOf,
    async prepare(kind) {
      return prepareLibrary(await fsOf(kind));
    },
    async info(kind) {
      const p = KIND_PROVIDER[kind];
      const status = (await call("FoleviCloud", "status").catch(() => null)) as { provider: string | null; state: string } | null;
      const here = status?.provider === p;
      let manifest: { libraryId: string; encryption: unknown } | null = null;
      if (here) {
        try {
          const r = await (await fsOf(kind)).read(LIBRARY_FILE);
          if ("bytes" in r) manifest = decodeManifest(r.bytes);
        } catch {
          manifest = null;
        }
      }
      const encrypted = !!manifest?.encryption;
      return { kind, displayPath: here ? DISPLAY[p] : p === "dropbox" ? "Dropbox" : "Google Drive", available: here && status?.state !== "reconnect" && !!manifest, encrypted, locked: encrypted, configured: true };
    },
    watch(kind, cb) {
      let handle: { stop(): void } | null = null;
      let stopped = false;
      void fsOf(kind).then(
        (fs) => {
          if (stopped) return;
          handle = fs.watch(
            (changes) => cb(changes.map((c) => ({ path: c.path, kind: c.kind }))),
            (e) => log(`Watching the cloud library: ${(e as Error)?.message ?? e}`),
          );
        },
        () => undefined,
      );
      return () => {
        stopped = true;
        handle?.stop();
      };
    },
    reset() {
      layers.clear();
    },
  };
}
