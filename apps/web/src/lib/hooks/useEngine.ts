"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { SyncEngine } from "@/lib/sync/engine";
import { sync, type SyncState, type WireBlock } from "@folevi/editor-schema";

const EMPTY = sync.emptySyncState();

/**
 * Subscribes a component to the whole sync engine state: it re-renders on every change anywhere in the
 * account. Prefer `useEngineSelector` for the part a component shows.
 */
export function useEngineState(engine: SyncEngine | null) {
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => undefined),
    () => engine?.state ?? EMPTY,
    () => EMPTY,
  );
}

/**
 * Subscribes to one slice of the engine state: the component re-renders only when the selected value
 * changes (`isEqual`, by default `Object.is`). Return primitives, or slices the engine keeps stable, or
 * pass an `isEqual` that compares them, since a fresh object or array on every call never matches.
 */
export function useEngineSelector<T>(engine: SyncEngine | null, selector: (state: SyncState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const last = useRef<{ state: SyncState; selector: (state: SyncState) => T; value: T } | null>(null);
  const subscribe = useCallback((cb: () => void) => (engine ? engine.subscribe(cb) : () => undefined), [engine]);
  const select = (state: SyncState) => {
    const prev = last.current;
    if (prev && prev.state === state && prev.selector === selector) return prev.value;
    const value = selector(state);
    // An equal value keeps the previous one, so React sees no change and skips the render.
    const kept = prev && isEqual(prev.value, value) ? prev.value : value;
    last.current = { state, selector, value: kept };
    return kept;
  };
  return useSyncExternalStore(
    subscribe,
    () => select(engine?.state ?? EMPTY),
    () => select(EMPTY),
  );
}

/** Arrays with the same items in the same order (each compared with `Object.is`). */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => Object.is(x, b[i])));
}

/** A document's blocks as the person sees them (`engine.documentBlocks`), re-rendering only when they change. */
export function useDocumentBlocks(engine: SyncEngine | null, documentId: string): WireBlock[] {
  // The engine returns the same array while the document is unchanged.
  return useEngineSelector(engine, () => engine?.documentBlocks(documentId) ?? NO_BLOCKS);
}
const NO_BLOCKS: WireBlock[] = [];

/** The engine's overall status, including edits an editor is still debouncing. */
export function useEngineStatus(engine: SyncEngine | null) {
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => undefined),
    () => (engine ? engine.status() : "saved"),
    () => "saved" as const,
  );
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((current: T) => T)) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
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
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  // Parsed once per stored string, so the value keeps its identity between renders (memos and effects
  // that depend on it don't rerun). `initial` is often a fresh literal, so it isn't a dependency.
  const parsed = useMemo(() => (value === null ? initial : (JSON.parse(value) as T)), [key, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialRef = useRef(initial);
  initialRef.current = initial;
  // A function gets the value as stored right now (not as of this render), so quick updates in a row
  // build on each other instead of the last one overwriting the others.
  const set = useCallback(
    (v: T | ((current: T) => T)) => {
      try {
        let next = v;
        if (typeof v === "function") {
          const raw = localStorage.getItem(key);
          next = (v as (current: T) => T)(raw === null ? initialRef.current : (JSON.parse(raw) as T));
        }
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(`folevi-ls:${key}`));
    },
    [key],
  );
  return [parsed, set];
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl+";
}
