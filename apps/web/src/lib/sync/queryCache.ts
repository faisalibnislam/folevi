"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { canonicalJson } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { QUERY_PREFIX, localDb, queryKeys } from "./db";
import type { Outbox, OutboxEntry } from "./outbox";
import { onMemoryPressure } from "@/lib/memoryPressure";

/**
 * The last answer of each query this device has seen, so a page opened before reads the same offline: kept
 * in memory for this visit and in the account's IndexedDB for the next (an offline reload). Cleared with the
 * rest of the account's local data on sign-out.
 */
const memory = new Map<string, unknown>();
/** What was last written for each key, so an unchanged answer isn't written again. */
const written = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Answers older than this are dropped from the device when the next one is written. */
const KEEP_FOR = 60 * 86_400_000;
let pruned = false;

/** The IndexedDB key of a query's answer for these arguments. */
export function queryKey(name: string, args: unknown): string {
  return `${QUERY_PREFIX}${name}:${canonicalJson(args)}`;
}

function remember(accountKey: string, key: string, value: unknown) {
  memory.set(`${accountKey}|${key}`, value);
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  // Written once the answers settle (typing in a cell changes it on every save), at most once a second.
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const json = JSON.stringify(value);
      if (written.get(`${accountKey}|${key}`) === json) return;
      void (async () => {
        try {
          const db = await localDb(accountKey);
          await db.put("meta", { value, at: Date.now() }, key);
          written.set(`${accountKey}|${key}`, json);
          if (!pruned) {
            pruned = true;
            const old = Date.now() - KEEP_FOR;
            let cursor = await db.transaction("meta", "readwrite").store.openCursor(queryKeys());
            while (cursor) {
              if (((cursor.value as { at?: number }).at ?? 0) < old) await cursor.delete();
              cursor = await cursor.continue();
            }
          }
        } catch {
          // Storage full or unavailable: this answer just isn't kept for offline.
        }
      })();
    }, 1000),
  );
}

async function recall(accountKey: string, key: string): Promise<unknown> {
  try {
    const db = await localDb(accountKey);
    return ((await db.get("meta", key)) as { value?: unknown } | undefined)?.value;
  } catch {
    return undefined;
  }
}

/**
 * `useQuery`, plus the last answer seen on this device while there's no live one (offline, or still
 * loading): a list read once reads again with no connection. `fromCache` says the answer is the kept one.
 */
export function useCachedQuery<Q extends FunctionReference<"query">>(query: Q, args: FunctionArgs<Q> | "skip"): { data: FunctionReturnType<Q> | undefined; fromCache: boolean } {
  const { profile } = useAppState();
  const live = useQuery(query, args);
  const key = args === "skip" ? null : queryKey(getFunctionName(query), args);
  const memoryKey = key ? `${profile.id}|${key}` : null;
  const [loaded, setLoaded] = useState<{ key: string; value: unknown } | null>(null);
  useEffect(() => {
    if (key && live !== undefined) remember(profile.id, key, live);
  }, [key, live, profile.id]);
  const waiting = live === undefined;
  useEffect(() => {
    if (!key || !memoryKey || !waiting || memory.has(memoryKey)) return;
    let cancelled = false;
    void recall(profile.id, key).then((value) => {
      if (cancelled || value === undefined) return;
      memory.set(memoryKey, value);
      setLoaded({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key, memoryKey, waiting, profile.id]);
  if (live !== undefined || !memoryKey) return { data: live, fromCache: false };
  const kept = memory.has(memoryKey) ? memory.get(memoryKey) : loaded?.key === key ? loaded.value : undefined;
  return { data: kept as FunctionReturnType<Q> | undefined, fromCache: kept !== undefined };
}

/**
 * The same kept answers outside React (the native apps' engine, lib/engine): the last answer seen on this device
 * for `name(args)`, from memory or the account's IndexedDB, or undefined.
 */
export async function keptAnswer(accountKey: string, name: string, args: unknown): Promise<unknown> {
  const key = queryKey(name, args);
  const memoryKey = `${accountKey}|${key}`;
  if (memory.has(memoryKey)) return memory.get(memoryKey);
  const value = await recall(accountKey, key);
  if (value !== undefined) memory.set(memoryKey, value);
  return value;
}

/** Keeps `value` as the last answer of `name(args)` (written once the answers settle, as useCachedQuery does). */
export function keepAnswer(accountKey: string, name: string, args: unknown, value: unknown): void {
  remember(accountKey, queryKey(name, args), value);
}

/** `useCachedQuery`'s answer alone. */
export function useOfflineQuery<Q extends FunctionReference<"query">>(query: Q, args: FunctionArgs<Q> | "skip"): FunctionReturnType<Q> | undefined {
  return useCachedQuery(query, args).data;
}

const NO_ENTRIES: readonly OutboxEntry[] = [];

/** The changes waiting in the outbox (re-renders as they're added, sent or refused). */
export function useOutboxEntries(outbox: Outbox | null): readonly OutboxEntry[] {
  return useSyncExternalStore(
    (cb) => (outbox ? outbox.subscribe(cb) : () => undefined),
    () => outbox?.entries ?? NO_ENTRIES,
    () => NO_ENTRIES,
  );
}

/** Forgets what this visit kept in memory (signing out). */
export function forgetCachedQueries() {
  memory.clear();
  written.clear();
}

// Memory short: the kept answers go from memory (they're in IndexedDB, and a page waiting for its live answer
// reads them from there again).
onMemoryPressure(() => forgetCachedQueries());
