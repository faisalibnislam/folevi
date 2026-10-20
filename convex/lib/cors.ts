// Who may read signed file bytes cross-origin (convex/http.ts `/files/:id`): the app's own origin
// (FOLEVI_APP_URL), the interface built into the apps (docs/LOCAL_MODE_PLAN.md §1, WP4), and local
// development hosts outside production. No imports, so tests can load it on its own.

/**
 * The apps' built-in interface: the Mac app's privileged scheme and, later, the iPhone and iPad app's
 * Capacitor origin. Allowed in every environment, production included, so nothing about them depends on
 * the development rule below (capacitor://localhost has the hostname "localhost").
 */
export const SHELL_ORIGINS: readonly string[] = ["app://folevi", "capacitor://localhost"];

const DEV_HOST = (host: string) => host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

/** Whether `origin` (an Origin header) may read the bytes. */
export function corsAllowed(origin: string | null, env: { appUrl?: string; deployment?: string } = {}): boolean {
  if (!origin) return false;
  if (SHELL_ORIGINS.includes(origin)) return true;
  try {
    const app = env.appUrl ? new URL(env.appUrl).origin : null;
    if (origin === app) return true;
    if (env.deployment === "production") return false;
    // Development pages only: http(s) on a local host. Other schemes never pass this rule.
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && DEV_HOST(url.hostname);
  } catch {
    return false;
  }
}

/** The CORS headers for a file response, or none. */
export function corsFor(origin: string | null): Record<string, string> {
  const allowed = corsAllowed(origin, { appUrl: process.env.FOLEVI_APP_URL, deployment: process.env.FOLEVI_ENV });
  return allowed ? { "access-control-allow-origin": origin!, vary: "origin" } : {};
}
