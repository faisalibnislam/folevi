"use client";

import { useSyncExternalStore } from "react";
import type { SyncEngine } from "@/lib/sync/engine";
import { sync } from "@folevi/editor-schema";

const EMPTY = sync.emptySyncState();

/** Subscribes a component to the sync engine state (status, pending counts, conflicts). */
export function useEngineState(engine: SyncEngine | null) {
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => undefined),
    () => engine?.state ?? EMPTY,
    () => EMPTY,
  );
}

/** The engine's overall status, including edits an editor is still debouncing. */
export function useEngineStatus(engine: SyncEngine | null) {
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => undefined),
    () => (engine ? engine.status() : "saved"),
    () => "saved" as const,
  );
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((current: T) => T)) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      const handler = (e: StorageEvent | Event) => {
        if (!(e instanceof StorageEvent) || e.key === key) cb();
      };
      window.addEventListener("storage", handler);
      window.addEventListener(`folevi-ls:${key}`, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(`folevi-ls:${key}`, handler);
      };
    },
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const parsed = value === null ? initial : (JSON.parse(value) as T);
  // A function gets the value as stored right now (not as of this render), so quick updates in a row
  // build on each other instead of the last one overwriting the others.
  const set = (v: T | ((current: T) => T)) => {
    try {
      let next = v;
      if (typeof v === "function") {
        const raw = localStorage.getItem(key);
        next = (v as (current: T) => T)(raw === null ? initial : (JSON.parse(raw) as T));
      }
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(`folevi-ls:${key}`));
  };
  return [parsed, set];
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl+";
}
