import "server-only";
import { appHost, marketingHost } from "@/lib/env";

/** Rejects cross-site state-changing requests (defense in depth on top of SameSite cookies). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin) return request.method === "GET" || request.method === "HEAD";
  try {
    const o = new URL(origin);
    return o.host === host || o.host === appHost() || o.host === marketingHost();
  } catch {
    return false;
  }
}
