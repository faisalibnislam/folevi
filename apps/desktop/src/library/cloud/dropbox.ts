// The library in Folevi's Dropbox app folder (Apps/Folevi), over the Dropbox HTTP API v2. Platform neutral.
//
// - Change detection: `files/list_folder` (recursive, from the app folder's root) once, then
//   `list_folder/continue` with the stored cursor; `list_folder/longpoll` waits for changes cheaply.
// - Etags are Dropbox `rev`s. `ifMatch: <rev>` uploads in `update` mode with `strict_conflict`, which Dropbox
//   applies atomically: a concurrent change (or a delete) is a conflict, never an overwrite. `ifMatch: null`
//   uploads in `add` mode (strict: an existing file, even an identical one, is a conflict). No autorename, so
//   the API never makes "conflicted copy" files (Dropbox's desktop client still can, and local-store merges
//   those by name).
// - Files above `singleUploadMax` go up in an upload session, resuming at Dropbox's `correct_offset` when a
//   chunk was cut off.
// - `files/delete_v2` with `parent_rev` for conditional removes.
// - 429 and 503 wait for Retry-After; other 5xx back off (http.ts).
import { abortable, CloudFs, protocolError, type CloudFsOptions, type RemoteEntry } from "./cloudFs";
import { bodyOf, bytesOf, jsonOf, type RetryingHttp } from "./http";
import type { MirrorStore } from "./mirror";
import type { AuthedHttp } from "./oauth";
import { CloudError, isValidLibraryPath, LocalFsError, notFound, type CloudChange } from "./types";

export const DROPBOX_API = "https://api.dropboxapi.com/2";
export const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";
export const DROPBOX_NOTIFY = "https://notify.dropboxapi.com/2";

export interface DropboxEntry extends RemoteEntry {
  /** Dropbox paths are case-insensitive: the key Dropbox reports deletes under. */
  lower: string;
}

interface DropboxMetadata {
  ".tag"?: "file" | "folder" | "deleted";
  name?: string;
  path_display?: string;
  path_lower?: string;
  rev?: string;
  size?: number;
  server_modified?: string;
}

interface DropboxErrorBody {
  error_summary?: string;
  error?: unknown;
}

export interface DropboxFsOptions extends CloudFsOptions {
  /** Above this, uploads use an upload session (Dropbox's single upload limit is 150 MB). */
  singleUploadMax?: number;
  /** Upload session chunk size (Dropbox wants multiples of 4 MiB for best results). */
  chunkSize?: number;
  /** Longpoll timeout in seconds (Dropbox allows 30 to 480). */
  longpollSeconds?: number;
}

