// Folevi for Android's library host for the parity harness (docs/ANDROID_PLAN.md "Local mode", the "Android-like
// driver"): the app's real bridge script (apps/android/android/app/src/main/assets/folevi-bridge.js) and its
// cloud half (apps/android/bridge), evaluated here with a stand-in for the app's Kotlin side that keeps the same
// rules as LibraryPlugin.kt and FolderFs.kt (path checks, etags that change on every write, create-only and
// compare-and-swap writes, conditional removes, the journal, base64 bytes, chunked uploads), and, for a library
// on Dropbox, CloudPlugin.kt's requests answered by the Mac's fake Dropbox. LibraryStore then runs over
// `foleviShell.library` exactly as it does in the app.
import { createCloudKit, copyLibrary, prepareLibrary, isCloudKind, KIND_PROVIDER, LIBRARY_FILE } from "../../../apps/android/bridge/cloud";
import bridgeSource from "../../../apps/android/android/app/src/main/assets/folevi-bridge.js?raw";
import { FakeDropbox } from "../../../apps/desktop/test/cloud/fakeDropbox";

const b64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

class NativeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const validPath = (p: string) =>
  p.length > 0 && p.length <= 1024 && !p.startsWith("/") && !p.endsWith("/") && !p.includes("\\") && !/[\u0000-\u001f\u007f]/.test(p) && p.split("/").every((x) => x && x !== "." && x !== "..");
function check(p: unknown): string {
  if (typeof p !== "string" || !validPath(p)) throw new NativeError("invalid_path", `Invalid library path: ${String(p)}`, { path: p });
  return p;
}

