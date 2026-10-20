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
const notYetSync = (what: string, comes: string) => () => {
  throw new Error(`foleviShell.${what} isn't in this build of Folevi for Mac yet (${comes}).`);
};
const LIBRARY = "the library layer, WP9";

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
    library: {
      setup: notYet("library.setup", LIBRARY),
      info: notYet("library.info", LIBRARY),
      list: notYet("library.list", LIBRARY),
      read: notYet("library.read", LIBRARY),
      write: notYet("library.write", LIBRARY),
      remove: notYet("library.remove", LIBRARY),
      conflictVersions: notYet("library.conflictVersions", LIBRARY),
      resolveConflicts: notYet("library.resolveConflicts", LIBRARY),
      startDownload: notYet("library.startDownload", LIBRARY),
      watch: notYetSync("library.watch", LIBRARY),
      journal: {
        append: notYet("library.journal.append", LIBRARY),
        readAll: notYet("library.journal.readAll", LIBRARY),
        truncate: notYet("library.journal.truncate", LIBRARY),
      },
      unlock: notYet("library.unlock", "library encryption, WP9"),
      setPassphrase: notYet("library.setPassphrase", "library encryption, WP9"),
      changePassphrase: notYet("library.changePassphrase", "library encryption, WP9"),
      /** Served by the app:// handler (protocol.ts) from the library. */
      fileUrl: (sha256: string, mime: string) => {
        const sha = String(sha256).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Not a SHA-256 file name.");
        return `app://folevi/_files/${sha}${mime ? `?type=${encodeURIComponent(String(mime))}` : ""}`;
      },
      move: notYet("library.move", LIBRARY),
    },
    secrets: {
      has: notYet("secrets.has", "the Keychain store, a later package"),
      set: notYet("secrets.set", "the Keychain store, a later package"),
      delete: notYet("secrets.delete", "the Keychain store, a later package"),
    },
    auth: {
      signIn: notYet("auth.signIn", "signing in from the built-in interface, WP4"),
      signOut: notYet("auth.signOut", "signing in from the built-in interface, WP4"),
      fetch: notYet("auth.fetch", "signing in from the built-in interface, WP4"),
      convexToken: notYet("auth.convexToken", "signing in from the built-in interface, WP4"),
    },
    ai: {
      capabilities: notYet("ai.capabilities", "Foli AI on this Mac, WP11"),
      generate: () => {
        const done = notYet("ai.generate", "Foli AI on this Mac, WP11")();
        done.catch(() => undefined);
        return { done, cancel: () => undefined };
      },
    },
    lock: {
      getSettings: notYet("lock.getSettings", "the Touch ID lock, WP10"),
      setSettings: notYet("lock.setSettings", "the Touch ID lock, WP10"),
    },
    notify: {
      schedule: notYet("notify.schedule", "local reminders, WP14"),
      cancel: notYet("notify.cancel", "local reminders, WP14"),
    },
    files: { save: notYet("files.save", "saving files, a later package") },
    http: { preview: notYet("http.preview", "bookmark previews, a later package") },
  };
  contextBridge.exposeInMainWorld("foleviShell", shellBridge);
}

// The page knows from its first paint that it's in the Mac app (room for the window buttons, a draggable top).
const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
mark();
if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });
