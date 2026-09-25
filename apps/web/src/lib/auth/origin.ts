import "server-only";
import { APP_HOST, MARKETING_HOST } from "@/lib/env";

/** Rejects cross-site state-changing requests (defense in depth on top of SameSite cookies). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  try {
    const o = new URL(origin);
    return o.host === host || o.host === APP_HOST || o.host === MARKETING_HOST;
  } catch {
    return false;
  }
}
