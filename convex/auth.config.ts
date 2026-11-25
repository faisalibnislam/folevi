import type { AuthConfig } from "convex/server";
import { authProvider } from "./lib/jwks";

/**
 * The only identity provider the backend trusts: Folevi's own Better Auth issuer (convex/auth.ts).
 * Convex validates issuer (this deployment's site URL), audience ("convex"), expiry and the RS256
 * signature against the published JWKS before `ctx.auth.getUserIdentity()` returns an identity.
 * Folevi Server can give the keys inline (FOLEVI_JWKS, lib/jwks.ts) so the backend never fetches its own
 * public address; Folevi Cloud fetches them as it always has.
 */
export default {
  providers: [authProvider()],
} satisfies AuthConfig;
