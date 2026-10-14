import { convexSiteUrl, METADATA_HEADERS } from "@/lib/server/mcp";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) for the issuer https://app.folevi.com/api/auth, at
 * the path apps derive from it (/.well-known/oauth-authorization-server/api/auth) and the plain one. The
 * document itself comes from Better Auth's OAuth provider in Convex (convex/auth.ts).
 */
export async function GET() {
  const res = await fetch(`${convexSiteUrl()}/api/auth/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  return new Response(await res.text(), { headers: METADATA_HEADERS });
}
