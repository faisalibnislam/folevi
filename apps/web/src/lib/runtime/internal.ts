import "server-only";
// Where the web server itself reaches Convex (docs/self-hosting/CONTRACT.md §4, PHASE0.md item 3). On a server
// the public address may not be reachable from the machine itself (a NAS behind its router, Tailscale,
// Cloudflare), so folevid passes loopback addresses. Folevi Cloud sets neither and uses the public ones.
import { runtimeConfig } from "./config";

export function internalConvexUrl(): string {
  return process.env.FOLEVI_INTERNAL_CONVEX_URL || runtimeConfig().convexUrl;
}

export function internalConvexSiteUrl(): string {
  return process.env.FOLEVI_INTERNAL_CONVEX_SITE_URL || runtimeConfig().convexSiteUrl;
}
