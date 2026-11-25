// Static JWKS for Folevi Server (docs/self-hosting/PHASE0.md item 2). By default Convex fetches the keys that
// sign identity tokens from `${CONVEX_SITE_URL}/api/auth/convex/jwks`, so a backend behind a NAS reverse proxy,
// Tailscale or a tunnel must reach its own public address. With FOLEVI_JWKS set (server edition only), the keys
// are given to Convex inline as a data: URL instead, and the backend never fetches itself.
//
// FOLEVI_JWKS may hold either:
//   - the public key set `{"keys":[...]}`, as GET /api/auth/convex/jwks returns it (what folevid fetches from
//     http://127.0.0.1:3511 after the first deploy). Tokens keep being signed with the key in the database.
//   - the key rows Better Auth's `getLatestJwks` returns (an array with publicKey and privateKey), which the
//     @convex-dev/better-auth plugin then signs with too.
// Folevi Cloud never reads it.
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";

type Provider = ReturnType<typeof getAuthConfigProvider>;
type StaticJwks = { kind: "none" } | { kind: "rows"; jwks: string } | { kind: "public"; keys: unknown[] };

/** What FOLEVI_JWKS holds (none outside the server edition, or when it's empty or unreadable). */
export function staticJwks(env: Record<string, string | undefined> = process.env): StaticJwks {
  if ((env.FOLEVI_EDITION ?? "").trim().toLowerCase() !== "server") return { kind: "none" };
  const raw = (env.FOLEVI_JWKS ?? "").trim();
  if (!raw) return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(JSON.stringify({ event: "auth.jwks_unreadable" }));
    return { kind: "none" };
  }
  if (Array.isArray(parsed) && parsed.length && parsed.every((k) => k && typeof k === "object" && typeof (k as { publicKey?: unknown }).publicKey === "string")) {
    return { kind: "rows", jwks: raw };
  }
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  if (Array.isArray(keys) && keys.length && keys.every((k) => k && typeof k === "object" && typeof (k as { kty?: unknown }).kty === "string")) {
    return { kind: "public", keys };
  }
  console.error(JSON.stringify({ event: "auth.jwks_unreadable" }));
  return { kind: "none" };
}

/** Base64 of an ASCII/UTF-8 string, in any runtime. */
function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The identity provider Convex trusts (convex/auth.config.ts). */
export function authProvider(env: Record<string, string | undefined> = process.env): Provider {
  const s = staticJwks(env);
  if (s.kind === "rows") return getAuthConfigProvider({ jwks: s.jwks });
  if (s.kind === "public") {
    return {
      type: "customJwt",
      issuer: `${env.CONVEX_SITE_URL}`,
      applicationID: "convex",
      algorithm: "RS256",
      jwks: `data:text/plain;charset=utf-8;base64,${b64(JSON.stringify({ keys: s.keys }))}`,
    } as Provider;
  }
  return getAuthConfigProvider();
}

/**
 * What the Better Auth Convex plugin (convex/auth.ts) is given: its auth config and, for key rows, the keys it
 * signs with. With only public keys the plugin keeps signing with the database's key, so it gets the ordinary
 * (fetching) provider, which it only reads for the algorithm (it refuses a static config without the rows).
 */
export function pluginJwksOptions(env: Record<string, string | undefined> = process.env): { authConfig: { providers: Provider[] }; jwks?: string } {
  const s = staticJwks(env);
  if (s.kind === "rows") return { authConfig: { providers: [authProvider(env)] }, jwks: s.jwks };
  if (s.kind === "public") return { authConfig: { providers: [getAuthConfigProvider()] } };
  return { authConfig: { providers: [authProvider(env)] } };
}
