// Local mode in Playwright (docs/LOCAL_MODE_PLAN.md §4.1, §5.4, WP8a).
//
// Two Playwright projects (playwright.config.ts):
// - `account`: every spec, as before: the website, signed in.
// - `local`: only specs tagged `@both` (or `@local`), with a FakeShell in every page and a network guard
//   that fails the test if the page contacts Folevi's servers or Convex.
//
// The FakeShell implements the bridge contract (`FoleviShell`, lib/shell/types.ts) in the page: the
// library is a folder in the origin private file system (OPFS), so files survive a reload, and two tabs
// share it the way two windows share a real library. It's installed as `window.__foleviTestShell`, a
// development-only test hook like `window.__foleviTestRecognizer`: lib/shell's `shell()` reads it only
// when `process.env.NODE_ENV !== "production"`, so production builds never honour it.
//
// Writing a spec for both modes:
//   import { expect, test } from "./fixtures/localShell";
//   test("a note keeps its title", { tag: "@both" }, async ({ page, backendMode }) => { ... });
// `backendMode` says which project runs it. A spec that makes its own contexts (`browser.newContext()`)
// calls `prepareContext(context, testInfo)` on each, so the shell and the guard are there too.
import { test as base, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import type { FoleviShell } from "../../src/lib/shell/types";
import { convexUrl } from "../helpers";

export type BackendMode = "account" | "local";

export interface BackendModeOptions {
  /** Which mode the project runs specs in. Set per project in playwright.config.ts. */
  backendMode: BackendMode;
}

export interface FakeShellConfig {
  /** What `initialMode` says on the first load (later loads read what `setMode` saved). */
  initialMode: "unset" | "local" | "account";
  /** The OPFS folder the library lives in. */
  libraryName: string;
  platform: "mac" | "ios";
  /** Bookmark previews `http.preview` answers with, by URL. */
  previews?: Record<string, string>;
}

/** One entry in `window.__foleviTestShellLog`: a bridge call a test can assert on. */
export interface FakeShellCall {
  call: string;
  detail?: unknown;
}

/** Test controls in the page: changes "from another device" and what the bridge was asked to do. */
export interface FakeShellControl {
  ready: Promise<void>;
  log: FakeShellCall[];
  /** Writes a file the way another device's sync would, and tells watchers. */
  externalWrite(path: string, bytes: Uint8Array): Promise<string>;
  externalRemove(path: string): Promise<void>;
  /** Makes a file a cloud placeholder (list says downloaded: false, read says notDownloaded). */
  markNotDownloaded(path: string): void;
  addConflictVersion(path: string, bytes: Uint8Array): string;
  /** The values set through `secrets.set` (the page can't read them back; tests can). */
  secretValue(name: string): string | undefined;
}

declare global {
  interface Window {
    __foleviTestShell?: FoleviShell;
    __foleviTestShellControl?: FakeShellControl;
  }
}

/**
 * Runs in the page before any of its scripts (context.addInitScript), so it must not refer to anything
 * outside itself.
 */
function installFakeShell(cfg: FakeShellConfig) {
  if (window.__foleviTestShell) return;
  const META_KEY = `folevi-fake-shell:${cfg.libraryName}`;
  type Meta = {
    mode?: "local" | "account";
    library?: { kind: "icloud" | "folder" | "device" };
    passphrase?: string | null;
    lock?: { lock: boolean; lockAfter: number };
    secrets?: string[];
  };
  const readMeta = (): Meta => {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) ?? "{}") as Meta;
    } catch {
      return {};
    }
  };
  const writeMeta = (patch: Partial<Meta>) => {
    const next = { ...readMeta(), ...patch };
    try {
      localStorage.setItem(META_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable; the shell keeps working for this page.
    }
    return next;
  };

  const log: FakeShellCall[] = [];
  const record = (call: string, detail?: unknown) => log.push(detail === undefined ? { call } : { call, detail });
  const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`FakeShell: ${message}`), { code, ...extra });

  // ---- paths (§4.1: relative, forward slashes, no "..", no leading slash, no control characters) ----
  const parts = (path: string, allowRoot = false): string[] => {
    if (typeof path !== "string") throw fail("invalid_path", "a path must be a string");
    const trimmed = path.replace(/\/+$/, "");
    if (trimmed === "" && allowRoot) return [];
    if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\") || /[\u0000-\u001f\u007f]/.test(trimmed)) throw fail("invalid_path", `invalid path ${JSON.stringify(path)}`);
    const out = trimmed.split("/");
    if (out.some((p) => p === "" || p === "." || p === "..")) throw fail("invalid_path", `invalid path ${JSON.stringify(path)}`);
    return out;
  };

  // ---- OPFS ----
  const opfsRoot = async () => {
    const root = await navigator.storage.getDirectory();
    const shellDir = await root.getDirectoryHandle("folevi-fake-shell", { create: true });
    return shellDir;
  };
  const libraryRoot = async () => (await opfsRoot()).getDirectoryHandle(cfg.libraryName, { create: true });
  const journalRoot = async () => (await opfsRoot()).getDirectoryHandle(`${cfg.libraryName}.journal`, { create: true });
  const dirAt = async (segments: string[], create: boolean) => {
    let dir = await libraryRoot();
    for (const s of segments) dir = await dir.getDirectoryHandle(s, { create });
    return dir;
  };
  const fileAt = async (path: string, create: boolean) => {
    const p = parts(path);
    const dir = await dirAt(p.slice(0, -1), create);
    return await dir.getFileHandle(p[p.length - 1]!, { create });
  };
  const isMissing = (error: unknown) => error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
  const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const etagOf = async (bytes: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)).slice(0, 32);
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    try {
      const file = await (await fileAt(path, false)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };
  const currentEtag = async (path: string) => {
    const bytes = await readBytes(path);
    return bytes ? await etagOf(bytes) : null;
  };
  const writeBytes = async (path: string, bytes: Uint8Array) => {
    const handle = await fileAt(path, true);
    const w = await handle.createWritable();
    await w.write(bytes as Uint8Array<ArrayBuffer>);
    await w.close();
  };
  // Check-and-write is atomic across tabs (Web Locks), as the native layer's coordinated writes are.
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => (navigator.locks ? navigator.locks.request(`folevi-fake-shell:${cfg.libraryName}`, fn) : fn());

  // ---- watchers (this page's own writes too, like FSEvents; other tabs through a BroadcastChannel) ----
  type Change = { path: string; kind: "changed" | "removed" | "downloaded" | "uploaded" };
  const watchers = new Set<(changes: Change[]) => void>();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(`folevi-fake-shell:${cfg.libraryName}`) : null;
  const deliver = (changes: Change[]) => {
    for (const w of watchers) {
      try {
        w(changes);
      } catch (error) {
        console.error("[FakeShell] a watcher threw", error);
      }
    }
  };
  channel?.addEventListener("message", (e: MessageEvent<Change[]>) => deliver(e.data));
  const emit = (changes: Change[]) => {
    setTimeout(() => deliver(changes), 0);
    channel?.postMessage(changes);
  };

  // ---- attachment URLs (fileUrl is synchronous: object URLs for files this page has seen) ----
  const urls = new Map<string, string>();
  const rememberFile = (path: string, bytes: Uint8Array) => {
    const m = /^files\/[0-9a-f]{2}\/([0-9a-f]{64})$/.exec(path);
    if (m) urls.set(m[1]!, URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])));
  };

  const placeholders = new Set<string>();
  const conflicts = new Map<string, { id: string; bytes: Uint8Array }[]>();
  const secretValues = new Map<string, string>();
  const scheduled = new Map<string, unknown>();
  let unlocked = false;

  const info = () => {
    const meta = readMeta();
    const encrypted = typeof meta.passphrase === "string";
    return { kind: meta.library?.kind ?? "device", displayPath: `Test library (${cfg.libraryName})`, available: true, encrypted, locked: encrypted && !unlocked };
  };

  const listFiles = async (dirParts: string[]) => {
    const out: { path: string; size: number; mtimeMs: number; etag: string; downloaded: boolean; hasConflicts: boolean }[] = [];
    let start: FileSystemDirectoryHandle;
    try {
      start = await dirAt(dirParts, false);
    } catch (error) {
      if (isMissing(error)) return out;
      throw error;
    }
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") {
          if (name !== ".folevi-tmp") await walk(handle as FileSystemDirectoryHandle, path);
          continue;
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        out.push({ path, size: bytes.length, mtimeMs: file.lastModified, etag: await etagOf(bytes), downloaded: !placeholders.has(path), hasConflicts: (conflicts.get(path)?.length ?? 0) > 0 });
      }
    };
    await walk(start, dirParts.join("/"));
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  };

  const journalNames = async () => {
    const names: string[] = [];
    for await (const [name] of ((await journalRoot()) as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) names.push(name);
    return names.sort();
  };

  const library: FoleviShell["library"] = {
    async setup({ kind }) {
      record("library.setup", { kind });
      writeMeta({ library: { kind } });
      return info();
    },
    async info() {
      return info();
    },
    async list(dir) {
      return await listFiles(parts(dir, true));
    },
    async read(path) {
      parts(path);
      if (placeholders.has(path)) return { notDownloaded: true };
      const bytes = await readBytes(path);
      if (!bytes) throw fail("not_found", `no file ${path}`);
      rememberFile(path, bytes);
      return { bytes, etag: await etagOf(bytes) };
    },
    async write(path, bytes, o) {
      parts(path);
      return await exclusive(async () => {
        if (o && o.ifMatch !== undefined) {
          const now = await currentEtag(path);
          if (o.ifMatch === null ? now !== null : now !== o.ifMatch) return { mismatch: true as const, etag: now ?? "" };
        }
        await writeBytes(path, bytes);
        rememberFile(path, bytes);
        placeholders.delete(path);
        const etag = await etagOf(bytes);
        emit([{ path, kind: "changed" }]);
        return { etag };
      });
    },
    async remove(path, o) {
      const p = parts(path);
      await exclusive(async () => {
        if (o?.ifMatch !== undefined) {
          const now = await currentEtag(path);
          if (now !== o.ifMatch) throw fail("mismatch", `${path} changed`, { etag: now ?? "" });
        }
        try {
          await (await dirAt(p.slice(0, -1), false)).removeEntry(p[p.length - 1]!);
        } catch (error) {
          if (!isMissing(error)) throw error;
          return;
        }
        emit([{ path, kind: "removed" }]);
      });
    },
    async conflictVersions(path) {
      parts(path);
      return [...(conflicts.get(path) ?? [])];
    },
    async resolveConflicts(path, ids) {
      parts(path);
      conflicts.set(path, (conflicts.get(path) ?? []).filter((v) => !ids.includes(v.id)));
    },
    async startDownload(paths) {
      const done = paths.filter((p) => placeholders.delete(p));
      if (done.length) emit(done.map((path) => ({ path, kind: "downloaded" as const })));
    },
    watch(cb) {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },
    journal: {
      async append(r) {
        await exclusive(async () => {
          const names = await journalNames();
          const next = names.length ? Number(names[names.length - 1]) + 1 : 1;
          const handle = await (await journalRoot()).getFileHandle(String(next).padStart(12, "0"), { create: true });
          const w = await handle.createWritable();
          await w.write(r as Uint8Array<ArrayBuffer>);
          await w.close();
        });
      },
      async readAll() {
        const dir = await journalRoot();
        const out: Uint8Array[] = [];
        for (const name of await journalNames()) out.push(new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()));
        return out;
      },
      /** Drops the first `n` records (the ones the library files now hold). */
      async truncate(n) {
        await exclusive(async () => {
          const dir = await journalRoot();
          for (const name of (await journalNames()).slice(0, Math.max(0, n))) await dir.removeEntry(name);
        });
      },
    },
    async unlock(passphrase) {
      record("library.unlock");
      const ok = readMeta().passphrase === passphrase;
      if (ok) unlocked = true;
      return ok;
    },
    async setPassphrase(p) {
      record("library.setPassphrase", { on: p !== null });
      writeMeta({ passphrase: p });
      unlocked = p !== null;
    },
    async changePassphrase(oldPassphrase, newPassphrase) {
      record("library.changePassphrase");
      if (readMeta().passphrase !== oldPassphrase) return false;
      writeMeta({ passphrase: newPassphrase });
      return true;
    },
    fileUrl(sha256) {
      return urls.get(sha256) ?? `about:blank#folevi-fake-shell-missing-${sha256}`;
    },
    async move({ kind }) {
      record("library.move", { kind });
      writeMeta({ library: { kind } });
      return info();
    },
  };

  const fake: FoleviShell = {
    platform: cfg.platform,
    shellVersion: "0.0.0-test",
    initialMode: readMeta().mode ?? cfg.initialMode,
    async setMode(m) {
      record("setMode", { mode: m });
      writeMeta({ mode: m });
    },
    library,
    secrets: {
      async has(name) {
        return secretValues.has(name) || (readMeta().secrets ?? []).includes(name);
      },
      async set(name, value) {
        record("secrets.set", { name });
        secretValues.set(name, value);
        writeMeta({ secrets: [...new Set([...(readMeta().secrets ?? []), name])] });
      },
      async delete(name) {
        record("secrets.delete", { name });
        secretValues.delete(name);
        writeMeta({ secrets: (readMeta().secrets ?? []).filter((n) => n !== name) });
      },
    },
    auth: {
      async signIn() {
        record("auth.signIn");
        return false;
      },
      async signOut() {
        record("auth.signOut");
      },
      async fetch(path) {
        record("auth.fetch", { path });
        throw fail("local_mode", "there is no Folevi account in a local-mode test");
      },
      async convexToken() {
        return null;
      },
    },
    ai: {
      async capabilities() {
        const keys = readMeta().secrets ?? [];
        return { onDevice: false, keys: { "ai.openai": keys.includes("ai.openai"), "ai.anthropic": keys.includes("ai.anthropic"), "ai.google": keys.includes("ai.google") } };
      },
      generate(req) {
        record("ai.generate", { provider: req.provider });
        return { done: Promise.resolve({ text: "", stopReason: "error" as const, error: "FakeShell has no AI model" }), cancel() {} };
      },
    },
    lock: {
      async getSettings() {
        const l = readMeta().lock ?? { lock: false, lockAfter: 0 };
        return { ...l, method: "none" as const };
      },
      async setSettings(patch) {
        record("lock.setSettings", patch);
        const l = { ...(readMeta().lock ?? { lock: false, lockAfter: 0 }), ...patch };
        writeMeta({ lock: l });
        return { ...l, method: "none" as const };
      },
    },
    notify: {
      async schedule(n) {
        record("notify.schedule", n);
        scheduled.set(n.id, n);
      },
      async cancel(id) {
        record("notify.cancel", { id });
        scheduled.delete(id);
      },
    },
    files: {
      async save(name, bytes) {
        record("files.save", { name, size: bytes.length });
        return true;
      },
    },
    http: {
      async preview(url) {
        record("http.preview", { url });
        if (/(^|\.)folevi\.com$/.test(new URL(url).hostname)) return null;
        return cfg.previews?.[url] ?? null;
      },
    },
  };

  const control: FakeShellControl = {
    ready: (async () => {
      // Object URLs for the attachments already in the library, so fileUrl answers after a reload.
      try {
        for (const entry of await listFiles(["files"])) {
          const bytes = await readBytes(entry.path);
          if (bytes) rememberFile(entry.path, bytes);
        }
      } catch (error) {
        console.error("[FakeShell] couldn't read the library", error);
      }
    })(),
    log,
    async externalWrite(path, bytes) {
      parts(path);
      return await exclusive(async () => {
        await writeBytes(path, bytes);
        rememberFile(path, bytes);
        emit([{ path, kind: "changed" }]);
        return await etagOf(bytes);
      });
    },
    async externalRemove(path) {
      await library.remove(path);
    },
    markNotDownloaded(path) {
      parts(path);
      placeholders.add(path);
    },
    addConflictVersion(path, bytes) {
      parts(path);
      const id = `conflict-${(conflicts.get(path)?.length ?? 0) + 1}`;
      conflicts.set(path, [...(conflicts.get(path) ?? []), { id, bytes }]);
      return id;
    },
    secretValue(name) {
      return secretValues.get(name);
    },
  };

  Object.defineProperty(window, "__foleviTestShell", { value: fake, configurable: false, writable: false });
  Object.defineProperty(window, "__foleviTestShellControl", { value: control, configurable: false, writable: false });
}

