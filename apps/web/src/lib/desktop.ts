// The Mac app (apps/desktop) shows this site in its own windows and adds `window.foleviDesktop`: the Dock
// badge, Mac notifications, the menu bar icon, Quick Add from any app and its own settings. In a browser
// it's absent and nothing here does anything. The same shell runs on Windows (`platform: "windows"`): the
// system tray instead of the menu bar, Ctrl+Alt+Space, and Windows' own window buttons at the top right.

export interface DesktopSettings {
  quickAddShortcut: string;
  openAtLogin: boolean;
  menuBarIcon: boolean;
  notifications: boolean;
}

export type DesktopCommand = { type: "navigate"; path: string } | { type: "new-note" } | { type: "quick-add-shown" };

/** Which desktop app the page is in. Mac app builds before Windows existed always say "mac". */
export type DesktopPlatform = "mac" | "windows";

export interface DesktopBridge {
  platform: DesktopPlatform;
  setBadge(count: number): void;
  notify(n: { id: string; title: string; body?: string | null; path?: string | null }): void;
  setRecent(notes: { id: string; title: string }[]): void;
  setStatus(text: string): void;
  getSettings(): Promise<{ settings: DesktopSettings; error: string | null } | null>;
  setSettings(patch: Partial<DesktopSettings>): Promise<{ settings: DesktopSettings; error: string | null } | null>;
  placeWindowButtons(spot: { x: number; y: number; height: number }): void;
  pauseShortcut(paused: boolean): void;
  closeQuickAdd(): void;
  sizeQuickAdd(height: number): void;
  openInMain(path: string): void;
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

/** The computer the app runs on, as copy says it: "this Mac", "this PC". */
export const deviceName = (platform: DesktopPlatform) => (platform === "windows" ? "this PC" : "this Mac");

/** Quick Add's shortcut until changed: ⌥Space on a Mac, Ctrl+Alt+Space on Windows (Alt+Space is its system menu). */
export const defaultQuickAddShortcut = (platform: DesktopPlatform) => (platform === "windows" ? "Control+Alt+Space" : "Alt+Space");

/** The room Windows' minimize, maximize and close buttons usually take at the window's top right (3 x 46 px). */
export const WINDOW_CONTROLS_WIDTH = 138;

/**
 * How wide Windows' window buttons are, from the part of the title bar the page may use
 * (`navigator.windowControlsOverlay.getTitlebarAreaRect()`, everything left of the buttons): the rest of
 * the window's width. Without that (or with nonsense) it's the usual 138 px.
 */
export function windowControlsWidth(area: { x: number; width: number; height: number } | null | undefined, viewportWidth: number): number {
  if (!area || !(area.width > 0) || !(area.height > 0) || !(viewportWidth > 0)) return WINDOW_CONTROLS_WIDTH;
  const width = Math.round(viewportWidth - (area.x + area.width));
  return width > 0 && width < 400 ? width : WINDOW_CONTROLS_WIDTH;
}

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
 * On Windows the Windows key is "Super" ("Control+Alt+Space", "Super+Shift+K").
 */
export function acceleratorFrom(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, platform: DesktopPlatform = "mac"): string | null {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"].includes(e.key)) return null;
  const mods = (
    platform === "windows"
      ? [e.metaKey && "Super", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift"]
      : [e.metaKey && "Command", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift"]
  ).filter(Boolean) as string[];
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

const WINDOWS_NAMES: Record<string, string> = { Super: "Win", Meta: "Win", Command: "Win", Control: "Ctrl", Alt: "Alt", Shift: "Shift", Return: "Enter", Escape: "Esc", Delete: "Del" };

/** A shortcut as the Mac writes it (⌥Space, ⇧⌘K), or as Windows does (Ctrl+Alt+Space, Win+Shift+K). */
export function shortcutLabel(accelerator: string, platform: DesktopPlatform = "mac"): string {
  if (!accelerator) return "None";
  const parts = accelerator.split("+");
  const key = parts.pop()!;
  if (platform === "windows") {
    const mods = ["Super", "Meta", "Command", "Control", "Alt", "Shift"].filter((m) => parts.includes(m)).map((m) => WINDOWS_NAMES[m]);
    return [...new Set(mods), WINDOWS_NAMES[key] ?? key].join("+");
  }
  const order = ["Control", "Alt", "Shift", "Command"];
  const mods = order.filter((m) => parts.includes(m)).map((m) => SYMBOLS[m]);
  return `${mods.join("")}${SYMBOLS[key] ?? key}`;
}
