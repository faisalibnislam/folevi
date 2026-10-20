// What the web page gets from the Mac app: `window.foleviDesktop`, a few calls that reach the main process,
// and, in the interface built into the app (app://folevi), `window.foleviShell` (docs/LOCAL_MODE_PLAN.md §4.1;
// its types are apps/web/src/lib/shell/types.ts). No Node, no Electron objects (the page runs sandboxed); the
// main process checks every call comes from Folevi's own pages.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Command = { type: "navigate"; path: string } | { type: "new-note" } | { type: "quick-add-shown" };

const bridge = {
  platform: "mac" as const,
  /** getDisplayMedia answers with this Mac's sound (main.ts), so the recorder can record both sides of a call. */
  callCapture: true,
  /** Whether macOS lets Folevi record the screen and its sound: "granted", "denied"… */
  screenAccess: () => ipcRenderer.invoke("desktop:screen-access"),
  /** Opens System Settings at a privacy pane (only Screen & System Audio Recording, for recording calls). */
  openSystemSettings: (pane: "screen-recording") => ipcRenderer.send("desktop:system-settings", pane),
  /** The number on the Dock icon (unread notifications); 0 clears it. */
  setBadge: (count: number) => ipcRenderer.send("desktop:badge", count),
  /** A Mac notification; clicking it brings Folevi forward at `path`. */
  notify: (n: { id: string; title: string; body?: string | null; path?: string | null }) => ipcRenderer.send("desktop:notify", n),
  /** The notes the menu bar icon lists. */
  setRecent: (notes: { id: string; title: string }[]) => ipcRenderer.send("desktop:recent", notes),
  /** The save state the menu bar menu shows ("All changes saved"). */
  setStatus: (text: string) => ipcRenderer.send("desktop:status", text),
  getSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("desktop:set-settings", patch),
  /** Where the page keeps room for the window buttons (its top bar moves with the sidebar): they go there. */
  placeWindowButtons: (spot: { x: number; y: number; height: number }) => ipcRenderer.send("desktop:window-buttons", spot),
  /** While Settings records a new shortcut, the current one stays quiet (it would open Quick Add instead). */
  pauseShortcut: (paused: boolean) => ipcRenderer.send("desktop:pause-shortcut", paused),
  /** Quick Add window: done (or Escape), and its height as drawn. */
  closeQuickAdd: () => ipcRenderer.send("desktop:quick-add-close"),
  sizeQuickAdd: (height: number) => ipcRenderer.send("desktop:quick-add-size", height),
  /** Starts dragging a note out of the app as a Markdown file (call from a dragstart, after preventDefault). */
  dragFile: (file: { name: string; text: string }) => ipcRenderer.send("desktop:drag-file", file),
  /** Signs in with Google in the default browser: answers with the folevi://auth/google link it ends on, or null. */
  signInInBrowser: (url: string) => ipcRenderer.invoke("desktop:sign-in", url) as Promise<string | null>,
  /** The words in an image, read on this Mac with Vision (search in files): { text }, or null. */
  recognizeText: (image: Uint8Array, handwriting = false) => ipcRenderer.invoke("desktop:recognize-text", image, handwriting) as Promise<{ text: string } | null>,
  /** Opens a path in the main window and brings it forward (from Quick Add). */
  openInMain: (path: string) => ipcRenderer.send("desktop:open", path),
  /** Menu, menu bar and notification commands for the page; returns the function that stops listening. */
  onCommand: (listener: (command: Command) => void) => {
    const handler = (_e: IpcRendererEvent, command: Command) => listener(command);
    ipcRenderer.on("desktop:command", handler);
    return () => {
      ipcRenderer.removeListener("desktop:command", handler);
    };
  },
};

contextBridge.exposeInMainWorld("foleviDesktop", bridge);

// ---------------------------------------------------------------- foleviShell (the bundled interface only)

type ShellMode = "unset" | "local" | "account";
type Bootstrap = { shell: false } | { shell: true; mode: ShellMode; version: string };

