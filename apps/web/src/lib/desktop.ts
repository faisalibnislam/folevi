// The Mac app (apps/mac) shows Folevi in its own windows and adds `window.foleviDesktop`: the Dock
// badge, Mac notifications, the menu bar icon, Quick Add from any app and its own settings. In a browser
// it's absent and nothing here does anything.

export interface DesktopSettings {
  quickAddShortcut: string;
  openAtLogin: boolean;
  menuBarIcon: boolean;
  notifications: boolean;
}

export type DesktopCommand =
  | { type: "navigate"; path: string }
  | { type: "new-note" }
  | { type: "quick-add-shown" }
  /** A menu bar item (the native Mac app): one of MAC_MENU_COMMANDS. */
  | { type: "menu"; id: string }
  /** A Mac notification's action: "reply" (with `text`, to comment thread `thread`), "read", "complete", "snooze-…". */
  | { type: "notification"; action: string; id: string; kind?: string; path?: string; text?: string; thread?: string };

/**
 * The menu bar's page commands in the native Mac app (apps/mac/Folevi/Chrome/MenuModel.swift; its MenuTests checks
 * this list against the menus). Each reaches the key window's page as { type: "menu", id }.
 */
export const MAC_MENU_COMMANDS = [
  "file.new-note", "file.new-from-template", "file.new-folder", "file.quick-add-task", "file.new-tab", "file.open-quickly", "file.close-tab", "file.reopen-closed-tab", "file.import", "file.export",
  "edit.find", "edit.find-next", "edit.find-previous", "edit.find-selection", "edit.search-all",
  "format.bold", "format.italic", "format.underline", "format.strikethrough", "format.code", "format.highlight", "format.link", "format.heading-1", "format.heading-2", "format.heading-3", "format.body",
  "format.bulleted-list", "format.numbered-list", "format.checklist", "format.indent", "format.outdent", "format.move-up", "format.move-down", "format.duplicate", "format.style",
  "note.star", "note.archive", "note.move", "note.duplicate", "note.copy-link", "note.history", "note.lock", "note.trash",
  "view.sidebar", "view.inspector", "view.focus", "view.cards", "view.list", "view.appearance-light", "view.appearance-dark", "view.appearance-system",
  "go.back", "go.forward", "go.home", "go.today", "go.calendar", "go.inbox", "go.search", "go.ask-ai", "go.next-tab", "go.previous-tab",
  "go.tab-1", "go.tab-2", "go.tab-3", "go.tab-4", "go.tab-5", "go.tab-6", "go.tab-7", "go.tab-8", "go.tab-9",
  "help.help", "help.shortcuts", "help.whats-new", "help.feedback",
] as const;
export type MacMenuCommand = (typeof MAC_MENU_COMMANDS)[number];

/** What the menu bar can do for this page now (foleviDesktop.setMenuState). */
export interface DesktopMenuState {
  /** Commands that can't run here now: their items show off. */
  disabled: string[];
  /** Commands shown with a check (the view in use, a starred note). */
  checked?: string[];
  /** Foli AI is on: Ask Foli AI shows. */
  ai?: boolean;
  sidebar?: boolean;
  inspector?: boolean;
  focus?: boolean;
  /** The page has its own find bar (else Find is the system's). */
  find?: boolean;
  /** The note in front is locked (Note > Unlock). */
  locked?: boolean;
  route?: string;
}

type MenuHandler = () => boolean | void;
const menuHandlers = new Map<string, MenuHandler[]>();
const menuWatchers = new Set<() => void>();

/**
 * Handles a menu bar command (the native Mac app) while mounted: the most recent handler for an id runs first, and
 * one that returns false hands it on. Returns the function that stops. Commands nothing handles show off.
 */
export function registerMenuCommand(id: MacMenuCommand, run: MenuHandler): () => void {
  const list = menuHandlers.get(id) ?? [];
  list.push(run);
  menuHandlers.set(id, list);
  menuWatchers.forEach((w) => w());
  return () => {
    const now = menuHandlers.get(id) ?? [];
    const at = now.indexOf(run);
    if (at >= 0) now.splice(at, 1);
    if (!now.length) menuHandlers.delete(id);
    menuWatchers.forEach((w) => w());
  };
}

/** Runs the registered handlers for a command, newest first; true once one took it. */
export function runMenuCommand(id: string): boolean {
  const list = [...(menuHandlers.get(id) ?? [])].reverse();
  for (const run of list) if (run() !== false) return true;
  return false;
}

export function hasMenuCommand(id: string): boolean {
  return (menuHandlers.get(id)?.length ?? 0) > 0;
}

/** Calls `cb` when handlers come or go (the menu state is sent again). */
export function watchMenuCommands(cb: () => void): () => void {
  menuWatchers.add(cb);
  return () => menuWatchers.delete(cb);
}

/** Which desktop app the page is in: there is only the Mac app. */
export type DesktopPlatform = "mac";

