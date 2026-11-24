// A fake Google Drive (API v3, drive.file) for tests: items with parents and same-name twins, head revisions
// and revision history, changes.list page tokens over a lagging change log (listings are eventually
// consistent; a GET by id is not), name queries, multipart, media and resumable uploads (308 + Range, cut-off
// chunks), trash, 403 rate limits, short-lived tokens with refresh, revocation, and seeded faults. No
// compare-and-swap, exactly like the real one: concurrent uploads simply replace each other.
import { bodyBytes, bodyText, FakeOAuth, FaultInjector, json, NO_FAKE_FAULTS, seeded, yieldRandomly, type FakeFaultRates } from "./fakeCommon";

const FOLDER = "application/vnd.google-apps.folder";

interface Rev {
  id: string;
  bytes: Uint8Array;
  modifiedTime: string;
}

export interface FakeItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  createdTime: string;
  modifiedTime: string;
  trashed: boolean;
  appProperties?: Record<string, string>;
  revisions: Rev[];
}

export interface FakeDriveOptions {
  seed?: number;
  clientId?: string;
  now?: () => number;
  accessTtlMs?: number;
  pageSize?: number;
  yields?: number;
  /** Resumable chunks must be multiples of this (Drive: 256 KiB). */
  chunkMultiple?: number;
}

export class FakeDrive {
  readonly oauth: FakeOAuth;
  readonly random: () => number;
  readonly items = new Map<string, FakeItem>();
  /** Item ids in the order they changed, with item snapshots (what changes.list and lagging listings see). */
  private readonly log_: { seq: number; snapshot: FakeItem }[] = [];
  private seq = 0;
  private visible = 0;
  private ids = 0;
  private revs = 0;
  private clock = 0;
  private readonly sessions = new Map<string, { method: string; targetId?: string; metadata: Record<string, unknown>; total: number; bytes: number[] }>();
  readonly log: string[] = [];
  readonly injectors: FaultInjector[] = [];
  readonly routes = new Map<string, number>();
  private faultRates: FakeFaultRates = NO_FAKE_FAULTS;
  private readonly pageSize: number;
  private readonly yields: number;
  private readonly chunkMultiple: number;
  account = { user: { emailAddress: "faisal@example.com", displayName: "Faisal" } };

  constructor(options: FakeDriveOptions = {}) {
    this.random = seeded(options.seed ?? 1);
    this.oauth = new FakeOAuth(options.clientId ?? "gdrive.apps.googleusercontent.com", options.now ?? Date.now, options.accessTtlMs, "goog");
    this.pageSize = options.pageSize ?? 25;
    this.yields = options.yields ?? 0;
    this.chunkMultiple = options.chunkMultiple ?? 256 * 1024;
  }

  // ---------------------------------------------------------------- test controls

  set faults(rates: FakeFaultRates) {
    this.faultRates = rates;
    for (const i of this.injectors) i.rates = rates;
    if (!rates.lag) this.visible = this.seq;
  }
  get faults(): FakeFaultRates {
    return this.faultRates;
  }
  get pending(): number {
    return this.seq - this.visible;
  }
  step(): boolean {
    if (this.visible >= this.seq) return false;
    this.visible++;
    return true;
  }
  settle(): void {
    this.faults = NO_FAKE_FAULTS;
    this.visible = this.seq;
  }

  /** Every live file's library path (by names from a Folevi root), for assertions. */
  libraryFiles(): Map<string, FakeItem[]> {
    const out = new Map<string, FakeItem[]>();
    const pathOf = (id: string, depth = 0): string | null => {
      const it = this.items.get(id);
      if (!it || it.trashed || depth > 64) return null;
      if (it.mimeType === FOLDER && it.appProperties?.folevi === "library") return "";
      const parent = it.parents[0];
      if (!parent) return null;
      const pp = pathOf(parent, depth + 1);
      if (pp === null) return null;
      return pp ? `${pp}/${it.name}` : it.name;
    };
    for (const it of this.items.values()) {
      if (it.mimeType === FOLDER || it.trashed) continue;
      const p = pathOf(it.id);
      if (p) out.set(p, [...(out.get(p) ?? []), it]);
    }
    return out;
  }

  /** The current bytes at a library path (the oldest twin). */
  file(path: string): Uint8Array | undefined {
    const twins = this.libraryFiles().get(path);
    if (!twins?.length) return undefined;
    twins.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
    return twins[0]!.revisions.at(-1)!.bytes.slice();
  }

  paths(): string[] {
    return [...this.libraryFiles().keys()].sort();
  }

