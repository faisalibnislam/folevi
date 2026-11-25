// Which product this backend is: Folevi Cloud (the default) or Folevi Server, the self-hosted edition
// (docs/SELF_HOSTING_PLAN.md, docs/self-hosting/CONTRACT.md §1). `FOLEVI_EDITION=server` turns the server
// edition on; unset (or "cloud") is Folevi Cloud, which must behave exactly as it always has. Every server-only
// behavior checks `isServerEdition()` first, so a cloud deployment never reaches it.

/** Whether this deployment is Folevi Server (FOLEVI_EDITION=server). */
export function isServerEdition(): boolean {
  // Also imported by browser code (lib/plans.ts through apps/web), where there may be no `process`.
  const env = typeof process === "undefined" ? undefined : process.env;
  return (env?.FOLEVI_EDITION ?? "").trim().toLowerCase() === "server";
}

/** The edition's name as clients see it in /.well-known/folevi.json (`kind`). */
export function editionKind(): "folevi-server" | "folevi-cloud" {
  return isServerEdition() ? "folevi-server" : "folevi-cloud";
}

/** Folevi Connect's base address (CONTRACT §9), without a trailing slash. Overridable for tests. */
export function connectUrl(): string {
  const raw = (process.env.FOLEVI_CONNECT_URL ?? "").trim();
  return (raw && /^https?:\/\//i.test(raw) ? raw : "https://connect.folevi.com").replace(/\/+$/, "");
}

/** The server's Connect token (CONTRACT §4), once the server registered with Connect; null before. */
export function connectToken(): string | null {
  const token = (process.env.FOLEVI_CONNECT_TOKEN ?? "").trim();
  return token && token !== "none" ? token : null;
}

/** The server bundle's version (FOLEVI_SERVER_VERSION), or "dev" when it isn't set. */
export function serverVersion(): string {
  const version = (process.env.FOLEVI_SERVER_VERSION ?? "").trim();
  return version || "dev";
}

/**
 * The oldest app that can use a Folevi Server (CONTRACT §6 `minAppVersion`): the first release with
 * "Your own server" at sign-in.
 */
export const MIN_APP_VERSION = "1.6.0";

/** The API version of /.well-known/folevi.json (CONTRACT §6). Apps refuse a server whose version they don't know. */
export const SERVER_API_VERSION = 1;
