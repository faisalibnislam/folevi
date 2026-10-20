// A fake Dropbox (API v2, app folder) for tests: revs, write modes with strict conflicts, list_folder cursors
// (with paging, resets and lagging listings), longpoll, upload sessions with offsets, delete_v2 parent_rev,
// short-lived tokens with refresh, revocation, and seeded faults. Case-insensitive paths like the real one.
import type { LocalFs } from "../../src/library/cloud/types";
import { bodyBytes, bodyText, FakeOAuth, FaultInjector, json, NO_FAKE_FAULTS, seeded, yieldRandomly, type FakeFaultRates } from "./fakeCommon";

interface DbxFile {
  display: string;
  bytes: Uint8Array;
  rev: string;
  modified: string;
  id: string;
}

type DbxEvent = { seq: number; lower: string; file: DbxFile | null };

const HOSTS = { api: "api.dropboxapi.com", content: "content.dropboxapi.com", notify: "notify.dropboxapi.com" };

export interface FakeDropboxOptions {
  seed?: number;
  clientId?: string;
  now?: () => number;
  accessTtlMs?: number;
  /** list_folder page size (small, to exercise has_more). */
  pageSize?: number;
  /** Random yields per request (interleaving). */
  yields?: number;
}

export class FakeDropbox {
  readonly oauth: FakeOAuth;
  readonly random: () => number;
  private readonly files = new Map<string, DbxFile>();
  private readonly events: DbxEvent[] = [];
  /** Listings and cursors show events up to here (eventual consistency). */
  private visible = 0;
  private seq = 0;
  private revs = 0;
  private sessions = new Map<string, { bytes: number[] }>();
  private generation = 1;
  private readonly waiters = new Set<() => void>();
  readonly log: string[] = [];
  readonly injectors: FaultInjector[] = [];
  readonly calls: string[] = [];
  /** Requests seen per route. */
  readonly routes = new Map<string, number>();
  private faultRates: FakeFaultRates = NO_FAKE_FAULTS;
  private readonly pageSize: number;
  private readonly yields: number;
  account = { email: "faisal@example.com", name: { display_name: "Faisal" } };

