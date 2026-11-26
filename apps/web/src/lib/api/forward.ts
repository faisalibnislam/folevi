// What /api/v1/* asks of the backend (src/app/api/v1/[...path]/route.ts forwards the request as it is).

/**
 * The path and query to forward, or null when the request isn't for the REST API after all. An address is read
 * the way the forwarding fetch will read it, so "/api/v1/%2e%2e/%2e%2e/x" is "/x": without this check the app
 * would hand any of the backend's other routes out under its own name.
 */
export function restApiTarget(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const path = url.pathname;
  if (!path.startsWith("/api/v1/") || path.includes("\\") || /(^|\/)\.{1,2}(\/|$)/.test(path) || /%2e|%2f|%5c/i.test(path)) return null;
  return `${path}${url.search}`;
}
