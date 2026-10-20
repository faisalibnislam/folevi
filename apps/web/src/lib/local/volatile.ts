// Dependency keys for state that lives in memory, outside the library (docs/LOCAL_MODE_PLAN.md §2.2): a Foli AI
// answer being written (`stream:<id>`), what the active model can do (`ai:state`). A query that reads such
// state calls `ctx.watch(key)`; whoever changes it calls `touchVolatile(key)`, and every backend in this page
// re-runs the queries that watched it, the same way a store commit does. Nothing here is ever written to disk.

type Listener = (keys: readonly string[]) => void;

const listeners = new Set<Listener>();
let pending: Set<string> | null = null;

/** Tells every backend in this page that these keys changed (batched into one microtask). */
export function touchVolatile(...keys: string[]): void {
  if (!keys.length) return;
  if (pending) {
    for (const k of keys) pending.add(k);
    return;
  }
  pending = new Set(keys);
  queueMicrotask(() => {
    const batch = [...(pending ?? [])];
    pending = null;
    for (const l of [...listeners]) l(batch);
  });
}

/** Called by each LocalBackend (backend.ts). Returns the unsubscribe. */
export function subscribeVolatile(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