  constructor(options: FakeDropboxOptions = {}) {
    this.random = seeded(options.seed ?? 1);
    this.oauth = new FakeOAuth(options.clientId ?? "dbx-key", options.now ?? Date.now, options.accessTtlMs, "dbx");
    this.pageSize = options.pageSize ?? 25;
    this.yields = options.yields ?? 0;
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

  /** Changes not yet visible in listings. */
  get pending(): number {
    return this.seq - this.visible;
  }

  /** Makes one more change visible. */
  step(): boolean {
    if (this.visible >= this.seq) return false;
    this.visible++;
    this.wake();
    return true;
  }

  settle(): void {
    this.faults = NO_FAKE_FAULTS;
    this.visible = this.seq;
    this.wake();
  }

  /** Invalidates every cursor issued so far (Dropbox's `reset`). */
  resetCursors(): void {
    this.generation++;
  }

  private wake() {
    for (const w of [...this.waiters]) w();
  }

  file(path: string): Uint8Array | undefined {
    return this.files.get(`/${path}`.toLowerCase())?.bytes.slice();
  }

  paths(): string[] {
    return [...this.files.values()].map((f) => f.display.slice(1)).sort();
  }

  revOf(path: string): string | undefined {
    return this.files.get(`/${path}`.toLowerCase())?.rev;
  }

  /** Another app (or the Dropbox client) writes a file. */
  put(path: string, bytes: Uint8Array): string {
    return this.commit(`/${path}`, bytes).rev;
  }

  remove(path: string): void {
    this.drop(`/${path}`.toLowerCase());
  }

  /** A device's fetch: its own faults, the shared Dropbox. */
  fetchFor(injector = new FaultInjector(seeded(Math.floor(this.random() * 2 ** 31)))): typeof fetch {
    injector.rates = this.faultRates;
    this.injectors.push(injector);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      if (this.yields) await yieldRandomly(this.random, this.yields);
      const failure = injector.before();
      if (failure) return failure;
      const res = await this.handle(String(input), init ?? {}, injector);
      if (this.yields) await yieldRandomly(this.random, this.yields);
      return res;
    }) as typeof fetch;
  }

  // ---------------------------------------------------------------- state

  private commit(display: string, bytes: Uint8Array): DbxFile {
    const lower = display.toLowerCase();
    const existing = this.files.get(lower);
    const f: DbxFile = {
      display: existing?.display ?? display,
      bytes: bytes.slice(),
      rev: `${(0x10000000 + ++this.revs).toString(16)}${Math.floor(this.random() * 0xfff).toString(16).padStart(3, "0")}`,
      modified: new Date(1_800_000_000_000 + this.revs * 1000).toISOString().replace(/\.\d+Z$/, "Z"),
      id: existing?.id ?? `id:${this.revs}`,
    };
    this.files.set(lower, f);
    this.record(lower, f);
    return f;
  }

  private drop(lower: string) {
    if (!this.files.delete(lower)) return;
    this.record(lower, null);
  }

  private record(lower: string, file: DbxFile | null) {
    this.events.push({ seq: ++this.seq, lower, file });
    if (!(this.faultRates.lag > 0 && this.random() < this.faultRates.lag)) this.visible = this.seq;
    this.wake();
  }

  private meta(f: DbxFile) {
    return { ".tag": "file", name: f.display.slice(f.display.lastIndexOf("/") + 1), path_display: f.display, path_lower: f.display.toLowerCase(), id: f.id, rev: f.rev, size: f.bytes.length, server_modified: f.modified, client_modified: f.modified };
  }

  /** Files as of the visible point. */
  private visibleState(): Map<string, DbxFile> {
    const state = new Map<string, DbxFile>();
    for (const e of this.events) {
      if (e.seq > this.visible) break;
      if (e.file) state.set(e.lower, e.file);
      else state.delete(e.lower);
    }
    return state;
  }

  // ---------------------------------------------------------------- requests

  private err(status: number, summary: string, error: unknown = {}) {
    return json(status, { error_summary: summary, error });
  }

  private async handle(url: string, init: RequestInit, injector: FaultInjector): Promise<Response> {
    const u = new URL(url);
    const route = u.pathname;
    this.routes.set(route, (this.routes.get(route) ?? 0) + 1);
    this.calls.push(`${u.host}${route}`);
    const headers = new Headers(init.headers);
    if (u.host === HOSTS.api && route === "/oauth2/token") return this.oauth.token(new URLSearchParams(await bodyText(init)));
    if (u.host === HOSTS.notify) {
      if (headers.has("authorization")) return new Response("Error in call to API function \"files/list_folder/longpoll\": Unexpected Authorization header", { status: 400 });
      return this.longpoll(JSON.parse(await bodyText(init)), init.signal ?? undefined);
    }
    const auth = this.oauth.check(headers.get("authorization"));
    if (auth !== "valid") return this.err(401, `${auth === "expired" ? "expired_access_token" : "invalid_access_token"}/`, { ".tag": auth === "expired" ? "expired_access_token" : "invalid_access_token" });
    if (u.host === HOSTS.api) {
      const arg = JSON.parse((await bodyText(init)) || "null");
      switch (route) {
        case "/2/auth/token/revoke":
          this.oauth.revokeToken(/^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? "");
          return json(200, null);
        case "/2/users/get_current_account":
          return json(200, this.account);
        case "/2/files/list_folder":
          return this.listFolder(arg);
        case "/2/files/list_folder/continue":
          return this.listContinue(arg.cursor);
        case "/2/files/get_metadata": {
          const f = this.files.get(String(arg.path).toLowerCase());
          return f ? json(200, this.meta(f)) : this.err(409, "path/not_found/", { ".tag": "path", path: { ".tag": "not_found" } });
        }
        case "/2/files/delete_v2": {
          const lower = String(arg.path).toLowerCase();
          const f = this.files.get(lower);
          if (!f) return this.err(409, "path_lookup/not_found/", { ".tag": "path_lookup", path_lookup: { ".tag": "not_found" } });
          if (arg.parent_rev !== undefined && arg.parent_rev !== f.rev) return this.err(409, "path_lookup/not_found/", { ".tag": "path_lookup", path_lookup: { ".tag": "not_found" } });
          this.drop(lower);
          return json(200, { metadata: this.meta(f) });
        }
      }
      return this.err(400, `unknown route ${route}`);
    }
    if (u.host === HOSTS.content) {
      const arg = JSON.parse(headers.get("dropbox-api-arg") ?? "null");
      switch (route) {
        case "/2/files/download": {
          const f = this.files.get(String(arg.path).toLowerCase());
          if (!f) return this.err(409, "path/not_found/", { ".tag": "path", path: { ".tag": "not_found" } });
          let bytes = f.bytes;
          if (bytes.length > 1 && injector.partial()) bytes = bytes.slice(0, Math.floor(bytes.length / 2));
          return new Response(bytes.slice(), { status: 200, headers: { "dropbox-api-result": JSON.stringify(this.meta(f)), "content-type": "application/octet-stream" } });
        }
        case "/2/files/upload":
          return this.write(arg, await bodyBytes(init));
        case "/2/files/upload_session/start": {
          const id = `s${this.sessions.size + 1}x${Math.floor(this.random() * 1e6)}`;
          const bytes = await bodyBytes(init);
          this.sessions.set(id, { bytes: [...bytes] });
          return json(200, { session_id: id });
        }
        case "/2/files/upload_session/append_v2":
        case "/2/files/upload_session/finish": {
          const s = this.sessions.get(arg.cursor?.session_id);
          if (!s) return this.err(409, "lookup_failed/not_found/", { ".tag": "lookup_failed", lookup_failed: { ".tag": "not_found" } });
          if (arg.cursor.offset !== s.bytes.length)
            return this.err(409, "lookup_failed/incorrect_offset/", { ".tag": "lookup_failed", lookup_failed: { ".tag": "incorrect_offset", correct_offset: s.bytes.length } });
          const chunk = await bodyBytes(init);
          if (chunk.length > 1 && injector.partial()) {
            s.bytes.push(...chunk.slice(0, Math.floor(chunk.length / 2)));
            throw new TypeError("fetch failed (connection reset mid-upload)");
          }
          s.bytes.push(...chunk);
          if (route.endsWith("append_v2")) return json(200, null);
          this.sessions.delete(arg.cursor.session_id);
          return this.write(arg.commit, new Uint8Array(s.bytes));
        }
      }
    }
    return this.err(400, `unknown route ${u.host}${route}`);
  }

  private write(commit: { path: string; mode: string | { ".tag": string; update?: string }; strict_conflict?: boolean; autorename?: boolean }, bytes: Uint8Array): Response {
    const lower = commit.path.toLowerCase();
    const existing = this.files.get(lower);
    const mode = typeof commit.mode === "string" ? commit.mode : commit.mode[".tag"];
    const identical = !!existing && existing.bytes.length === bytes.length && existing.bytes.every((b, i) => b === bytes[i]);
    const conflict = () => this.err(409, "path/conflict/file/..", { ".tag": "path", reason: { ".tag": "conflict", conflict: { ".tag": "file" } } });
    if (commit.autorename) return this.err(400, "this fake doesn't autorename");
    if (mode === "add" && existing) {
      if (identical && !commit.strict_conflict) return json(200, this.meta(existing));
      return conflict();
    }
    if (mode === "update") {
      const rev = typeof commit.mode === "string" ? "" : commit.mode.update;
      if (!existing) {
        if (commit.strict_conflict) return conflict();
      } else if (existing.rev !== rev) return conflict();
    }
    if (existing && identical) return json(200, this.meta(existing));
    const f = this.commit(commit.path, bytes);
    this.log.push(`write ${f.display} ${f.rev}`);
    return json(200, this.meta(f));
  }

  private cursorFor(seq: number): string {
    return `cur.${this.generation}.${seq}`;
  }

  /** The point a cursor stands for, or null when it's unknown or from before a reset. */
  private cursorSeq(cursor: string): number | null {
    const m = /^cur\.(\d+)\.(\d+)$/.exec(cursor);
    return m && Number(m[1]) === this.generation ? Number(m[2]) : null;
  }

  private listFolder(arg: { path: string; recursive?: boolean }): Response {
    if (arg.path !== "" || !arg.recursive) return this.err(400, "this fake lists the app folder recursively only");
    const all = [...this.visibleState().values()].sort((a, b) => (a.display < b.display ? -1 : 1));
    return this.page(all.map((f) => this.meta(f)), 0, this.visible);
  }

  /** Paged answers: the cursor encodes where the visible point was and how far in the page list we are. */
  private pages = new Map<string, { entries: unknown[]; at: number; seq: number }>();

  private page(entries: unknown[], from: number, seq: number): Response {
    const slice = entries.slice(from, from + this.pageSize);
    const more = from + this.pageSize < entries.length;
    let cursor = this.cursorFor(seq);
    if (more) {
      cursor = `${this.cursorFor(seq)}.p${this.pages.size + 1}`;
      this.pages.set(cursor, { entries, at: from + this.pageSize, seq });
    }
    return json(200, { entries: slice, cursor, has_more: more });
  }

  private listContinue(cursor: string): Response {
    const paged = this.pages.get(cursor);
    if (paged) {
      this.pages.delete(cursor);
      return this.page(paged.entries, paged.at, paged.seq);
    }
    const seq = this.cursorSeq(cursor);
    if (seq === null) return this.err(409, "reset/", { ".tag": "reset" });
    // Each path once, in its latest visible state.
    const changed = new Map<string, DbxEvent>();
    for (const e of this.events) if (e.seq > seq && e.seq <= this.visible) changed.set(e.lower, e);
    const entries = [...changed.values()].map((e) =>
      e.file ? this.meta(e.file) : { ".tag": "deleted", name: e.lower.slice(e.lower.lastIndexOf("/") + 1), path_lower: e.lower, path_display: e.lower },
    );
    return this.page(entries, 0, Math.max(seq, this.visible));
  }

  private async longpoll(arg: { cursor: string; timeout?: number }, signal?: AbortSignal): Promise<Response> {
    const seq = this.cursorSeq(arg.cursor);
    if (seq === null) return this.err(409, "reset/", { ".tag": "reset" });
    if (this.visible > seq) return json(200, { changes: true });
    return new Promise<Response>((resolve, reject) => {
      const done = () => {
        this.waiters.delete(wake);
        clearTimeout(timer);
      };
      const wake = () => {
        if (this.visible > seq) {
          done();
          resolve(json(200, { changes: true }));
        }
      };
      const timer = setTimeout(() => {
        done();
        resolve(json(200, { changes: false, backoff: 1 }));
      }, Math.min(1000, (arg.timeout ?? 30) * 1000));
      this.waiters.add(wake);
      signal?.addEventListener("abort", () => {
        done();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  }
}

/** The sim's view (packages/local-store/test/sim.ts SimCloud) of a fake provider whose devices mount LocalFs. */
export interface ProviderSimCloud {
  mount(name: string): LocalFs;
  settle(): void;
  step(): boolean;
  readonly pending: number;
  faults: { delay: number; duplicate: number; stale: number; truncate: number; loseUpdate: number };
  cloudFile(path: string): Uint8Array | undefined;
  cloudPaths(): string[];
  readonly log: string[];
}

/** Maps the sim's folder faults onto API faults: delay → lagging listings, duplicate → 429, stale → 5xx, truncate → cut-off transfers. */
export function apiFaults(f: { delay: number; duplicate: number; stale: number; truncate: number; loseUpdate: number }): FakeFaultRates {
  return { lag: f.delay, rateLimit: f.duplicate, serverError: f.stale, partial: f.truncate, network: f.loseUpdate / 3 };
}
