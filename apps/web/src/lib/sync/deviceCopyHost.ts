"use client";

// The running device copy of each signed-in account on this page (components/app/DeviceCopyRunner.tsx makes
// it), and its setting: "Keep all notes on this device", per account (place), on unless turned off. Settings
// (DeviceCopySettings.tsx) and the note view read them from here.
import type { DeviceCopy } from "./deviceCopy";
import type { DeviceFiles } from "./deviceFiles";

export interface DeviceCopyHandle {
  copy: DeviceCopy;
  files: DeviceFiles;
}

const running = new Map<string, DeviceCopyHandle>();
const listeners = new Set<() => void>();

export function registerDeviceCopy(accountKey: string, handle: DeviceCopyHandle | null): void {
  if (handle) running.set(accountKey, handle);
  else running.delete(accountKey);
  for (const l of [...listeners]) l();
}

export function deviceCopyOf(accountKey: string): DeviceCopyHandle | null {
  return running.get(accountKey) ?? null;
}

export function onDeviceCopies(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** localStorage key of the setting (cleared with the account's other keys on sign-out, db.ts). */
export const KEEP_ALL_PREFIX = "folevi:device-copy:";
const SETTING_EVENT = "folevi:device-copy-setting";

/** "Keep all notes on this device" for this account: on unless turned off here. */
export function keepAllNotes(accountKey: string): boolean {
  try {
    return localStorage.getItem(`${KEEP_ALL_PREFIX}${accountKey}`) !== "off";
  } catch {
    return true;
  }
}

export function setKeepAllNotes(accountKey: string, on: boolean): void {
  try {
    localStorage.setItem(`${KEEP_ALL_PREFIX}${accountKey}`, on ? "on" : "off");
  } catch {
    /* storage unavailable: this visit only */
  }
  window.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: { accountKey, on } }));
}

export function onKeepAllNotes(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(KEEP_ALL_PREFIX)) cb();
  };
  window.addEventListener(SETTING_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SETTING_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The note id a link opens (`/d/<id>`), or null. */
export function noteIdOfHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /\/d\/([0-9A-HJKMNP-TV-Z]{26})(?:[/?#]|$)/.exec(href);
  return m ? m[1]! : null;
}

/** Notes linked from what's on screen now (cards, rows, links), at most `max`. */
export function visibleNoteIds(max = 60): string[] {
  if (typeof document === "undefined") return [];
  const out = new Set<string>();
  const vh = window.innerHeight || 1000;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/d/"]')) {
    const id = noteIdOfHref(a.getAttribute("href"));
    if (!id) continue;
    const r = a.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || (r.width === 0 && r.height === 0)) continue;
    out.add(id);
    if (out.size >= max) break;
  }
  return [...out];
}
