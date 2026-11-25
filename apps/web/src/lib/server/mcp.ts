import "server-only";
import { runtimeConfig } from "@/lib/runtime/config";
import { internalConvexSiteUrl } from "@/lib/runtime/internal";

/** Where Convex HTTP actions live (the MCP server and Better Auth). */
export function convexSiteUrl(): string {
  return internalConvexSiteUrl().replace(/\/$/, "");
}

/** The app's public origin (the MCP resource and the OAuth issuer live under it). */
export function appOrigin(): string {
  try {
    return new URL(runtimeConfig().appUrl).origin;
  } catch {
    return "https://app.folevi.com";
  }
}

/** Metadata documents are public and cacheable for a short while. */
export const METADATA_HEADERS = { "content-type": "application/json", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } as const;
