import "server-only";
import { headers } from "next/headers";

/**
 * Structured, redacted server logs for Next.js routes, server actions and server components.
 *
 * - Every line is one JSON object with `event`, `requestId` and a timestamp.
 * - Only allow-listed scalar fields are kept; anything that could carry note content, emails, tokens,
 *   passwords, cookies or IPs is dropped by name, and long strings are cut.
 * - The request id is taken from a trusted upstream header when present (so it matches platform
 *   logs), otherwise generated, and echoed back as `x-request-id` by `withRequestLog`.
 */

type Scalar = string | number | boolean | null;
export type LogFields = Record<string, Scalar | undefined>;

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const SENSITIVE_KEY = /pass|secret|token|cookie|auth|email|mail|ip|address|content|body|title|text|name|query|url|path|search|key/i;
/** Keys that look sensitive by pattern but are safe structural fields. */
const SAFE_KEYS = new Set(["event", "requestId", "route", "method", "status", "durationMs", "outcome", "code", "level", "ts"]);

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Picks a request id from upstream headers (x-request-id, Vercel's x-vercel-id) or makes one. */
export function requestIdFrom(h: Pick<Headers, "get">): string {
  for (const name of ["x-request-id", "x-vercel-id"]) {
    const v = h.get(name)?.trim();
    if (v && REQUEST_ID_RE.test(v)) return v;
  }
  return newRequestId();
}

/** Request id for the current server component / action (reads the incoming headers). */
export async function currentRequestId(): Promise<string> {
  try {
    return requestIdFrom(await headers());
  } catch {
    // Outside a request scope (build time): still correlate this line with nothing else.
    return newRequestId();
  }
}

/** Keeps only safe, scalar fields (exported for tests). */
export function redact(fields: LogFields): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (!SAFE_KEYS.has(k) && SENSITIVE_KEY.test(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return out;
}

export function logEvent(level: "info" | "warn" | "error", event: string, fields: LogFields & { requestId: string }): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Wraps a route handler: assigns a request id, logs method/route/status/duration (never the URL
 * query, headers or body), echoes `x-request-id`, and logs unexpected errors as a redacted line
 * before returning a generic 500.
 */
export function withRequestLog<Args extends unknown[]>(route: string, handler: (request: Request, ...rest: Args) => Promise<Response> | Response) {
  return async (request: Request, ...rest: Args): Promise<Response> => {
    const requestId = requestIdFrom(request.headers);
    const started = Date.now();
    try {
      const response = await handler(request, ...rest);
      const tagged = withHeader(response, "x-request-id", requestId);
      logEvent(response.status >= 500 ? "error" : "info", "http.request", { requestId, route, method: request.method, status: response.status, durationMs: Date.now() - started });
      return tagged;
    } catch (error) {
      logEvent("error", "http.unhandled", {
        requestId,
        route,
        method: request.method,
        durationMs: Date.now() - started,
        code: error instanceof Error ? error.name : "unknown",
      });
      return new Response("Something went wrong.", { status: 500, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
    }
  };
}

function withHeader(response: Response, name: string, value: string): Response {
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    // Immutable headers (e.g. a fetched Response passed through): copy into a new response.
    const copy = new Response(response.body, response);
    copy.headers.set(name, value);
    return copy;
  }
}
