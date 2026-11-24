"use client";

// Queries that never take a page down. convex/react's `useQuery` and `usePaginatedQuery` throw a failed query
// into React, and with no boundary nearer than app/global-error.tsx one failed side query (a timed-out count, a
// note that just went away, a cold backend) replaced the whole page with "Something went wrong". These hooks
// keep the same shape but treat a failure as still loading (keeping the last good result, if there was one),
// and retry: the query is dropped for a moment and asked for again, so the server runs it afresh, after 1, 2, 5,
// 10 and then every 30 seconds, or at once with `retry()`. `useQueryState` also says when the query failed, so
// a list can show "Couldn't load" with a Try again button instead of loading forever.
//
// Use these instead of convex/react's (eslint's no-restricted-imports says so). Two kinds of failure still throw:
// the ones a boundary is there to turn into a screen (`throwsToBoundary`: E2eeGate's unlock screen), and any query
// read with `useQueryOrThrow`, for a component whose own boundary handles it (the admin gate, a chart's source).
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import * as ConvexReact from "convex/react";
import { useQueries, type OptionalRestArgsOrSkip, type PaginatedQueryArgs, type PaginatedQueryReference, type UsePaginatedQueryReturnType } from "convex/react";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { convexToJson, type Value } from "convex/values";

export const queryRetry = {
  /** Waits before each retry; the last one repeats. */
  delaysMs: [1000, 2000, 5000, 10_000, 30_000],
  /** How long a query stays dropped, so that asking again reaches the server (the client forgets it at once). */
  gapMs: 300,
};

// ---------------------------------------------------------------------------------------------------------------
// Retries are shared by every hook watching the same query with the same arguments, because the client keeps a
// query (and its error) while anyone still watches it: they all drop it together, so it's really asked again.

interface Retry {
  attempt: number;
  /** The last answer was an error, and no good one has come since. */
  failed: boolean;
  /** Dropped right now (the hooks pass "skip"). */
  dropped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
}

const retries = new Map<string, Retry>();

function retryOf(key: string): Retry {
  let r = retries.get(key);
  if (!r) retries.set(key, (r = { attempt: 0, failed: false, dropped: false, timer: null, listeners: new Set() }));
  return r;
}

function notify(r: Retry) {
  for (const l of [...r.listeners]) l();
}

function forget(key: string, r: Retry) {
  if (r.listeners.size === 0 && !r.timer && !r.dropped && retries.get(key) === r) retries.delete(key);
}

function drop(key: string, r: Retry) {
  if (r.timer) clearTimeout(r.timer);
  r.dropped = true;
  r.attempt += 1;
  notify(r);
  r.timer = setTimeout(() => {
    r.timer = null;
    r.dropped = false;
    notify(r);
    forget(key, r);
  }, queryRetry.gapMs);
}

/** The query failed: retry it after the next delay (unless a retry is already on its way). */
function scheduleRetry(key: string) {
  const r = retryOf(key);
  if (!r.failed) {
    r.failed = true;
    notify(r);
  }
  if (r.timer || r.dropped) return;
  const delay = queryRetry.delaysMs[Math.min(r.attempt, queryRetry.delaysMs.length - 1)];
  r.timer = setTimeout(() => {
    r.timer = null;
    drop(key, r);
  }, delay);
}

/** Retry now (a Try again button). */
function retryNow(key: string) {
  const r = retryOf(key);
  if (r.dropped) return;
  drop(key, r);
}

/** It answered: the next failure starts from the shortest wait again. */
function succeeded(key: string) {
  const r = retries.get(key);
  if (!r || r.dropped) return;
  r.attempt = 0;
  if (r.failed) {
    r.failed = false;
    notify(r);
  }
  if (r.timer) clearTimeout(r.timer);
  r.timer = null;
  forget(key, r);
}

const DROPPED = 1;
const FAILED = 2;

/** Whether the query is dropped for a retry right now (DROPPED) and whether its last try failed (FAILED). */
function useRetryFlags(key: string | null): number {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (key === null) return () => undefined;
      const r = retryOf(key);
      r.listeners.add(cb);
      return () => {
        r.listeners.delete(cb);
        forget(key, r);
      };
    },
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => {
      const r = key === null ? undefined : retries.get(key);
      return r ? (r.dropped ? DROPPED : 0) | (r.failed ? FAILED : 0) : 0;
    },
    () => 0,
  );
}

function keyOf(query: FunctionReference<"query">, args: unknown): string | null {
  if (args === "skip") return null;
  return `${getFunctionName(query)}|${JSON.stringify(convexToJson((args ?? {}) as Value))}`;
}

/** Errors a boundary turns into a screen, so they still throw: E2eeGate's "unlock this device" (lib/e2ee/router). */
export function throwsToBoundary(error: Error): boolean {
  const data = (error as { data?: unknown }).data;
  return typeof data === "object" && data !== null && (data as { code?: unknown }).code === "e2ee_locked_session";
}

/** convex/react's own useQuery, which throws a failure to the nearest boundary: only under a boundary that handles it. */
export { useQuery as useQueryOrThrow } from "convex/react";

const logged = new WeakSet<Error>();
function logOnce(name: string, error: Error) {
  if (logged.has(error)) return;
  logged.add(error);
  // For whoever is looking into it; the page carries on and retries.
  console.warn(`Folevi: the query ${name} failed; retrying.`, error);
}

// ---------------------------------------------------------------------------------------------------------------

export type QueryState<T> = {
  /** The latest result, or the last good one while a failed query retries; undefined while it first loads. */
  data: T | undefined;
  /** The last try failed (a retry is on its way). `data` may still hold an earlier result. */
  failed: boolean;
  error: Error | undefined;
  /** Ask again now. */
  retry: () => void;
};