/**
 * A part of the bridge that later work fills in (the library layer, the Keychain, sign-in, Foli AI on this
 * Mac): until then it says so clearly instead of doing nothing.
 */
const notYet = (what: string, comes: string) => () => Promise.reject(new Error(`foleviShell.${what} isn't in this build of Folevi for Mac yet (${comes}).`));

/** One library call (src/library/ipc.ts): its value, or a rejection carrying the library's error code. */
async function lib<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(`library:${name}`, ...args)) as { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; path?: string } } | null;
  if (r && r.ok) return r.value as T;
  const error = r && !r.ok ? r.error : { code: "io", message: "Folevi couldn't reach its library." };
  throw { name: "LocalFsError", code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}) };
}
let libraryWatchers = 0;
/** Foli AI requests started from this page (each gets its own id for its chunks). */
let aiRequests = 0;

// Read before any page script runs, so the page knows its mode on its first render. Synchronous, and only
// answered for the bundled interface's own pages (main.ts checks the frame).
let boot: Bootstrap = { shell: false };
try {
  boot = (ipcRenderer.sendSync("shell:bootstrap", location.href) as Bootstrap | null) ?? { shell: false };
} catch {
  boot = { shell: false };
}

if (boot.shell) {
  const shellBridge = {
    platform: "mac" as const,
    shellVersion: boot.version,
    initialMode: boot.mode,
    /** Saves the choice; the app then reloads its windows in that mode (its policy and network rules change). */
    setMode: async (mode: "local" | "account") => {
      const ok = (await ipcRenderer.invoke("shell:set-mode", mode)) as boolean;
      if (!ok) throw new Error(`Folevi couldn't switch to ${String(mode)}.`);
    },
    // The library's files, journal and passphrase, in the main process (src/library/: service.ts behind
    // ipc.ts, which checks every argument). A sandboxed preload can't load those modules: the channel names
    // are ipc.ts's LIBRARY_CHANNELS. Failures reject with a plain { name, code, message } object, because
    // contextBridge keeps a plain object's fields but drops an Error's `code`.
    library: {
      setup: (o: { kind: string }) => lib("setup", { kind: o?.kind }),
      info: () => lib("info"),
      list: (dir: string) => lib("list", dir),
      read: (path: string) => lib("read", path),
      write: (path: string, bytes: Uint8Array, o: { ifMatch?: string | null }) => lib("write", path, bytes, o && "ifMatch" in o ? { ifMatch: o.ifMatch } : {}),
      remove: async (path: string, o?: { ifMatch?: string }) => {
        await lib("remove", path, o && "ifMatch" in o ? { ifMatch: o.ifMatch } : {});
      },
      conflictVersions: (path: string) => lib("conflict-versions", path),
      resolveConflicts: async (path: string, ids: string[]) => {
        await lib("resolve-conflicts", path, Array.isArray(ids) ? [...ids] : ids);
      },
      startDownload: async (paths: string[]) => {
        await lib("start-download", Array.isArray(paths) ? [...paths] : paths);
      },
      /** Change batches from the main process's watcher; returns the unsubscribe function. */
      watch: (cb: (changes: { path: string; kind: string }[]) => void) => {
        const listener = (_e: IpcRendererEvent, changes: { path: string; kind: string }[]) => cb(changes);
        if (libraryWatchers === 0) void lib("watch").catch(() => undefined);
        libraryWatchers++;
        ipcRenderer.on("library:changes", listener);
        let on = true;
        return () => {
          if (!on) return;
          on = false;
          ipcRenderer.removeListener("library:changes", listener);
          if (--libraryWatchers === 0) void lib("unwatch").catch(() => undefined);
        };
      },
      journal: {
        append: async (record: Uint8Array) => {
          await lib("journal-append", record);
        },
        readAll: () => lib("journal-read"),
        truncate: async (n: number) => {
          await lib("journal-truncate", n);
        },
      },
      unlock: (passphrase: string) => lib("unlock", passphrase),
      setPassphrase: async (passphrase: string | null) => {
        await lib("set-passphrase", passphrase);
      },
      changePassphrase: (oldPassphrase: string, newPassphrase: string) => lib("change-passphrase", oldPassphrase, newPassphrase),
      /** Served by the app:// handler (protocol.ts) from the library. */
      fileUrl: (sha256: string, mime: string) => {
        const sha = String(sha256).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Not a SHA-256 file name.");
        return `app://folevi/_files/${sha}${mime ? `?type=${encodeURIComponent(String(mime))}` : ""}`;
      },
      move: (to: { kind: string }) => lib("move", { kind: to?.kind }),
      // Sync with Dropbox and Google Drive (src/library/cloud/ipc.ts): the connection's status, signing in and
      // signing out. The provider tokens stay in the main process; failures reject with { name, code, message }.
      cloud: (() => {
        const call = async <T = unknown>(name: string, ...args: unknown[]): Promise<T> => {
          const r = (await ipcRenderer.invoke(`cloud:${name}`, ...args)) as { ok: true; value: T } | { ok: false; error: { code: string; message: string } } | null;
          if (r && r.ok) return r.value;
          const error = r && !r.ok ? r.error : { code: "io", message: "Folevi couldn't reach its cloud connection." };
          throw { name: "CloudError", code: error.code, message: error.message };
        };
        return {
          status: () => call("status"),
          /** Opens the provider's sign-in in the browser; resolves once connected (also to reconnect). */
          connect: (provider: "dropbox" | "googleDrive") => call("connect", provider),
          cancel: async () => {
            await call("cancel");
          },
          signOut: () => call("sign-out"),
          /** The status now and on every change; returns the function that stops listening. */
          onStatus: (cb: (status: unknown) => void) => {
            const listener = (_e: IpcRendererEvent, s: unknown) => cb(s);
            ipcRenderer.on("cloud:status", listener);
            void call("subscribe").then(cb, () => undefined);
            return () => {
              ipcRenderer.removeListener("cloud:status", listener);
            };
          },
        };
      })(),
    },
    // The person's Foli AI keys, kept encrypted by the main process (ai.ts): the page can store and remove
    // them and ask whether one is set, never read one back. (A sandboxed preload can't
    // load ai.ts: the channel names are its AI_CHANNELS, checked by its test.)
    secrets: {
      has: async (name: string) => (await ipcRenderer.invoke("shell:secrets-has", String(name))) === true,
      set: async (name: string, value: string) => {
        const r = (await ipcRenderer.invoke("shell:secrets-set", String(name), typeof value === "string" ? value : "")) as { ok: boolean; error?: string } | null;
        if (!r?.ok) throw new Error(r?.error ?? "Folevi couldn't keep that key.");
      },
      delete: async (name: string) => {
        const r = (await ipcRenderer.invoke("shell:secrets-delete", String(name))) as { ok: boolean; error?: string } | null;
        if (!r?.ok) throw new Error(r?.error ?? "Folevi couldn't remove that key.");
      },
    },
    // The account session lives in the main process (authBridge.ts) and never comes here. (A sandboxed
    // preload can't load authBridge.ts: the channel names are its AUTH_CHANNELS, checked by its test.)
    auth: {
      /** Signs in in the default browser; true once the app holds a session. */
      signIn: () => ipcRenderer.invoke("shell:auth-sign-in") as Promise<boolean>,
      signOut: async () => {
        await ipcRenderer.invoke("shell:auth-sign-out");
      },
      /** Only the website's /api/auth/*; the main process adds the session and scrubs it from the answer. */
      fetch: async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const res = (await ipcRenderer.invoke("shell:auth-fetch", String(path), {
          method: init?.method,
          headers: init?.headers && typeof init.headers === "object" ? { ...init.headers } : {},
          body: typeof init?.body === "string" ? init.body : undefined,
        })) as { status: number; headers: Record<string, string>; body: string } | null;
        if (!res) throw new Error("Folevi couldn't send that request.");
        return res;
      },
      convexToken: () => ipcRenderer.invoke("shell:auth-convex-token") as Promise<string | null>,
    },
    // Foli AI on this Mac (ai.ts in the main process): Apple's on-device model, or the person's own keys,
    // which never come here. An answer streams back on shell:ai-chunk under the request's id.
    ai: {
      capabilities: () => ipcRenderer.invoke("shell:ai-capabilities"),
      generate: (req: unknown, onChunk: (text: string) => void) => {
        aiRequests += 1;
        const id = `g${aiRequests}${Math.random().toString(36).slice(2, 10)}`;
        const listener = (_e: IpcRendererEvent, forId: unknown, text: unknown) => {
          if (forId !== id || typeof text !== "string") return;
          try {
            onChunk(text);
          } catch {
            /* The page's own callback failing doesn't stop the answer. */
          }
        };
        ipcRenderer.on("shell:ai-chunk", listener);
        // Plain data only: contextBridge already copied the page's object; this drops anything else on it.
        let plain: unknown;
        try {
          plain = JSON.parse(JSON.stringify(req ?? null));
        } catch {
          plain = null;
        }
        const done = (ipcRenderer.invoke("shell:ai-generate", id, plain) as Promise<{ text: string; stopReason: string; error?: string; errorCode?: string }>)
          .catch(() => ({ text: "", stopReason: "error", error: "Folevi couldn't reach Foli AI.", errorCode: "unavailable" }))
          .finally(() => ipcRenderer.removeListener("shell:ai-chunk", listener));
        return {
          done,
          cancel: () => {
            void ipcRenderer.invoke("shell:ai-cancel", id).catch(() => undefined);
          },
        };
      },
      testKey: (provider: string) => ipcRenderer.invoke("shell:ai-test-key", String(provider)) as Promise<{ ok: true } | { ok: false; error: string }>,
    },
    // The Touch ID lock (lock.ts in the main process): its settings; turning it on or off asks for Touch ID.
    lock: {
      getSettings: async () => {
        const s = await ipcRenderer.invoke("shell:lock-get");
        if (!s) throw { name: "LockError", code: "unavailable", message: "The lock isn't in this build of Folevi for Mac." };
        return s;
      },
      setSettings: async (patch: { lock?: boolean; lockAfter?: number }) => {
        const r = (await ipcRenderer.invoke("shell:lock-set", { lock: patch?.lock, lockAfter: patch?.lockAfter })) as { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } } | null;
        if (r && r.ok) return r.value;
        const error = r && !r.ok ? r.error : { code: "io", message: "Folevi couldn't change the lock." };
        throw { name: "LockError", code: error.code, message: error.message };
      },
    },
    /** Reminders as Mac notifications, kept by the app across restarts (reminders.ts). */
    notify: {
      schedule: async (n: { id: string; at: number; title: string; body: string; path: string }) => {
        const ok = (await ipcRenderer.invoke("shell:notify-schedule", n)) as boolean;
        if (!ok) throw new Error("Folevi couldn't schedule that reminder.");
      },
      cancel: async (id: string) => {
        await ipcRenderer.invoke("shell:notify-cancel", id);
      },
    },
    files: {
      /** Saves a file the page made where the person picks in a save dialog (saveFile.ts); false when cancelled. */
      save: (name: string, bytes: Uint8Array) => ipcRenderer.invoke("shell:files-save", name, bytes) as Promise<boolean>,
    },
    http: {
      preview: notYet("http.preview", "bookmark previews, a later package"),
      /** A subscribed calendar, fetched by the app from the calendar's own site (calendarFetch.ts). */
      calendar: (url: string, previous?: { etag?: string | null; lastModified?: string | null }) => ipcRenderer.invoke("shell:http-calendar", url, previous ?? {}),
    },
  };
  contextBridge.exposeInMainWorld("foleviShell", shellBridge);
}

// The page knows from its first paint that it's in the Mac app (room for the window buttons, a draggable top).
const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
mark();
if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });
