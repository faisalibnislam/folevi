// The library in a "Folevi" folder in the person's Google Drive, over the Drive API v3 with the `drive.file`
// scope (Folevi sees only what it created). Platform neutral.
//
// - Paths map to folders and files by name, with ids cached in the index. Drive allows several items with the
//   same name in one folder, so two devices creating the same folder (or the "Folevi" folder itself) at once
//   just leaves twins: every folder that resolves to the same path counts as that path, and new files go into
//   the oldest one.
// - Change detection: `changes.list` from a stored start page token (taken before the first full listing, so
//   nothing is missed); Drive has no long poll for installed apps, so the watch loop polls.
// - Etags are `<fileId>.<headRevisionId>`.
//
// Drive has no compare-and-swap. A conditional write re-reads the file's head revision and uploads only if it
// still matches, so the race window is the time between that check and the upload landing (one round trip
// plus the upload). Two writers inside that window: the later upload replaces the earlier one. That race is
// covered three ways:
//   1. after each conditional upload Folevi lists the file's revisions; a revision between the one it checked
//      and its own is someone else's lost write, offered back as a conflict version (`conflictVersions`), which
//      local-store merges and then resolves;
//   2. anti-entropy (LOCAL_MODE_PLAN.md §3.6): the device whose write was replaced still has it in its replica
//      and re-asserts it on its next sync, because the file's `seen` doesn't cover it;
//   3. merges are idempotent and commutative, so a replayed write never duplicates anything.
// Two devices creating the same new file at once is the same race: the later one notices the other (a name
// query right after the create) and trashes its own, or, if Drive's index hasn't caught up, the extra file is
// listed as a numbered copy (`<id>(1).fnote`) that local-store merges and removes like any provider's copy.
// Deletes go to the Drive trash (recoverable for 30 days).
import { abortable, CloudFs, protocolError, type CloudFsOptions, type RemoteEntry } from "./cloudFs";
import { bodyOf, bytesOf, defaultClassifier, jsonOf, type RetryClassifier } from "./http";
import { isImmutablePath, type MirrorStore } from "./mirror";
import { CloudError, isValidLibraryPath, LocalFsError, notFound, type CloudChange, type ApiHttp } from "./types";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const ROOT_NAME = "Folevi";
/** The marker on the library's root folder (an app property, private to Folevi's Cloud project). */
export const ROOT_PROPERTY = { key: "folevi", value: "library" } as const;

const ITEM_FIELDS = "id,name,mimeType,parents,headRevisionId,size,modifiedTime,createdTime,trashed,appProperties";

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  headRevisionId?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

export interface DriveEntry extends RemoteEntry {
  id: string;
  head: string;
  /** Set on an extra file Drive holds under the same path: it is listed under a numbered copy name. */
  copyOf?: string;
}

interface Lost {
  fileId: string;
  revisionId: string;
}

export interface DriveFsOptions extends CloudFsOptions {
  /** Above this, uploads are resumable (in chunks); below, one multipart or media request. */
  simpleUploadMax?: number;
  /** Resumable chunk size; Drive wants multiples of 256 KiB. */
  chunkSize?: number;
  /** How often the watch loop asks for changes (ms). */
  pollMs?: number;
}

/** Drive's rate limits are 429, or 403 with reason rateLimitExceeded / userRateLimitExceeded. */
export const driveClassifier: RetryClassifier = async (res) => {
  if (res.status === 403) {
    const body = (await jsonOf<{ error?: { errors?: { reason?: string }[] } }>(res.clone())) ?? {};
    const reasons = (body.error?.errors ?? []).map((e) => e.reason);
    if (reasons.includes("rateLimitExceeded") || reasons.includes("userRateLimitExceeded")) return { retry: true };
    return { retry: false };
  }
  return defaultClassifier(res);
};

export function driveEtag(id: string, head: string): string {
  return `${id}.${head}`;
}

