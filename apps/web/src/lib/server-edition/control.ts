import "server-only";
// The web server's side of folevid's control API (docs/self-hosting/CONTRACT.md §5): loopback only, a bearer
// secret, JSON in and out. Only /api/server/* calls it, after checking the person is the owner or an admin.
// The paths the admin panel may reach are listed here; anything else is refused before it leaves this process.

export type ControlAccess = "admin" | "owner";

interface ControlRoute {
  method: "GET" | "POST" | "PUT";
  /** The path under /api/server, without the leading slash. `{id}` is a backup id. */
  pattern: RegExp;
  /** Who may call it: admins read health and logs; the owner changes backups and remote access (plan §5). */
  access: ControlAccess;
  /** Query parameters passed on. */
  query?: string[];
}

const ROUTES: ControlRoute[] = [
  { method: "GET", pattern: /^status$/, access: "admin" },
  { method: "GET", pattern: /^logs$/, access: "admin", query: ["service", "lines"] },
  { method: "GET", pattern: /^backups$/, access: "admin" },
  // `wait=1`: answer when the backup is done (CONTRACT §10.1), so "Back up now" can say it worked.
  { method: "POST", pattern: /^backups$/, access: "owner", query: ["wait"] },
  // The backup key opens every backup: the owner only, never cached (folevid sends no-store too).
  { method: "GET", pattern: /^backups\/key$/, access: "owner" },
  { method: "PUT", pattern: /^backups\/schedule$/, access: "owner" },
  { method: "POST", pattern: /^backups\/[A-Za-z0-9._-]{1,80}\/restore$/, access: "owner" },
  { method: "GET", pattern: /^remote$/, access: "admin" },
  { method: "PUT", pattern: /^remote$/, access: "owner" },
  { method: "POST", pattern: /^connect\/link$/, access: "owner" },
  { method: "GET", pattern: /^update$/, access: "admin" },
  { method: "POST", pattern: /^diagnostics$/, access: "admin" },
];

/** The route a request may use, or null. */
export function controlRoute(method: string, path: string): ControlRoute | null {
  return ROUTES.find((r) => r.method === method && r.pattern.test(path)) ?? null;
}

const QUERY_VALUE = /^[A-Za-z0-9_-]{1,32}$/;

/** Calls folevid. Throws when it isn't configured; a non-2xx answer comes back as it is. */
export async function callControl(route: ControlRoute, path: string, search: URLSearchParams, body: string | null): Promise<Response> {
  const base = process.env.FOLEVI_CONTROL_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!base || !secret) throw new Error("control_not_configured");
  const query = new URLSearchParams();
  for (const name of route.query ?? []) {
    const value = search.get(name);
    if (value && QUERY_VALUE.test(value)) query.set(name, value);
  }
  const url = `${base.replace(/\/+$/, "")}/v1/${path}${query.size ? `?${query}` : ""}`;
  return fetch(url, {
    method: route.method,
    headers: { authorization: `Bearer ${secret}`, accept: "application/json", ...(body !== null ? { "content-type": "application/json" } : {}) },
    body: body ?? undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(route.method === "GET" ? 10_000 : path === "backups" ? 15 * 60_000 : 60_000),
  });
}