  roots(): FakeItem[] {
    return [...this.items.values()].filter((i) => i.mimeType === FOLDER && i.appProperties?.folevi === "library" && !i.trashed);
  }

  fetchFor(injector = new FaultInjector(seeded(Math.floor(this.random() * 2 ** 31)))): typeof fetch {
    injector.rates = this.faultRates;
    this.injectors.push(injector);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      if (this.yields) await yieldRandomly(this.random, this.yields);
      const failure = injector.before();
      if (failure) {
        // Drive's own rate limit shape: 403 userRateLimitExceeded, sometimes.
        if (failure.status === 429 && this.random() < 0.5)
          return json(403, { error: { code: 403, message: "User Rate Limit Exceeded", errors: [{ domain: "usageLimits", reason: "userRateLimitExceeded" }] } });
        return failure;
      }
      const res = await this.handle(String(input), init ?? {}, injector);
      if (this.yields) await yieldRandomly(this.random, this.yields);
      return res;
    }) as typeof fetch;
  }

  // ---------------------------------------------------------------- state

  private nextTime(): string {
    return new Date(1_800_000_000_000 + ++this.clock * 1000).toISOString();
  }

  private record(item: FakeItem) {
    this.log_.push({ seq: ++this.seq, snapshot: structuredClone(item) });
    if (!(this.faultRates.lag > 0 && this.random() < this.faultRates.lag)) this.visible = this.seq;
  }

  private create(meta: { name: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string> }, bytes: Uint8Array | null): FakeItem {
    const now = this.nextTime();
    const parents = (meta.parents ?? ["root"]).map((p) => (p === "root" ? "root" : p));
    const item: FakeItem = {
      id: `f${(++this.ids).toString(36).padStart(5, "0")}`,
      name: meta.name,
      mimeType: meta.mimeType ?? "application/octet-stream",
      parents,
      createdTime: now,
      modifiedTime: now,
      trashed: false,
      ...(meta.appProperties ? { appProperties: meta.appProperties } : {}),
      revisions: meta.mimeType === FOLDER || bytes === null ? [] : [{ id: `r${(++this.revs).toString(36)}`, bytes: bytes.slice(), modifiedTime: now }],
    };
    this.items.set(item.id, item);
    this.record(item);
    this.log.push(`create ${item.id} ${item.name}`);
    return item;
  }

  private update(item: FakeItem, bytes: Uint8Array) {
    const now = this.nextTime();
    item.revisions.push({ id: `r${(++this.revs).toString(36)}`, bytes: bytes.slice(), modifiedTime: now });
    item.modifiedTime = now;
    this.record(item);
    this.log.push(`update ${item.id} ${item.name} ${item.revisions.at(-1)!.id}`);
  }

  /** Another client of Folevi's writes a library file (creating its folders under the oldest root). */
  putPath(path: string, bytes: Uint8Array): void {
    const twins = this.libraryFiles().get(path);
    if (twins?.length) {
      twins.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
      this.update(twins[0]!, bytes);
      return;
    }
    let parent = this.roots().sort((a, b) => a.createdTime.localeCompare(b.createdTime))[0] ?? this.create({ name: "Folevi", mimeType: FOLDER, parents: ["root"], appProperties: { folevi: "library" } }, null);
    const parts = path.split("/");
    for (const name of parts.slice(0, -1)) {
      const found = [...this.items.values()].find((i) => i.mimeType === FOLDER && !i.trashed && i.name === name && i.parents[0] === parent.id);
      parent = found ?? this.create({ name, mimeType: FOLDER, parents: [parent.id] }, null);
    }
    this.create({ name: parts.at(-1)!, parents: [parent.id] }, bytes);
  }

  /** Another client replaces a file's content (for race tests). */
  overwrite(id: string, bytes: Uint8Array) {
    this.update(this.items.get(id)!, bytes);
  }

  view(item: FakeItem) {
    const head = item.revisions.at(-1);
    return {
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      parents: item.parents,
      createdTime: item.createdTime,
      modifiedTime: item.modifiedTime,
      trashed: item.trashed,
      ...(item.appProperties ? { appProperties: item.appProperties } : {}),
      ...(head ? { headRevisionId: head.id, size: String(head.bytes.length) } : {}),
    };
  }

  /** Items as the lagging index sees them. */
  private visibleItems(): Map<string, FakeItem> {
    const state = new Map<string, FakeItem>();
    for (const e of this.log_) {
      if (e.seq > this.visible) break;
      state.set(e.snapshot.id, e.snapshot);
    }
    return state;
  }

  // ---------------------------------------------------------------- requests

  private error(status: number, reason: string, message = reason) {
    return json(status, { error: { code: status, message, errors: [{ domain: "global", reason, message }] } });
  }

  private async handle(url: string, init: RequestInit, injector: FaultInjector): Promise<Response> {
    const u = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const key = `${method} ${u.host}${u.pathname.replace(/\/files\/[^/]+/, "/files/:id").replace(/\/revisions\/[^/]+$/, "/revisions/:rev")}${u.searchParams.get("alt") === "media" ? "?alt=media" : ""}`;
    this.routes.set(key, (this.routes.get(key) ?? 0) + 1);
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") return this.oauth.token(new URLSearchParams(await bodyText(init)));
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") {
      this.oauth.revokeToken(new URLSearchParams(await bodyText(init)).get("token") ?? "");
      return new Response("", { status: 200 });
    }
    if (u.host !== "www.googleapis.com") return this.error(404, "notFound");
    const auth = this.oauth.check(headers.get("authorization"));
    if (auth !== "valid") return this.error(401, "authError", "Invalid Credentials");
    const p = u.pathname;
    const s = u.searchParams;

    if (p === "/drive/v3/about") return json(200, this.account);
    if (p === "/drive/v3/changes/startPageToken") return json(200, { startPageToken: String(this.visible + 1) });
    if (p === "/drive/v3/changes") return this.changes(s);
    if (p === "/drive/v3/files" && method === "GET") return this.list(s);
    if (p === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(await bodyText(init));
      if (meta.mimeType !== FOLDER) return this.error(400, "badRequest", "this fake creates folders only without content");
      return json(200, this.view(this.create(meta, null)));
    }
    let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (m) {
      const item = this.items.get(decodeURIComponent(m[1]!));
      if (!item) return this.error(404, "notFound", "File not found");
      if (method === "GET") {
        if (s.get("alt") === "media") {
          let bytes = item.revisions.at(-1)?.bytes ?? new Uint8Array(0);
          if (bytes.length > 1 && injector.partial()) bytes = bytes.slice(0, Math.floor(bytes.length / 2));
          return new Response(bytes.slice(), { status: 200 });
        }
        return json(200, this.view(item));
      }
      if (method === "PATCH") {
        const patch = JSON.parse((await bodyText(init)) || "{}");
        if (patch.trashed === true && !item.trashed) {
          item.trashed = true;
          this.record(item);
          this.log.push(`trash ${item.id} ${item.name}`);
        }
        return json(200, this.view(item));
      }
    }
    m = /^\/drive\/v3\/files\/([^/]+)\/revisions$/.exec(p);
    if (m) {
      const item = this.items.get(m[1]!);
      if (!item) return this.error(404, "notFound");
      return json(200, { revisions: item.revisions.map((r) => ({ id: r.id, modifiedTime: r.modifiedTime, size: String(r.bytes.length) })) });
    }
    m = /^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/.exec(p);
    if (m) {
      const rev = this.items.get(m[1]!)?.revisions.find((r) => r.id === m![2]);
      if (!rev) return this.error(404, "notFound", "Revision not found");
      return new Response(rev.bytes.slice(), { status: 200 });
    }
    // Uploads.
    if (p === "/upload/drive/v3/files" || /^\/upload\/drive\/v3\/files\/[^/]+$/.test(p)) {
      const targetId = p.split("/")[5];
      const target = targetId ? this.items.get(targetId) : undefined;
      if (targetId && !target) return this.error(404, "notFound");
      const type = s.get("uploadType");
      if (s.has("upload_id")) return this.resumeChunk(s.get("upload_id")!, headers, await bodyBytes(init), injector);
      if (type === "multipart" && method === "POST") {
        const { metadata, media } = parseMultipart(headers.get("content-type") ?? "", await bodyBytes(init));
        return json(200, this.view(this.create(metadata as never, media)));
      }
      if (type === "media" && method === "PATCH" && target) {
        if (target.trashed) return this.error(404, "notFound");
        this.update(target, await bodyBytes(init));
        return json(200, this.view(target));
      }
      if (type === "resumable") {
        const id = `up${this.sessions.size + 1}x${Math.floor(this.random() * 1e6)}`;
        const total = Number(headers.get("x-upload-content-length") ?? "-1");
        this.sessions.set(id, { method, ...(targetId ? { targetId } : {}), metadata: JSON.parse((await bodyText(init)) || "{}"), total, bytes: [] });
        const location = `https://www.googleapis.com${p}?uploadType=resumable&upload_id=${id}`;
        return new Response("", { status: 200, headers: { location } });
      }
    }
    return this.error(400, "badRequest", `unknown ${method} ${p}`);
  }

  private resumeChunk(id: string, headers: Headers, chunk: Uint8Array, injector: FaultInjector): Response {
    const sess = this.sessions.get(id);
    if (!sess) return this.error(404, "notFound", "Upload session expired");
    const range = headers.get("content-range") ?? "";
    const status = /^bytes \*\/(\d+)$/.exec(range);
    const answer = () => (sess.bytes.length ? new Response("", { status: 308, headers: { range: `bytes=0-${sess.bytes.length - 1}` } }) : new Response("", { status: 308 }));
    if (status && chunk.length === 0) {
      if (sess.bytes.length === sess.total) return this.finish(id);
      return answer();
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!m) return this.error(400, "badRequest", "Content-Range");
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (end - start + 1 !== chunk.length) return this.error(400, "badRequest", "range and body differ");
    if (start > sess.bytes.length) return this.error(400, "badRequest", "gap in upload");
    const last = end + 1 === sess.total;
    if (!last && chunk.length % this.chunkMultiple !== 0) return this.error(400, "badRequest", "chunk size");
    // Overlap with what's already here is fine (a retried chunk).
    const fresh = chunk.subarray(sess.bytes.length - start);
    if (fresh.length > 1 && injector.partial()) {
      sess.bytes.push(...fresh.subarray(0, Math.floor(fresh.length / 2)));
      throw new TypeError("fetch failed (connection reset mid-upload)");
    }
    sess.bytes.push(...fresh);
    if (sess.bytes.length < sess.total) return answer();
    return this.finish(id);
  }

  private finish(id: string): Response {
    const sess = this.sessions.get(id)!;
    this.sessions.delete(id);
    const bytes = new Uint8Array(sess.bytes);
    if (sess.targetId) {
      const target = this.items.get(sess.targetId)!;
      this.update(target, bytes);
      return json(200, this.view(target));
    }
    return json(200, this.view(this.create(sess.metadata as never, bytes)));
  }

  private list(s: URLSearchParams): Response {
    const query = s.get("q") ?? "";
    const visible = [...this.visibleItems().values()];
    let match: (i: FakeItem) => boolean;
    const named = /^name = '((?:[^'\\]|\\.)*)' and '((?:[^'\\]|\\.)*)' in parents and trashed = false$/.exec(query);
    if (query === "trashed = false") match = (i) => !i.trashed;
    else if (named) {
      const name = named[1]!.replace(/\\(.)/g, "$1");
      const parent = named[2]!.replace(/\\(.)/g, "$1");
      match = (i) => !i.trashed && i.name === name && i.parents.includes(parent);
    } else return this.error(400, "invalidQuery", `this fake doesn't understand q=${query}`);
    const all = visible.filter(match).sort((a, b) => a.id.localeCompare(b.id));
    const from = Number(s.get("pageToken") ?? "0");
    const size = Math.min(this.pageSize, Number(s.get("pageSize") ?? "100"));
    const page = all.slice(from, from + size);
    return json(200, { files: page.map((i) => this.view(i)), ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
  }

  private changes(s: URLSearchParams): Response {
    const token = Number(s.get("pageToken"));
    if (!Number.isInteger(token) || token < 1) return this.error(400, "invalid", "Invalid pageToken");
    const entries = this.log_.filter((e) => e.seq >= token && e.seq <= this.visible);
    const page = entries.slice(0, this.pageSize);
    const more = entries.length > this.pageSize;
    const changes = page.map((e) => ({ kind: "drive#change", fileId: e.snapshot.id, removed: false, file: this.view(e.snapshot) }));
    return json(200, more ? { changes, nextPageToken: String(page.at(-1)!.seq + 1) } : { changes, newStartPageToken: String(this.visible + 1) });
  }
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function parseMultipart(contentType: string, body: Uint8Array): { metadata: unknown; media: Uint8Array } {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!boundary) throw new Error("no boundary");
  const enc = new TextEncoder();
  const delim = enc.encode(`--${boundary}`);
  const parts: Uint8Array[] = [];
  let at = indexOf(body, delim);
  while (at !== -1) {
    const start = at + delim.length;
    if (body[start] === 45 && body[start + 1] === 45) break; // "--": the end
    const next = indexOf(body, delim, start);
    if (next === -1) break;
    parts.push(body.subarray(start + 2, next - 2)); // after CRLF, before CRLF
    at = next;
  }
  const split = (part: Uint8Array) => {
    const sep = indexOf(part, enc.encode("\r\n\r\n"));
    return part.subarray(sep + 4);
  };
  if (parts.length !== 2) throw new Error(`multipart with ${parts.length} parts`);
  return { metadata: JSON.parse(new TextDecoder().decode(split(parts[0]!))), media: split(parts[1]!).slice() };
}
