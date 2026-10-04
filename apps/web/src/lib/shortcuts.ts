// Shortcut labels are written the Mac way ("⌘⇧K", "⌥⇧↑"); elsewhere they read "Ctrl+Shift+K", "Alt+Shift+↑".
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
