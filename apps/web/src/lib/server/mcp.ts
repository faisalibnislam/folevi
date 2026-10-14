import "server-only";

/** Where Convex HTTP actions live (the MCP server and Better Auth). */
export function convexSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site")).replace(/\/$/, "");
}

/** The app's public origin (the MCP resource and the OAuth issuer live under it). */
export function appOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com").origin;
  } catch {
    return "https://app.folevi.com";
  }
}

/** Metadata documents are public and cacheable for a short while. */
export const METADATA_HEADERS = { "content-type": "application/json", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } as const;
