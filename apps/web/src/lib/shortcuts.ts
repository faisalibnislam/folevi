// Shortcut labels are written the Mac way ("⌘⇧K", "⌥⇧↑"); elsewhere they read "Ctrl+Shift+K", "Alt+Shift+↑".
import { useSyncExternalStore } from "react";
import { isMac } from "@/lib/hooks/useEngine";

const NAMES: Record<string, string> = { "⌘": "Ctrl", "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
const ORDER = ["Ctrl", "Alt", "Shift"];
const KEYS: Record<string, string> = { "↵": "Enter", "⌫": "Backspace", "⌦": "Delete", "⎋": "Esc" };

/** One shortcut ("⌘⇧K") for this platform. */
export function keyLabel(shortcut: string, mac = isMac()): string {
  if (mac) return shortcut;
  const mods = new Set<string>();
  let i = 0;
  const chars = [...shortcut];
  while (i < chars.length && NAMES[chars[i]!]) mods.add(NAMES[chars[i++]!]!);
  const rest = chars.slice(i).join("");
  const key = KEYS[rest] ?? rest;
  return [...ORDER.filter((m) => mods.has(m)), key].filter(Boolean).join("+");
}

/** Every shortcut inside a label ("Bold (⌘B)") for this platform. */
export function withKeyLabels(text: string, mac = isMac()): string {
  if (mac) return text;
  return text.replace(/[⌘⌃⌥⇧]+[^\s)]*/g, (m) => keyLabel(m, false));
}

// Rendering: a shortcut drawn on the page (a tooltip, a hint, a key cap) must match what the server drew, so it
// starts in the Mac's form and switches to this system's once the page runs (Windows, Linux, Android and
// Chromebooks read "Ctrl+K"; Apple's systems keep "⌘K").
const noSubscribe = () => () => undefined;
const serverIsMac = () => true;

/** Whether shortcuts are written the Mac way here, for rendering. */
export function useMacKeys(): boolean {
  return useSyncExternalStore(noSubscribe, isMac, serverIsMac);
}

/** One shortcut ("⌘⇧K") for this platform, for rendering. */
export function useKeyLabel(shortcut: string): string;
export function useKeyLabel(shortcut: string | undefined): string | undefined;
export function useKeyLabel(shortcut: string | undefined): string | undefined {
  const mac = useMacKeys();
  return shortcut === undefined ? undefined : keyLabel(shortcut, mac);
}

/** Writes every shortcut in a text ("Back (⌘[)") for this platform, for rendering. */
export function useKeyLabels(): (text: string) => string {
  const mac = useMacKeys();
  return (text: string) => withKeyLabels(text, mac);
}
