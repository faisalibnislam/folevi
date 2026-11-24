// Folevi Server, the self-hosted edition (docs/SELF_HOSTING_PLAN.md §5.1). A server build is made with
// NEXT_PUBLIC_FOLEVI_EDITION=server and runs behind the server's one-origin proxy (scripts/self-host/server):
//   /             this web app
//   /convex       the Convex client API and its WebSocket
//   /convex-site  Convex HTTP actions
// so the browser reaches Convex on the page's own origin, whatever address the person typed. Server-side
// code reaches Convex directly on the loopback address the supervisor gives it. Folevi Cloud builds leave
// the flag unset, and every helper here falls back to the build-time NEXT_PUBLIC_* addresses as before.

/** Whether this is a Folevi Server build (no marketing site, no billing, runtime addresses). */
export const SERVER_EDITION = process.env.NEXT_PUBLIC_FOLEVI_EDITION === "server";

/** The Convex client address in the browser: the page's own origin on a server, the build's address otherwise. */
export function browserConvexUrl(): string | undefined {
  if (SERVER_EDITION && typeof window !== "undefined") return `${window.location.origin}/convex`;
  return process.env.NEXT_PUBLIC_CONVEX_URL;
}

/** The Convex client address for server-side calls (route handlers, server components, the auth bridge). */
export function serverConvexUrl(): string {
  return process.env.FOLEVI_INTERNAL_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "";
}

/** Convex HTTP actions for server-side calls. */
export function serverConvexSiteUrl(): string {
  return process.env.FOLEVI_INTERNAL_CONVEX_SITE_URL || process.env.NEXT_PUBLIC_CONVEX_SITE_URL || "";
}

/** What this server offers, from the server's own /.well-known/folevi.json (written by its supervisor). */
export interface ServerInfo {
  name: string;
  /** Whether Foli AI is set up (the owner gave the server an AI key). */
  ai: boolean;
}

let info: ServerInfo | null = null;
let loading = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loading || typeof window === "undefined") return;
  loading = true;
  fetch("/.well-known/folevi.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { name?: string; features?: { ai?: boolean } } | null) => {
      info = { name: j?.name ?? "Folevi Server", ai: j?.features?.ai === true };
      for (const l of listeners) l();
    })
    .catch(() => {});
}

/** For useSyncExternalStore: the server's info once it's loaded (null until then). Server edition only. */
export function subscribeServerInfo(listener: () => void): () => void {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function serverInfo(): ServerInfo | null {
  return info;
}