/** FolderFs.kt in memory: every write makes a new etag (Kotlin's size, modification time and file identity). */
class MemoryFolder {
  readonly files = new Map<string, { bytes: Uint8Array; etag: string }>();
  private n = 0;
  list(dir: string) {
    if (dir !== "") check(dir);
    return [...this.files.entries()]
      .filter(([p]) => dir === "" || p.startsWith(`${dir}/`))
      .map(([path, f]) => ({ path, size: f.bytes.length, mtimeMs: 0, etag: f.etag, downloaded: true, hasConflicts: false }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  read(path: string) {
    const f = this.files.get(check(path));
    if (!f) throw new NativeError("not_found", `No such file: ${path}`, { path });
    return { data: b64(f.bytes), etag: f.etag };
  }
  write(path: string, bytes: Uint8Array, cond: { kind: "any" } | { kind: "create" } | { kind: "etag"; etag: string }) {
    const now = this.files.get(check(path))?.etag ?? null;
    if (cond.kind === "create" && now !== null) return { mismatch: true, etag: now };
    if (cond.kind === "etag" && now !== cond.etag) return { mismatch: true, etag: now ?? "" };
    const etag = `${bytes.length.toString(36)}-${(++this.n).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.files.set(path, { bytes: bytes.slice(), etag });
    return { etag };
  }
  remove(path: string, ifMatch?: string) {
    const f = this.files.get(check(path));
    if (!f) return;
    if (ifMatch !== undefined && f.etag !== ifMatch) throw new NativeError("mismatch", `${path} changed since it was read.`, { path });
    this.files.delete(path);
  }
}

/** The app's Kotlin side for one phone. */
export class FakeAndroid {
  kind: string | null = null;
  libraryId: string | null = null;
  readonly device = new MemoryFolder();
  readonly mirror = new Map<string, { bytes: Uint8Array; etag: string }>();
  mirrorState: string | null = null;
  readonly journal: Uint8Array[] = [];
  private uploads = new Map<string, Uint8Array[]>();
  dropbox: FakeDropbox | null = null;
  private token: string | null = null;
  calls = 0;

  private bytes(args: Record<string, unknown>): Uint8Array {
    if (typeof args.upload === "string") {
      const parts = this.uploads.get(args.upload) ?? [];
      this.uploads.delete(args.upload);
      const total = parts.reduce((n, p) => n + p.length, 0);
      if (total !== args.size) throw new NativeError("invalid_argument", "That upload is incomplete.");
      const out = new Uint8Array(total);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    }
    return unb64(String(args.data ?? ""));
  }

  private fs(args: Record<string, unknown>): MemoryFolder {
    const root = args.root ?? "library";
    if (root === "device") return this.device;
    if (root === "library") {
      if (this.kind !== "device") throw new NativeError("not_set_up", "There's no library on this phone yet.");
      return this.device;
    }
    throw new NativeError("invalid_argument", "Unknown library root.");
  }

  info() {
    if (!this.kind) return { kind: "device", displayPath: "", available: false, encrypted: false, locked: false, configured: false };
    if (this.kind !== "device") return { kind: this.kind, configured: true };
    return { kind: "device", displayPath: "Folevi's storage on this phone", available: this.device.files.has(LIBRARY_FILE), encrypted: false, locked: false, configured: true };
  }

  async answer(plugin: string, method: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls++;
    if (plugin === "FoleviLibrary") {
      switch (method) {
        case "chunk": {
          const list = this.uploads.get(String(args.upload)) ?? [];
          if (list.reduce((n, p) => n + p.length, 0) !== args.offset) throw new NativeError("invalid_argument", "A piece arrived out of order.");
          list.push(unb64(String(args.data)));
          this.uploads.set(String(args.upload), list);
          return {};
        }
        case "setup": {
          if (args.kind !== "device") throw new NativeError("unavailable", "Connect first.");
          if (!this.device.files.has(LIBRARY_FILE)) {
            const m = { format: "folevi-library", v: 1, libraryId: `01ANDROID${Math.random().toString(36).slice(2, 12).toUpperCase()}`.slice(0, 26), createdAt: Date.now(), minWriterVersion: 1, encryption: null };
            this.device.write(LIBRARY_FILE, new TextEncoder().encode(`${JSON.stringify(m, null, 2)}\n`), { kind: "create" });
          }
          this.kind = "device";
          this.libraryId = JSON.parse(new TextDecoder().decode(this.device.files.get(LIBRARY_FILE)!.bytes)).libraryId;
          return { info: this.info() };
        }
        case "setState":
          this.kind = String(args.kind);
          this.libraryId = String(args.libraryId);
          return {};
        case "info":
          return this.info();
        case "list":
          return { entries: this.fs(args).list(String(args.dir ?? "")) };
        case "read":
          return this.fs(args).read(String(args.path));
        case "write": {
          const cond = !args.hasIfMatch ? ({ kind: "any" } as const) : args.ifMatch === null ? ({ kind: "create" } as const) : ({ kind: "etag", etag: String(args.ifMatch) } as const);
          return this.fs(args).write(check(args.path), this.bytes(args), cond);
        }
        case "remove":
          this.fs(args).remove(String(args.path), typeof args.ifMatch === "string" ? args.ifMatch : undefined);
          return {};
        case "conflictVersions":
          check(args.path);
          return { versions: [] };
        case "resolveConflicts":
        case "startDownload":
        case "unwatch":
          return {};
        case "journalAppend":
          this.journal.push(this.bytes(args));
          return {};
        case "journalRead":
          return { records: this.journal.map(b64) };
        case "journalTruncate":
          this.journal.splice(0, Number(args.count) || 0);
          return {};
        case "mirrorRead": {
          const f = this.mirror.get(check(args.path));
          return f ? { data: b64(f.bytes), etag: f.etag } : { missing: true };
        }
        case "mirrorWrite":
          this.mirror.set(check(args.path), { bytes: this.bytes(args), etag: String(args.etag) });
          return {};
        case "mirrorDelete":
          this.mirror.delete(check(args.path));
          return {};
        case "mirrorPaths":
          return { paths: [...this.mirror.keys()].sort() };
        case "mirrorLoadState":
          return { state: this.mirrorState };
        case "mirrorSaveState":
          this.mirrorState = String(args.state);
          return {};
      }
    }
    if (plugin === "FoleviCloud") {
      if (method === "status") return { available: ["dropbox"], provider: this.dropbox ? "dropbox" : null, state: this.dropbox ? "connected" : "none", account: null };
      if (method === "request") {
        const fake = this.dropbox;
        if (!fake) throw new NativeError("reconnect", "Dropbox isn't connected.");
        this.token ??= fake.oauth.issue().access_token;
        const url = new URL(String(args.url));
        const hosts = args.authorized ? ["api.dropboxapi.com", "content.dropboxapi.com"] : ["notify.dropboxapi.com"];
        if (url.protocol !== "https:" || !hosts.includes(url.hostname)) throw new NativeError("invalid", "Folevi only talks to Dropbox from here.");
        const headers = new Headers(args.headers as Record<string, string>);
        headers.delete("authorization");
        if (args.authorized) headers.set("authorization", `Bearer ${this.token}`);
        const res = await fake.fetchFor()(String(args.url), { method: String(args.method), headers, body: typeof args.body === "string" ? unb64(args.body) : undefined });
        const out: Record<string, string> = {};
        res.headers.forEach((v, k) => (out[k] = v));
        return { status: res.status, headers: out, body: b64(new Uint8Array(await res.arrayBuffer())) };
      }
    }
    throw new NativeError("unimplemented", `${plugin}.${method} isn't on this stand-in.`);
  }
}

/** A document just enough for the bridge script's start (it marks <html> and watches the page). */
function fakeDocument() {
  const el = () => ({
    dataset: {} as Record<string, string>,
    style: { setProperty() {} },
    setAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    addEventListener() {},
  });
  return {
    readyState: "complete",
    documentElement: el(),
    body: el(),
    styleSheets: [],
    activeElement: null,
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

/** `window.foleviShell` as the Android app's bridge defines it, over a FakeAndroid. */
export function androidShell(native: FakeAndroid, mode: "local" | "account" = "local") {
  const win: Record<string, unknown> = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    matchMedia: () => ({ matches: false }),
    Capacitor: {
      nativePromise: (plugin: string, method: string, args: Record<string, unknown>) =>
        native.answer(plugin, method, args ?? {}).catch((e: unknown) => {
          const err = e instanceof NativeError ? e : new NativeError("io", (e as Error)?.message ?? "failed");
          throw Object.assign(new Error(err.message), { code: err.code, data: { ...err.data, code: err.code } });
        }),
      nativeCallback: () => "cb1",
    },
  };
  const location = { origin: "https://localhost", pathname: "/documents" };
  class NoObserver {
    observe() {}
  }
  const kit = { createCloudKit, copyLibrary, prepareLibrary, isCloudKind, KIND_PROVIDER, LIBRARY_FILE };
  const boot = { origin: "https://localhost", mode, version: "1.0.0", deviceName: "Pixel 9", webViewVersion: "140.0.0.0", insets: null };
  const src = (bridgeSource as string).trim().replace(/;$/, "");
  const run = new Function("window", "document", "location", "history", "MutationObserver", "navigator", "getComputedStyle", "requestAnimationFrame", "console", `return (\n${src}\n);`);
  const fn = run(win, fakeDocument(), location, { pushState() {}, replaceState() {}, length: 1 }, NoObserver, {}, () => ({}), (cb: () => void) => setTimeout(cb, 0), console) as (boot: unknown, kit: unknown) => void;
  fn(boot, kit);
  const shell = win.foleviShell as { library: Record<string, unknown> & { setup(o: { kind: string }): Promise<unknown> }; platform: string };
  if (!shell || shell.platform !== "android") throw new Error("the Android bridge didn't define foleviShell");
  return shell;
}