/** Dropbox-API-Arg is an HTTP header: JSON with everything outside ASCII escaped. */
export function apiArg(arg: unknown): string {
  return JSON.stringify(arg).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const REV = /^[0-9A-Za-z]{1,64}$/;

export class DropboxFs extends CloudFs<DropboxEntry> {
  readonly provider = "dropbox" as const;
  private cursor: string | null = null;
  private readonly singleUploadMax: number;
  private readonly chunkSize: number;
  private readonly longpollSeconds: number;

  constructor(
    private readonly api: AuthedHttp,
    /** Unauthenticated requests (the longpoll endpoint refuses an Authorization header). */
    private readonly plain: RetryingHttp,
    mirror: MirrorStore,
    options: DropboxFsOptions = {},
  ) {
    super(mirror, options);
    this.singleUploadMax = options.singleUploadMax ?? 8 * 1024 * 1024;
    this.chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
    this.longpollSeconds = options.longpollSeconds ?? 120;
  }

  // ---------------------------------------------------------------- requests

  private async rpc<T>(route: string, arg: unknown): Promise<{ ok: true; body: T } | { ok: false; status: number; summary: string; body: DropboxErrorBody | null }> {
    const res = await this.api.send(`${DROPBOX_API}/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(arg) });
    if (res.ok) return { ok: true, body: (await jsonOf<T>(res)) as T };
    return this.failure(res, route);
  }

  private async failure(res: Response, route: string): Promise<{ ok: false; status: number; summary: string; body: DropboxErrorBody | null }> {
    const body = await jsonOf<DropboxErrorBody>(res);
    const summary = body?.error_summary ?? "";
    if (res.status === 409 && /insufficient_space/.test(summary)) throw new CloudError("quota", "Your Dropbox is full.", 409);
    if (res.status !== 409) throw protocolError(`Dropbox ${route} answered HTTP ${res.status}${summary ? ` (${summary})` : ""}.`, res.status);
    return { ok: false, status: res.status, summary, body };
  }

  private static libraryPath(meta: DropboxMetadata): string | null {
    const display = meta.path_display ?? "";
    const path = display.startsWith("/") ? display.slice(1) : display;
    return isValidLibraryPath(path) ? path : null;
  }

  private toEntry(meta: DropboxMetadata, path?: string): DropboxEntry {
    const p = path ?? DropboxFs.libraryPath(meta);
    if (!p || !meta.rev) throw protocolError("Dropbox sent a file without a path or rev.");
    return { path: p, lower: (meta.path_lower ?? `/${p}`.toLowerCase()).slice(1), etag: meta.rev, size: meta.size ?? 0, mtimeMs: Date.parse(meta.server_modified ?? "") || 0 };
  }

  // ---------------------------------------------------------------- change feed

  protected async pullChanges(): Promise<CloudChange[]> {
    if (!this.cursor) return this.fullListing();
    const changes: CloudChange[] = [];
    let cursor = this.cursor;
    for (;;) {
      const r = await this.rpc<{ entries: DropboxMetadata[]; cursor: string; has_more: boolean }>("files/list_folder/continue", { cursor });
      if (!r.ok) {
        if (/^reset/.test(r.summary)) {
          this.log("Dropbox reset the change cursor: listing everything again.");
          this.cursor = null;
          return this.fullListing();
        }
        throw protocolError(`Dropbox list_folder/continue: ${r.summary}`);
      }
      for (const meta of r.body.entries) this.apply(meta, changes);
      cursor = r.body.cursor;
      if (!r.body.has_more) break;
    }
    this.cursor = cursor;
    return changes;
  }

  private async fullListing(): Promise<CloudChange[]> {
    const seen = new Map<string, DropboxEntry>();
    let r = await this.rpc<{ entries: DropboxMetadata[]; cursor: string; has_more: boolean }>("files/list_folder", { path: "", recursive: true, include_deleted: false, limit: 2000 });
    for (;;) {
      if (!r.ok) throw protocolError(`Dropbox list_folder: ${r.summary}`);
      for (const meta of r.body.entries) {
        if (meta[".tag"] !== "file") continue;
        const path = DropboxFs.libraryPath(meta);
        if (path) seen.set(path, this.toEntry(meta, path));
      }
      if (!r.body.has_more) break;
      r = await this.rpc("files/list_folder/continue", { cursor: r.body.cursor });
    }
    const changes: CloudChange[] = [];
    for (const [path, e] of seen) if (this.entries.get(path)?.etag !== e.etag) changes.push({ path, kind: "changed" });
    for (const path of this.entries.keys()) if (!seen.has(path)) changes.push({ path, kind: "removed" });
    this.entries.clear();
    for (const [path, e] of seen) this.entries.set(path, e);
    this.cursor = r.body.cursor;
    return changes;
  }

  private apply(meta: DropboxMetadata, changes: CloudChange[]): void {
    if (meta[".tag"] === "deleted") {
      // A deleted file, or a deleted folder with everything in it.
      const lower = (meta.path_lower ?? "").replace(/^\//, "");
      for (const [path, e] of [...this.entries])
        if (e.lower === lower || e.lower.startsWith(`${lower}/`)) {
          this.entries.delete(path);
          changes.push({ path, kind: "removed" });
        }
      return;
    }
    if (meta[".tag"] !== "file") return;
    const path = DropboxFs.libraryPath(meta);
    if (!path) return;
    const next = this.toEntry(meta, path);
    // The same file under different casing: one entry, keyed by Dropbox's lower-case path.
    for (const [p, e] of this.entries) if (e.lower === next.lower && p !== path) this.entries.delete(p);
    if (this.entries.get(path)?.etag !== next.etag) changes.push({ path, kind: "changed" });
    this.entries.set(path, next);
  }

  protected async waitForChanges(signal: AbortSignal): Promise<void> {
    if (!this.cursor) return;
    let res: Response;
    try {
      res = await this.plain.send(`${DROPBOX_NOTIFY}/files/list_folder/longpoll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cursor: this.cursor, timeout: this.longpollSeconds }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    const body = await jsonOf<{ changes?: boolean; backoff?: number; error_summary?: string }>(res);
    if (res.status === 409 && /^reset/.test(body?.error_summary ?? "")) {
      this.cursor = null;
      return;
    }
    if (!res.ok) throw protocolError(`Dropbox longpoll answered HTTP ${res.status}.`, res.status);
    if (body?.backoff) await abortable(signal, this.sleep, body.backoff * 1000);
  }

  // ---------------------------------------------------------------- files

  private async metadata(path: string): Promise<DropboxEntry | null> {
    const r = await this.rpc<DropboxMetadata>("files/get_metadata", { path: `/${path}` });
    if (r.ok) return r.body[".tag"] === "file" ? this.toEntry(r.body, path) : null;
    if (/not_found/.test(r.summary)) return null;
    throw protocolError(`Dropbox get_metadata: ${r.summary}`);
  }

  protected async download(path: string): Promise<{ bytes: Uint8Array; etag: string; entry: DropboxEntry }> {
    const res = await this.api.send(`${DROPBOX_CONTENT}/files/download`, { method: "POST", headers: { "dropbox-api-arg": apiArg({ path: `/${path}` }) } });
    if (!res.ok) {
      const r = await this.failure(res, "files/download");
      if (/not_found|not_file/.test(r.summary)) throw notFound(path);
      throw protocolError(`Dropbox download: ${r.summary}`);
    }
    const meta = JSON.parse(res.headers.get("dropbox-api-result") ?? "null") as DropboxMetadata | null;
    if (!meta?.rev) throw protocolError("Dropbox download came without its metadata.");
    const bytes = await bytesOf(res);
    if (typeof meta.size === "number" && meta.size !== bytes.length)
      throw new LocalFsError("unreadable", `Dropbox sent ${bytes.length} of ${meta.size} bytes.`, path);
    return { bytes, etag: meta.rev, entry: this.toEntry(meta, path) };
  }

  protected async upload(path: string, bytes: Uint8Array, ifMatch: string | null | undefined): Promise<{ entry: DropboxEntry } | { mismatch: true; etag: string; entry?: DropboxEntry }> {
    if (typeof ifMatch === "string" && !REV.test(ifMatch)) return this.mismatch(path);
    const mode = ifMatch === undefined ? "overwrite" : ifMatch === null ? "add" : { ".tag": "update", update: ifMatch };
    const commit = { path: `/${path}`, mode, autorename: false, mute: true, strict_conflict: ifMatch !== undefined };
    const result = bytes.length <= this.singleUploadMax ? await this.uploadOnce(commit, bytes) : await this.uploadSession(commit, bytes);
    if ("conflict" in result) return this.mismatch(path);
    return { entry: this.toEntry(result.meta, path) };
  }

  private async mismatch(path: string): Promise<{ mismatch: true; etag: string; entry?: DropboxEntry }> {
    const current = await this.metadata(path);
    return current ? { mismatch: true, etag: current.etag, entry: current } : { mismatch: true, etag: "" };
  }

  private async uploadOnce(commit: object, bytes: Uint8Array): Promise<{ meta: DropboxMetadata } | { conflict: true }> {
    const res = await this.api.send(`${DROPBOX_CONTENT}/files/upload`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "dropbox-api-arg": apiArg(commit) },
      body: bodyOf(bytes),
    });
    if (res.ok) return { meta: (await jsonOf<DropboxMetadata>(res)) ?? {} };
    const r = await this.failure(res, "files/upload");
    if (/conflict/.test(r.summary)) return { conflict: true };
    throw protocolError(`Dropbox upload: ${r.summary}`);
  }

  private async uploadSession(commit: object, bytes: Uint8Array): Promise<{ meta: DropboxMetadata } | { conflict: true }> {
    const first = bytes.subarray(0, this.chunkSize);
    const start = await this.api.send(`${DROPBOX_CONTENT}/files/upload_session/start`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "dropbox-api-arg": apiArg({ close: false }) },
      body: bodyOf(first),
    });
    if (!start.ok) throw protocolError(`Dropbox upload_session/start: ${(await this.failure(start, "upload_session/start")).summary}`);
    const sessionId = (await jsonOf<{ session_id?: string }>(start))?.session_id;
    if (!sessionId) throw protocolError("Dropbox didn't start an upload session.");
    let offset = first.length;
    for (let guard = 0; guard < 10_000; guard++) {
      if (offset >= bytes.length) {
        const res = await this.api.send(`${DROPBOX_CONTENT}/files/upload_session/finish`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream", "dropbox-api-arg": apiArg({ cursor: { session_id: sessionId, offset }, commit }) },
          body: new Uint8Array(0),
        });
        if (res.ok) return { meta: (await jsonOf<DropboxMetadata>(res)) ?? {} };
        const r = await this.failure(res, "upload_session/finish");
        const correct = correctOffset(r.body);
        if (correct !== null) {
          offset = correct;
          continue;
        }
        if (/conflict/.test(r.summary)) return { conflict: true };
        throw protocolError(`Dropbox upload_session/finish: ${r.summary}`);
      }
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + this.chunkSize));
      const res = await this.api.send(`${DROPBOX_CONTENT}/files/upload_session/append_v2`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "dropbox-api-arg": apiArg({ cursor: { session_id: sessionId, offset }, close: false }) },
        body: bodyOf(chunk),
      });
      if (res.ok) {
        await res.body?.cancel().catch(() => undefined);
        offset += chunk.length;
        continue;
      }
      const r = await this.failure(res, "upload_session/append_v2");
      const correct = correctOffset(r.body);
      if (correct === null) throw protocolError(`Dropbox upload_session/append_v2: ${r.summary}`);
      // Part of a chunk arrived (or an earlier attempt did): carry on from where Dropbox is.
      offset = correct;
    }
    throw protocolError("Dropbox upload session didn't finish.");
  }

  protected async delete(path: string, ifMatch: string | undefined): Promise<void> {
    if (ifMatch !== undefined && !REV.test(ifMatch)) {
      if (!(await this.metadata(path))) return;
      throw new LocalFsError("mismatch", `Changed since read: ${path}`, path);
    }
    const r = await this.rpc("files/delete_v2", ifMatch === undefined ? { path: `/${path}` } : { path: `/${path}`, parent_rev: ifMatch });
    if (r.ok) return;
    const current = await this.metadata(path);
    if (!current) return; // already gone
    if (ifMatch !== undefined && current.etag !== ifMatch) {
      this.entries.set(path, current);
      throw new LocalFsError("mismatch", `Changed since read: ${path}`, path);
    }
    throw protocolError(`Dropbox delete_v2: ${r.summary}`);
  }

  // ---------------------------------------------------------------- state

  protected providerState(): unknown {
    return { cursor: this.cursor };
  }

  protected restoreProviderState(state: unknown): boolean {
    const cursor = (state as { cursor?: unknown } | null)?.cursor;
    if (cursor !== null && typeof cursor !== "string") return false;
    this.cursor = cursor;
    return true;
  }

  protected restoreEntry(raw: unknown): DropboxEntry | null {
    const e = raw as Partial<DropboxEntry> | null;
    if (!e || typeof e.path !== "string" || !isValidLibraryPath(e.path) || typeof e.etag !== "string") return null;
    return { path: e.path, lower: typeof e.lower === "string" ? e.lower : e.path.toLowerCase(), etag: e.etag, size: Number(e.size) || 0, mtimeMs: Number(e.mtimeMs) || 0 };
  }
}

function correctOffset(body: DropboxErrorBody | null): number | null {
  // { error: { ".tag": "incorrect_offset", correct_offset } } or nested under lookup_failed.
  const find = (v: unknown): number | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.correct_offset === "number") return o.correct_offset;
    for (const k of Object.keys(o)) {
      const n = find(o[k]);
      if (n !== null) return n;
    }
    return null;
  };
  return /incorrect_offset/.test(body?.error_summary ?? "") ? find(body?.error) : null;
}