/** A query with its failure: what a list needs to show "Couldn't load" instead of loading forever. */
export function useQueryState<Query extends FunctionReference<"query">>(query: Query, ...args: OptionalRestArgsOrSkip<Query>): QueryState<FunctionReturnType<Query>> {
  const raw = args[0];
  const skip = raw === "skip";
  const key = keyOf(query, skip ? "skip" : (raw ?? {}));
  const flags = useRetryFlags(key);
  const dropped = (flags & DROPPED) !== 0;
  const name = getFunctionName(query);
  const asked: Parameters<typeof useQueries>[0] = skip || dropped ? {} : { q: { query, args: (raw ?? {}) as Record<string, Value> } };
  // useQueries compares by identity; the key carries the arguments' value.
  const queries = useMemoByKey(asked, skip || dropped ? null : key);
  const result = useQueries(queries).q as FunctionReturnType<Query> | Error | undefined;
  const error = result instanceof Error ? result : undefined;
  const value = result instanceof Error ? undefined : result;
  if (error && throwsToBoundary(error)) throw error;

  // The last good answer for these arguments, shown while a failure retries.
  const last = useRef<{ key: string | null; value: FunctionReturnType<Query> | undefined }>({ key: null, value: undefined });
  if (last.current.key !== key) last.current = { key, value: undefined };
  if (value !== undefined) last.current.value = value;

  useEffect(() => {
    if (key === null) return;
    if (error) {
      logOnce(name, error);
      scheduleRetry(key);
    } else if (value !== undefined) succeeded(key);
  }, [key, name, error, value]);

  const retry = useCallback(() => {
    if (key !== null) retryNow(key);
  }, [key]);
  if (skip) return { data: undefined, failed: false, error: undefined, retry };
  return { data: value ?? last.current.value, failed: !!error || (flags & FAILED) !== 0, error, retry };
}

/**
 * convex/react's `useQuery`, except that a failed query is still loading (undefined, or its last good result)
 * and is retried, instead of throwing to the page's error screen.
 */
export function useQuery<Query extends FunctionReference<"query">>(query: Query, ...args: OptionalRestArgsOrSkip<Query>): FunctionReturnType<Query> | undefined {
  return useQueryState(query, ...args).data;
}

function useMemoByKey<T>(value: T, key: string | null): T {
  const ref = useRef<{ key: string | null; value: T } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}

// ---------------------------------------------------------------------------------------------------------------

type PaginatedInternal = <Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query> | "skip",
  options: { initialNumItems: number },
  throwOnError: boolean,
) => { user: UsePaginatedQueryReturnType<Query> | (Omit<UsePaginatedQueryReturnType<Query>, "status" | "isLoading"> & { status: "Error"; isLoading: false; error: Error }) };

// The stable usePaginatedQuery is this with throwOnError true; convex/react exports it but doesn't type it.
// Read when called, not at import: a test's mock of convex/react may not have it.
const paginatedInternal: PaginatedInternal = (...args) => (ConvexReact as unknown as { usePaginatedQueryInternal: PaginatedInternal }).usePaginatedQueryInternal(...args);

export type SafePaginatedResult<Query extends PaginatedQueryReference> = UsePaginatedQueryReturnType<Query> & {
  /** The last try failed (a retry is on its way); `results` keeps what was loaded before. */
  failed: boolean;
  retry: () => void;
};

/**
 * convex/react's `usePaginatedQuery`, except that a failed page doesn't throw: the list keeps what it had loaded
 * and the query starts over from its first page after the retry wait (or at once with `retry()`).
 */
export function usePaginatedQuery<Query extends PaginatedQueryReference>(query: Query, args: PaginatedQueryArgs<Query> | "skip", options: { initialNumItems: number }): SafePaginatedResult<Query> {
  const skip = args === "skip";
  const key = keyOf(query, skip ? "skip" : { ...(args as object), "~paginated": options.initialNumItems });
  const flags = useRetryFlags(key);
  const dropped = (flags & DROPPED) !== 0;
  const name = getFunctionName(query);
  const result = paginatedInternal(query, skip || dropped ? "skip" : args, options, false).user;
  const error = result.status === "Error" ? (result as { error: Error }).error : undefined;
  if (error && throwsToBoundary(error)) throw error;
  const ok = result.status === "CanLoadMore" || result.status === "Exhausted";

  const last = useRef<{ key: string | null; results: UsePaginatedQueryReturnType<Query>["results"] }>({ key: null, results: [] });
  if (last.current.key !== key) last.current = { key, results: [] };
  if (ok && !dropped) last.current.results = result.results;

  useEffect(() => {
    if (key === null) return;
    if (error) {
      logOnce(name, error);
      scheduleRetry(key);
    } else if (ok) succeeded(key);
  }, [key, name, error, ok]);

  const retry = useCallback(() => {
    if (key !== null) retryNow(key);
  }, [key]);
  if (skip) return { ...(result as UsePaginatedQueryReturnType<Query>), failed: false, retry };
  if (error || dropped) {
    const kept = last.current.results;
    // Still loading, as far as the page is concerned: what was loaded stays, and nothing more can load yet.
    const loading = kept.length
      ? ({ results: kept, status: "LoadingMore", isLoading: true, loadMore: () => undefined } as const)
      : ({ results: kept, status: "LoadingFirstPage", isLoading: true, loadMore: () => undefined } as const);
    return { ...(loading as unknown as UsePaginatedQueryReturnType<Query>), failed: !!error || (flags & FAILED) !== 0, retry };
  }
  return { ...(result as UsePaginatedQueryReturnType<Query>), failed: false, retry };
}

/** Tests: forget every retry. */
export function resetQueryRetries() {
  for (const r of retries.values()) if (r.timer) clearTimeout(r.timer);
  retries.clear();
}