export interface DesktopBridge {
  platform: DesktopPlatform;
  setBadge(count: number): void;
  /**
   * A Mac notification. The native app also reads `kind` (its actions: Reply and Mark as Read for comments), `thread`
   * (the note, which groups them), `threadTitle` and `commentThread` (where a reply goes).
   */
  notify(n: { id: string; title: string; body?: string | null; path?: string | null; kind?: string; thread?: string | null; threadTitle?: string | null; commentThread?: string | null }): void;
  setRecent(notes: { id: string; title: string }[]): void;
  setStatus(text: string): void;
  getSettings(): Promise<{ settings: DesktopSettings; error: string | null } | null>;
  setSettings(patch: Partial<DesktopSettings>): Promise<{ settings: DesktopSettings; error: string | null } | null>;
  placeWindowButtons(spot: { x: number; y: number; height: number }): void;
  pauseShortcut(paused: boolean): void;
  closeQuickAdd(): void;
  sizeQuickAdd(height: number): void;
  openInMain(path: string): void;
  /**
   * Opens `url` in the default browser and answers with the folevi://auth/google link that ends the sign-in
   * there, or null if none came (Google and Apple sign-in, components/auth/SocialSignIn.tsx). Newer Mac apps only.
   */
  signInInBrowser?(url: string): Promise<string | null>;
  /** Drags a note out as a Markdown file (from a dragstart). Missing in Mac app builds before 1.2. */
  dragFile?(file: { name: string; text: string }): void;
  /**
   * The app answers getDisplayMedia with this Mac's sound, so a recording can hold both sides of a call
   * (lib/callCapture.ts). Missing in Mac app builds before 1.3.
   */
  callCapture?: boolean;
  /** Whether macOS lets Folevi record the screen and its sound ("granted" once allowed). Missing before 1.3. */
  screenAccess?(): Promise<"granted" | "denied" | "not-determined" | "restricted" | "unknown" | null>;
  /** Opens System Settings at Privacy & Security > Screen & System Audio Recording. Missing before 1.3. */
  openSystemSettings?(pane: "screen-recording"): void;
  onCommand(listener: (command: DesktopCommand) => void): () => void;
  /** The native Mac app: what its menu bar can do for this page now. */
  setMenuState?(state: DesktopMenuState): void;
  /** The native Mac app: closes this window (⌘W with no tab left to close). */
  closeWindow?(): void;
  /** The native Mac app: the spell checker on a word, for Folevi's text menu (null when it can't say). */
  spelling?(word: string): Promise<{ misspelled: boolean; guesses: string[] } | null>;
  /** The native Mac app: "Learn Spelling" (the Mac's dictionary) and "Ignore Spelling" (this page). */
  learnWord?(word: string): void;
  ignoreWord?(word: string): void;
  /** The native Mac app: the dictionary panel (Look Up) for `text`, its baseline at (x, y) in the page. */
  lookUp?(o: { text: string; x: number; y: number }): void;
  /**
   * The text in an image, read on this Mac with Vision (a small helper in the app), for search (lib/fileText).
   * Null when it couldn't be read. Missing in Mac app builds before 1.15.
   */
  recognizeText?(image: Uint8Array, handwriting?: boolean): Promise<{ text: string } | null>;
}

declare global {
  interface Window {
    foleviDesktop?: DesktopBridge;
  }
}

/** The Mac app's bridge, or null in a browser. */
export function desktop(): DesktopBridge | null {
  return typeof window !== "undefined" ? (window.foleviDesktop ?? null) : null;
}

/** Quick Add's shortcut until changed: ⌥Space. */
export const DEFAULT_QUICK_ADD_SHORTCUT = "Alt+Space";

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Return",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Tab: "Tab",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  "+": "Plus",
};

/**
 * A pressed key combination as the Mac app's shortcut format ("Alt+Space", "Command+Shift+K"), or null while
 * only modifiers are held or the combination can't be a shortcut (it needs a modifier other than Shift).
 */
export function acceleratorFrom(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"].includes(e.key)) return null;
  const mods = [e.metaKey && "Command", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
  if (!mods.some((m) => m !== "Shift")) return null;
  // Letters and digits by their place on the keyboard: ⌥ changes what they type ("⌥K" types "˚").
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit[0-9]$/.test(e.code)
      ? e.code.slice(5)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)
        ? e.key
        : e.code === "Space"
          ? "Space"
          : (KEY_NAMES[e.key] ?? (/^[`\-=[\]\\;',./]$/.test(e.key) ? e.key : null));
  return key ? [...mods, key].join("+") : null;
}

const SYMBOLS: Record<string, string> = { Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Space: "Space", Return: "↩", Escape: "⎋", Backspace: "⌫", Delete: "⌦", Tab: "⇥", Up: "↑", Down: "↓", Left: "←", Right: "→", Plus: "+" };

/** A shortcut as the Mac writes it (⌥Space, ⇧⌘K). */
export function shortcutLabel(accelerator: string): string {
  if (!accelerator) return "None";
  const parts = accelerator.split("+");
  const key = parts.pop()!;
  const order = ["Control", "Alt", "Shift", "Command"];
  const mods = order.filter((m) => parts.includes(m)).map((m) => SYMBOLS[m]);
  return `${mods.join("")}${SYMBOLS[key] ?? key}`;
}
