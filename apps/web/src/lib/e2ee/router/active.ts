// The page's active router, if this account has end-to-end encryption (docs/E2EE_DESIGN.md §6.4, WP7). Kept
// apart from client.ts so the light parts (the hooks, `isSealedDocument`, the uploader's check) don't pull in
// the router, the replica and the local backend for Standard accounts, which never load them.
import type { E2eeRouterClient } from "./client";

let active: E2eeRouterClient | null = null;
const listeners = new Set<() => void>();

/** Set by lib/convex/provider.tsx when it wraps the Convex client (null when it doesn't, or on sign-out). */
export function setActiveRouter(router: E2eeRouterClient | null): void {
  if (active === router) return;
  active = router;
  for (const l of [...listeners]) l();
}

export function activeRouter(): E2eeRouterClient | null {
  return active;
}

export function requireActiveRouter(): E2eeRouterClient {
  if (!active) throw new Error("End-to-end encryption isn't set up on this account.");
  return active;
}

/** Hears the active router being set or cleared. */
export function onActiveRouter(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
