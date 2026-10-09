// The Mac app (apps/desktop) shows this site in its own windows and adds `window.foleviDesktop`: the Dock
// badge, Mac notifications, the menu bar icon, Quick Add from any app and its own settings. In a browser
// it's absent and nothing here does anything.

export interface DesktopSettings {
  quickAddShortcut: string;
  openAtLogin: boolean;
  menuBarIcon: boolean;
  notifications: boolean;
}

export type DesktopCommand = { type: "navigate"; path: string } | { type: "new-note" } | { type: "quick-add-shown" };

export interface DesktopBridge {
  platform: "mac";
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
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"].includes(e.key)) return null;
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

/** A shortcut as the Mac writes it: ⌥Space, ⇧⌘K. */
export function shortcutLabel(accelerator: string): string {
  if (!accelerator) return "None";
  const parts = accelerator.split("+");
  const key = parts.pop()!;
  const order = ["Control", "Alt", "Shift", "Command"];
  const mods = order.filter((m) => parts.includes(m)).map((m) => SYMBOLS[m]);
  return `${mods.join("")}${SYMBOLS[key] ?? key}`;
}
