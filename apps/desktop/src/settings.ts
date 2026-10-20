// The Mac app's own settings (the web app's live in the account): kept in a small JSON file in the app's
// support folder.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface DesktopSettings {
  /** Opens Quick Add from any app (an Electron accelerator, e.g. "Alt+Space"); empty for none. */
  quickAddShortcut: string;
  openAtLogin: boolean;
  menuBarIcon: boolean;
  /** Comments, mentions and reminders as Mac notifications while Folevi isn't the app in front. */
  notifications: boolean;
  /**
   * The bundled interface (docs/LOCAL_MODE_PLAN.md WP2): where the notes live, chosen on its first launch
   * ("unset" until then). Read by preload.ts before the page loads (foleviShell.initialMode).
   */
  mode: ShellMode;
  /**
   * Shows the interface built into the app (app://folevi) instead of the website. On by default in the
   * packaged app since 2026-10-21 (main.ts also needs the built-in copy to be in the app); "bundledShell":
   * false in the settings file or FOLEVI_SHELL=0 turns it off. Never set by the page.
   */
  bundledShell: boolean;
}

export type ShellMode = "unset" | "local" | "account";
const MODES: readonly ShellMode[] = ["unset", "local", "account"];

/** The settings the page sees and may change (Settings > Desktop app): not the mode or the bundled switch. */
export type PageSettings = Pick<DesktopSettings, "quickAddShortcut" | "openAtLogin" | "menuBarIcon" | "notifications">;

export function pageSettings(s: DesktopSettings): PageSettings {
  return { quickAddShortcut: s.quickAddShortcut, openAtLogin: s.openAtLogin, menuBarIcon: s.menuBarIcon, notifications: s.notifications };
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  quickAddShortcut: "Alt+Space",
  openAtLogin: true,
  menuBarIcon: true,
  notifications: true,
  mode: "unset",
  bundledShell: true,
};

const MODIFIERS = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift", "Super", "Meta"]);
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Return|Backspace|Delete|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Plus|[`\-=[\]\\;',./])$/;

/**
 * Whether a shortcut is one Folevi accepts for Quick Add: at least one modifier other than Shift, then a
 * single key. (A bare key, or Shift with a letter, would swallow typing everywhere.)
 */
export function isValidShortcut(accelerator: string): boolean {
  if (accelerator === "") return true;
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  if (!KEY.test(key) || !parts.length || !parts.every((m) => MODIFIERS.has(m))) return false;
  if (new Set(parts).size !== parts.length) return false;
  return parts.some((m) => m !== "Shift");
}

/**
 * Keeps only known settings of the right type: the file (or a page asking for a change) may hold anything.
 * A page's change (`fromFile` false) never touches the mode or the bundled switch: those keep `base`'s.
 */
export function cleanSettings(input: unknown, base: DesktopSettings = DEFAULT_SETTINGS, fromFile = false): DesktopSettings {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const bool = (k: keyof PageSettings | "bundledShell") => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : (base[k] as boolean));
  const shortcut = typeof raw.quickAddShortcut === "string" && isValidShortcut(raw.quickAddShortcut) ? raw.quickAddShortcut : base.quickAddShortcut;
  const mode = fromFile && MODES.includes(raw.mode as ShellMode) ? (raw.mode as ShellMode) : base.mode;
  return {
    quickAddShortcut: shortcut,
    openAtLogin: bool("openAtLogin"),
    menuBarIcon: bool("menuBarIcon"),
    notifications: bool("notifications"),
    mode,
    bundledShell: fromFile ? bool("bundledShell") : base.bundledShell,
  };
}

export function loadSettings(file: string): DesktopSettings {
  try {
    return cleanSettings(JSON.parse(readFileSync(file, "utf8")), DEFAULT_SETTINGS, true);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, settings: DesktopSettings): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2));
  } catch {
    /* Not saved: the change still holds until Folevi quits. */
  }
}