export function parseDriveEtag(etag: string): { id: string; head: string } | null {
  const dot = etag.indexOf(".");
  if (dot <= 0 || dot === etag.length - 1) return null;
  return { id: etag.slice(0, dot), head: etag.slice(dot + 1) };
}

/** `notes/X.fnote` → `notes/X(1).fnote`: the shape local-store's conflict-copy parser knows as "numbered". */
export function numberedCopy(path: string, n: number): string {
  const slash = path.lastIndexOf("/");
  const file = path.slice(slash + 1);
  const dot = file.indexOf(".");
  const stem = dot === -1 ? file : file.slice(0, dot);
  const ext = dot === -1 ? "" : file.slice(dot);
  return `${path.slice(0, slash + 1)}${stem}(${n})${ext}`;
}

function q(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const time = (s: string | undefined) => Date.parse(s ?? "") || 0;
const older = (a: DriveItem, b: DriveItem) => time(a.createdTime) - time(b.createdTime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class DriveFs extends CloudFs<DriveEntry> {
  readonly provider = "googleDrive" as const;
  /** Every item Folevi can see (files and folders), by id. */
  private readonly items = new Map<string, DriveItem>();
  private pageToken: string | null = null;
  /** Revisions other devices wrote that a racing upload replaced, by path. */
  private readonly lost = new Map<string, Lost[]>();
  private readonly simpleUploadMax: number;
  private readonly chunkSize: number;
  private readonly pollMs: number;

  constructor(
    private readonly api: ApiHttp,
    mirror: MirrorStore,
    options: DriveFsOptions = {},
  ) {
    super(mirror, options);
    this.simpleUploadMax = options.simpleUploadMax ?? 5 * 1024 * 1024;
    this.chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
    this.pollMs = options.pollMs ?? 30_000;
  }

  // ---------------------------------------------------------------- requests

  private async call<T>(url: string, init: RequestInit = {}): Promise<{ ok: true; body: T; res: Response } | { ok: false; status: number; reason: string }> {
    const res = await this.api.send(url, init);
    if (res.ok) return { ok: true, body: (await jsonOf<T>(res)) as T, res };
    const body = (await jsonOf<{ error?: { message?: string; errors?: { reason?: string }[] } }>(res)) ?? {};
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.message ?? "";
    if (res.status === 403 && /storageQuotaExceeded|quotaExceeded/.test(reason)) throw new CloudError("quota", "Your Google Drive is full.", 403);
    if (res.status === 404) return { ok: false, status: 404, reason };
    if (res.status === 400 && /pageToken|invalid/i.test(reason)) return { ok: false, status: 400, reason };
    throw protocolError(`Google Drive answered HTTP ${res.status}${reason ? ` (${reason})` : ""} to ${new URL(url).pathname}.`, res.status);
  }

  private async getItem(id: string): Promise<DriveItem | null> {
    const r = await this.call<DriveItem>(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${ITEM_FIELDS}`);
    if (!r.ok) return null;
    return r.body.trashed ? null : r.body;
  }

  // ---------------------------------------------------------------- the tree

  private roots(): DriveItem[] {
    return [...this.items.values()].filter((i) => i.mimeType === FOLDER_MIME && !i.trashed && i.appProperties?.[ROOT_PROPERTY.key] === ROOT_PROPERTY.value).sort(older);
  }

  /** Each folder's library path ("" for a root), or null outside the library. */
  private folderPaths(): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of this.roots()) out.set(r.id, "");
    const resolve = (id: string, depth: number): string | null => {
      const known = out.get(id);
      if (known !== undefined) return known;
      const item = this.items.get(id);
      if (!item || item.mimeType !== FOLDER_MIME || item.trashed || depth > 64) return null;
      const parent = item.parents?.[0];
      if (!parent) return null;
      const pp = resolve(parent, depth + 1);
      if (pp === null) return null;
      const path = pp ? `${pp}/${item.name}` : item.name;
      out.set(id, path);
      return path;
    };
    for (const item of this.items.values()) if (item.mimeType === FOLDER_MIME) resolve(item.id, 0);
    return out;
  }

  /** Recomputes the index from the items; returns what changed. */
  private rebuild(): CloudChange[] {
    const folders = this.folderPaths();
    const byPath = new Map<string, DriveItem[]>();
    for (const item of this.items.values()) {
      if (item.mimeType === FOLDER_MIME || item.trashed || !item.headRevisionId) continue;
      const dir = folders.get(item.parents?.[0] ?? "");
      if (dir === undefined) continue;
      const path = dir ? `${dir}/${item.name}` : item.name;
      if (!isValidLibraryPath(path)) continue;
      byPath.set(path, [...(byPath.get(path) ?? []), item]);
    }
    const next = new Map<string, DriveEntry>();
    const entryOf = (path: string, item: DriveItem, copyOf?: string): DriveEntry => ({
      path,
      id: item.id,
      head: item.headRevisionId!,
      etag: driveEtag(item.id, item.headRevisionId!),
      size: Number(item.size ?? 0) || 0,
      mtimeMs: time(item.modifiedTime),
      ...(copyOf ? { copyOf } : {}),
    });
    for (const [path, group] of byPath) {
      group.sort(older);
      next.set(path, entryOf(path, group[0]!));
      // Attachments and versions are immutable and named by their content: a twin is the same file.
      if (isImmutablePath(path)) continue;
      let n = 1;
      for (const extra of group.slice(1)) {
        let name = numberedCopy(path, n++);
        while (byPath.has(name) || next.has(name)) name = numberedCopy(path, n++);
        next.set(name, entryOf(name, extra, path));
      }
    }
    const changes: CloudChange[] = [];
    for (const [path, e] of next) if (this.entries.get(path)?.etag !== e.etag) changes.push({ path, kind: "changed" });
    for (const path of this.entries.keys()) if (!next.has(path)) changes.push({ path, kind: "removed" });
    this.entries.clear();
    for (const [path, e] of next) this.entries.set(path, e);
    return changes;
  }

  /** The folder new files at `dir` go in, created (with its parents) when missing. */
  private async ensureFolder(dir: string): Promise<string> {
    const folders = this.folderPaths();
    const matches = [...folders].filter(([, p]) => p === dir).map(([id]) => this.items.get(id)!).filter(Boolean).sort(older);
    if (matches.length) return matches[0]!.id;
    if (dir === "") {
      const root = await this.createFolder(ROOT_NAME, "root", { [ROOT_PROPERTY.key]: ROOT_PROPERTY.value });
      this.log(`Created the "${ROOT_NAME}" folder in Google Drive.`);
      return root.id;
    }
    const slash = dir.lastIndexOf("/");
    const parent = await this.ensureFolder(slash === -1 ? "" : dir.slice(0, slash));
    return (await this.createFolder(dir.slice(slash + 1), parent)).id;
  }

  private async createFolder(name: string, parent: string, appProperties?: Record<string, string>): Promise<DriveItem> {
    const r = await this.call<DriveItem>(`${DRIVE_API}/files?fields=${ITEM_FIELDS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], ...(appProperties ? { appProperties } : {}) }),
    });
    if (!r.ok) throw protocolError(`Couldn't create the folder ${name} in Google Drive (${r.reason}).`);
    this.items.set(r.body.id, r.body);
    return r.body;
  }

  // ---------------------------------------------------------------- change feed

  protected async pullChanges(): Promise<CloudChange[]> {
    if (!this.pageToken) return this.fullListing();
    let token = this.pageToken;
    for (;;) {
      const r = await this.call<{ nextPageToken?: string; newStartPageToken?: string; changes?: { fileId: string; removed?: boolean; file?: DriveItem }[] }>(
        `${DRIVE_API}/changes?pageToken=${encodeURIComponent(token)}&pageSize=1000&spaces=drive&includeRemoved=true&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(${ITEM_FIELDS}))`,
      );
      if (!r.ok) {
        this.log(`Google Drive refused the stored page token (${r.reason}): listing everything again.`);
        this.pageToken = null;
        return this.fullListing();
      }
      for (const c of r.body.changes ?? []) {
        if (c.removed || !c.file || c.file.trashed) this.items.delete(c.fileId);
        else this.items.set(c.fileId, c.file);
      }
      if (r.body.newStartPageToken) {
        token = r.body.newStartPageToken;
        break;
      }
      if (!r.body.nextPageToken) break;
      token = r.body.nextPageToken;
    }
    this.pageToken = token;
    return this.rebuild();
  }

  private async fullListing(): Promise<CloudChange[]> {
    // The start token first: anything that changes during the listing shows up in the next changes.list.
    const start = await this.call<{ startPageToken?: string }>(`${DRIVE_API}/changes/startPageToken`);
    if (!start.ok || !start.body.startPageToken) throw protocolError("Google Drive didn't give a start page token.");
    const all = new Map<string, DriveItem>();
    let pageToken: string | undefined;
    do {
      const r = await this.call<{ nextPageToken?: string; files?: DriveItem[] }>(
        `${DRIVE_API}/files?q=${encodeURIComponent("trashed = false")}&spaces=drive&pageSize=1000&fields=nextPageToken,files(${ITEM_FIELDS})${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      );
      if (!r.ok) throw protocolError(`Google Drive files.list: ${r.reason}`);
      for (const f of r.body.files ?? []) all.set(f.id, f);
      pageToken = r.body.nextPageToken;
    } while (pageToken);
    this.items.clear();
    for (const [id, f] of all) this.items.set(id, f);
    this.pageToken = start.body.startPageToken;
    return this.rebuild();
  }

  protected waitForChanges(signal: AbortSignal): Promise<void> {
    return abortable(signal, this.sleep, this.pollMs);
  }

  // ---------------------------------------------------------------- files

  private async entryFor(path: string): Promise<DriveEntry | undefined> {
    const known = this.entries.get(path);
    if (known) return known;
    await this.refresh();
    return this.entries.get(path);
  }

  protected async download(path: string, entry: DriveEntry | undefined): Promise<{ bytes: Uint8Array; etag: string; entry: DriveEntry }> {
    const e = entry ?? (await this.entryFor(path));
    if (!e) throw notFound(path);
    let before = e.head;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.api.send(`${DRIVE_API}/files/${encodeURIComponent(e.id)}?alt=media`);
      if (res.status === 404) throw notFound(path);
      if (!res.ok) throw protocolError(`Google Drive download answered HTTP ${res.status}.`, res.status);
      const bytes = await bytesOf(res);
      // The bytes belong to the head revision only if it didn't move while they were on their way.
      const meta = await this.getItem(e.id);
      if (!meta?.headRevisionId) throw notFound(path);
      this.items.set(meta.id, meta);
      if (meta.headRevisionId === before) {
        if (Number(meta.size ?? bytes.length) !== bytes.length) throw new LocalFsError("unreadable", `Google Drive sent ${bytes.length} of ${meta.size} bytes.`, path);
        const next: DriveEntry = { ...e, head: before, etag: driveEtag(e.id, before), size: bytes.length, mtimeMs: time(meta.modifiedTime) };
        return { bytes, etag: next.etag, entry: next };
      }
      before = meta.headRevisionId;
    }
    throw new CloudError("busy", `${path} keeps changing in Google Drive; try again shortly.`);
  }

  protected async upload(path: string, bytes: Uint8Array, ifMatch: string | null | undefined): Promise<{ entry: DriveEntry } | { mismatch: true; etag: string; entry?: DriveEntry }> {
    if (ifMatch === null) {
      // Create only: the index, then Drive itself (the index may be behind).
      const known = await this.entryFor(path);
      if (known) return { mismatch: true, etag: known.etag, entry: known };
      return this.create(path, bytes);
    }
    if (ifMatch === undefined) {
      const known = await this.entryFor(path);
      if (!known) return this.create(path, bytes);
      const item = await this.updateContent(known.id, bytes);
      return { entry: this.entryAfter(path, known, item) };
    }
    const expected = parseDriveEtag(ifMatch);
    const known = this.entries.get(path);
    if (!expected || (known && known.id !== expected.id)) return this.currentMismatch(path);
    // The check before the upload (Drive has no compare-and-swap; see the top of this file).
    const current = await this.getItem(expected.id);
    if (!current?.headRevisionId) return this.currentMismatch(path, expected.id);
    this.items.set(current.id, current);
    if (current.headRevisionId !== expected.head) {
      const entry = known ? { ...known, head: current.headRevisionId, etag: driveEtag(current.id, current.headRevisionId) } : undefined;
      return { mismatch: true, etag: driveEtag(current.id, current.headRevisionId), ...(entry ? { entry } : {}) };
    }
    const item = await this.updateContent(expected.id, bytes);
    await this.noticeLostRevisions(path, expected.id, expected.head, item.headRevisionId!);
    return { entry: this.entryAfter(path, known, item) };
  }

  private async currentMismatch(path: string, goneId?: string): Promise<{ mismatch: true; etag: string; entry?: DriveEntry }> {
    if (goneId) this.items.delete(goneId);
    await this.refresh();
    const now = this.entries.get(path);
    return now ? { mismatch: true, etag: now.etag, entry: now } : { mismatch: true, etag: "" };
  }

  private entryAfter(path: string, known: DriveEntry | undefined, item: DriveItem): DriveEntry {
    this.items.set(item.id, item);
    return {
      path,
      id: item.id,
      head: item.headRevisionId!,
      etag: driveEtag(item.id, item.headRevisionId!),
      size: Number(item.size ?? 0) || 0,
      mtimeMs: time(item.modifiedTime),
      ...(known?.copyOf ? { copyOf: known.copyOf } : {}),
    };
  }

  private async create(path: string, bytes: Uint8Array): Promise<{ entry: DriveEntry } | { mismatch: true; etag: string; entry?: DriveEntry }> {
    const slash = path.lastIndexOf("/");
    const dir = slash === -1 ? "" : path.slice(0, slash);
    const name = path.slice(slash + 1);
    const parent = await this.ensureFolder(dir);
    const metadata = { name, parents: [parent], mimeType: "application/octet-stream" };
    const item = bytes.length <= this.simpleUploadMax ? await this.multipartCreate(metadata, bytes) : await this.resumable(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=${ITEM_FIELDS}`, "POST", metadata, bytes);
    this.items.set(item.id, item);
    // Did another device create the same file a moment ago? The older one is the file; ours goes.
    const twins = await this.twins(dir, name);
    const first = [...twins, item].sort(older)[0]!;
    if (first.id !== item.id && first.headRevisionId) {
      await this.trash(item.id).catch(() => undefined);
      this.items.delete(item.id);
      this.items.set(first.id, first);
      this.rebuild();
      const entry = this.entries.get(path);
      return { mismatch: true, etag: driveEtag(first.id, first.headRevisionId), ...(entry ? { entry } : {}) };
    }
    this.rebuild();
    return { entry: this.entryAfter(path, undefined, item) };
  }

  /** Other live files named `name` in any folder that is `dir`. */
  private async twins(dir: string, name: string): Promise<DriveItem[]> {
    const parents = [...this.folderPaths()].filter(([, p]) => p === dir).map(([id]) => id);
    const out: DriveItem[] = [];
    for (const parent of parents) {
      const r = await this.call<{ files?: DriveItem[] }>(
        `${DRIVE_API}/files?q=${encodeURIComponent(`name = ${q(name)} and ${q(parent)} in parents and trashed = false`)}&spaces=drive&pageSize=100&fields=files(${ITEM_FIELDS})`,
      );
      if (r.ok) for (const f of r.body.files ?? []) if (f.mimeType !== FOLDER_MIME) out.push(f);
    }
    return out;
  }

  private async multipartCreate(metadata: object, bytes: Uint8Array): Promise<DriveItem> {
    const boundary = `folevi${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const r = await this.call<DriveItem>(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${ITEM_FIELDS}`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!r.ok || !r.body?.id) throw protocolError("Google Drive didn't create the file.");
    return r.body;
  }

  private async updateContent(id: string, bytes: Uint8Array): Promise<DriveItem> {
    if (bytes.length > this.simpleUploadMax) return this.resumable(`${DRIVE_UPLOAD}/files/${encodeURIComponent(id)}?uploadType=resumable&fields=${ITEM_FIELDS}`, "PATCH", {}, bytes);
    const r = await this.call<DriveItem>(`${DRIVE_UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${ITEM_FIELDS}`, {
      method: "PATCH",
      headers: { "content-type": "application/octet-stream" },
      body: bodyOf(bytes),
    });
    if (!r.ok) {
      if (r.status === 404) throw notFound(id);
      throw protocolError(`Google Drive update: ${r.reason}`);
    }
    return r.body;
  }

  /** A resumable upload: the session first, then chunks, resuming from what Drive says it has. */
  private async resumable(url: string, method: "POST" | "PATCH", metadata: object, bytes: Uint8Array, restarted = false): Promise<DriveItem> {
    const init = await this.api.send(url, {
      method,
      headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "application/octet-stream", "x-upload-content-length": String(bytes.length) },
      body: JSON.stringify(metadata),
    });
    const session = init.headers.get("location");
    await init.body?.cancel().catch(() => undefined);
    if (!init.ok || !session) throw protocolError(`Google Drive didn't start a resumable upload (HTTP ${init.status}).`, init.status);
    let offset = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const end = Math.min(bytes.length, offset + this.chunkSize);
      let res: Response;
      try {
        res = await this.api.send(session, {
          method: "PUT",
          headers: { "content-range": bytes.length === 0 ? "bytes */0" : `bytes ${offset}-${end - 1}/${bytes.length}` },
          body: bodyOf(bytes.subarray(offset, end)),
        });
      } catch (error) {
        if (!(error instanceof CloudError) || error.kind !== "busy") throw error;
        // The chunk didn't make it after every retry: ask Drive where the upload stands.
        res = await this.api.send(session, { method: "PUT", headers: { "content-range": `bytes */${bytes.length}` } });
      }
      if (res.status === 200 || res.status === 201) {
        const item = await jsonOf<DriveItem>(res);
        if (!item?.id) throw protocolError("Google Drive finished an upload without the file.");
        return item;
      }
      if (res.status === 308) {
        const range = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
        await res.body?.cancel().catch(() => undefined);
        offset = range ? Number(range[1]) + 1 : 0;
        continue;
      }
      await res.body?.cancel().catch(() => undefined);
      if ((res.status === 404 || res.status === 410) && !restarted) return this.resumable(url, method, metadata, bytes, true);
      throw protocolError(`Google Drive resumable upload answered HTTP ${res.status}.`, res.status);
    }
    throw protocolError("Google Drive upload didn't finish.");
  }

  /** After a conditional upload: revisions between the checked one and ours were lost writes (see the top). */
  private async noticeLostRevisions(path: string, fileId: string, checked: string, ours: string): Promise<void> {
    const r = await this.call<{ revisions?: { id: string }[] }>(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/revisions?pageSize=1000&fields=revisions(id)`);
    if (!r.ok) return;
    const ids = (r.body.revisions ?? []).map((x) => x.id);
    const from = ids.indexOf(checked);
    const to = ids.indexOf(ours);
    if (from === -1 || to === -1 || to - from <= 1) return;
    const lost = ids.slice(from + 1, to).map((revisionId) => ({ fileId, revisionId }));
    this.log(`Google Drive: ${lost.length} write(s) to ${path} landed during Folevi's upload; offering them back to merge.`);
    this.lost.set(path, [...(this.lost.get(path) ?? []), ...lost]);
  }

  protected override hasConflicts(path: string): boolean {
    return (this.lost.get(path)?.length ?? 0) > 0;
  }

  override async conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]> {
    const out: { id: string; bytes: Uint8Array }[] = [];
    const keep: Lost[] = [];
    for (const l of this.lost.get(path) ?? []) {
      const res = await this.api.send(`${DRIVE_API}/files/${encodeURIComponent(l.fileId)}/revisions/${encodeURIComponent(l.revisionId)}?alt=media`);
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        continue; // pruned: anti-entropy still has it
      }
      if (!res.ok) throw protocolError(`Google Drive revision download answered HTTP ${res.status}.`, res.status);
      out.push({ id: l.revisionId, bytes: await bytesOf(res) });
      keep.push(l);
    }
    if (keep.length) this.lost.set(path, keep);
    else this.lost.delete(path);
    return out;
  }

  override async resolveConflicts(path: string, ids: string[]): Promise<void> {
    const rest = (this.lost.get(path) ?? []).filter((l) => !ids.includes(l.revisionId));
    if (rest.length) this.lost.set(path, rest);
    else this.lost.delete(path);
    void this.save();
  }

  private async trash(id: string): Promise<boolean> {
    const r = await this.call<DriveItem>(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    return r.ok;
  }

  protected async delete(path: string, ifMatch: string | undefined): Promise<void> {
    const entry = await this.entryFor(path);
    if (!entry) return;
    if (ifMatch !== undefined) {
      const expected = parseDriveEtag(ifMatch);
      const current = await this.getItem(entry.id);
      if (!current) {
        this.items.delete(entry.id);
        return;
      }
      if (!expected || expected.id !== entry.id || current.headRevisionId !== expected.head) throw new LocalFsError("mismatch", `Changed since read: ${path}`, path);
    }
    await this.trash(entry.id);
    this.items.delete(entry.id);
    this.lost.delete(path);
    this.rebuild();
  }

  // ---------------------------------------------------------------- state

  protected providerState(): unknown {
    return { pageToken: this.pageToken, items: [...this.items.values()], lost: [...this.lost] };
  }

  protected restoreProviderState(state: unknown): boolean {
    const s = state as { pageToken?: unknown; items?: unknown; lost?: unknown } | null;
    if (!s || (s.pageToken !== null && typeof s.pageToken !== "string") || !Array.isArray(s.items)) return false;
    this.pageToken = s.pageToken;
    this.items.clear();
    for (const raw of s.items as DriveItem[]) if (raw && typeof raw.id === "string" && typeof raw.name === "string") this.items.set(raw.id, raw);
    this.lost.clear();
    if (Array.isArray(s.lost)) for (const [path, list] of s.lost as [string, Lost[]][]) if (typeof path === "string" && Array.isArray(list)) this.lost.set(path, list);
    return true;
  }

  protected restoreEntry(raw: unknown): DriveEntry | null {
    const e = raw as Partial<DriveEntry> | null;
    if (!e || typeof e.path !== "string" || !isValidLibraryPath(e.path) || typeof e.id !== "string" || typeof e.head !== "string") return null;
    return { path: e.path, id: e.id, head: e.head, etag: driveEtag(e.id, e.head), size: Number(e.size) || 0, mtimeMs: Number(e.mtimeMs) || 0, ...(typeof e.copyOf === "string" ? { copyOf: e.copyOf } : {}) };
  }
}