/** Requests local mode must never make (§5.4): Folevi's servers, Convex, and the app server's own API. */
export class NetworkGuard {
  readonly violations: string[] = [];

  /** Forgets what was caught (after a test made a request on purpose to check the guard). */
  clear() {
    this.violations.length = 0;
  }

  async install(context: BrowserContext, appOrigin: string | undefined) {
    const block = async (route: import("@playwright/test").Route) => {
      this.violations.push(`${route.request().method()} ${route.request().url()}`);
      await route.abort("blockedbyclient");
    };
    const patterns: (string | RegExp)[] = ["**/*.folevi.com/**", "**/folevi.com/**", "**/*.convex.*/**"];
    // The Convex deployment the app is configured with, wherever it is (a local backend in CI).
    const convex = new URL(convexUrl());
    patterns.push(`${convex.origin}/**`);
    // The page's own server stands in for the app:// origin; its API is Folevi's server.
    if (appOrigin) patterns.push(`${new URL(appOrigin).origin}/api/**`);
    for (const p of patterns) await context.route(p, block);
    const wsHosts = new RegExp(`folevi\\.com|\\.convex\\.|${convex.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    await context.routeWebSocket(wsHosts, (ws) => {
      this.violations.push(`WS ${ws.url()}`);
      void ws.close({ code: 1008, reason: "local mode must not open this" });
    });
  }
}

/** The FakeShell and the network guard on a context the spec made itself (they're on `context` already). */
export async function prepareContext(context: BrowserContext, testInfo: TestInfo, opts: Partial<FakeShellConfig> = {}): Promise<NetworkGuard | null> {
  const mode = (testInfo.project.use as Partial<BackendModeOptions>).backendMode ?? "account";
  if (mode !== "local") return null;
  const cfg: FakeShellConfig = { initialMode: "local", libraryName: "library", platform: "mac", ...opts };
  await context.addInitScript(installFakeShell, cfg);
  const guard = new NetworkGuard();
  await guard.install(context, testInfo.project.use.baseURL);
  thisTest.push(guard);
  return guard;
}

/** The guards of the running test (a worker runs one test at a time), checked when it ends. */
const thisTest: NetworkGuard[] = [];

export interface LocalShellFixture {
  /** Null in the account project. */
  guard: NetworkGuard | null;
  /** Reads a library file as text, from the page's OPFS. */
  readText(page: Page, path: string): Promise<string | null>;
  /** Writes a library file as another device would (watchers are told). */
  writeExternal(page: Page, path: string, text: string): Promise<string>;
  /** Library paths under `dir` ("" for all). */
  list(page: Page, dir?: string): Promise<string[]>;
  /** The bridge calls the page made (setMode, notify.schedule, files.save, ...). */
  calls(page: Page): Promise<FakeShellCall[]>;
}

export const test = base.extend<BackendModeOptions & { localShell: LocalShellFixture }>({
  backendMode: ["account", { option: true }],
  localShell: [
    async ({ context, backendMode }, use, testInfo) => {
      thisTest.length = 0;
      const guard = backendMode === "local" ? await prepareContext(context, testInfo) : null;
      await use({
        guard,
        readText: (page, path) =>
          page.evaluate(async (p) => {
            await window.__foleviTestShellControl!.ready;
            const r = await window.__foleviTestShell!.library.read(p).catch(() => null);
            return r && "bytes" in r ? new TextDecoder().decode(r.bytes) : null;
          }, path),
        writeExternal: (page, path, text) => page.evaluate(([p, t]) => window.__foleviTestShellControl!.externalWrite(p, new TextEncoder().encode(t)), [path, text] as const),
        list: (page, dir = "") => page.evaluate(async (d) => (await window.__foleviTestShell!.library.list(d)).map((e) => e.path), dir),
        calls: (page) => page.evaluate(() => window.__foleviTestShellControl!.log.slice()),
      });
      // The default context's guard and those of contexts the spec made with prepareContext.
      const violations = thisTest.flatMap((g) => g.violations);
      thisTest.length = 0;
      expect(violations, "local mode contacted Folevi's servers or Convex").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
