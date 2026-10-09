// The only thing the web page gets from the Mac app: `window.foleviDesktop`, a few calls that reach the main
// process. No Node, no Electron objects (the page runs sandboxed); the main process checks every call
// comes from Folevi's own pages.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Command = { type: "navigate"; path: string } | { type: "new-note" } | { type: "quick-add-shown" };

const bridge = {
  platform: "mac" as const,
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

// The page knows from its first paint that it's in the Mac app (room for the window buttons, a draggable top).
const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
mark();
if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });
