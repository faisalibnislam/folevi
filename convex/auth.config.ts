import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";

/**
 * The only identity provider the backend trusts: Folevi's own Better Auth issuer (convex/auth.ts).
 * Convex validates issuer (this deployment's site URL), audience ("convex"), expiry and the RS256
 * signature against the published JWKS before `ctx.auth.getUserIdentity()` returns an identity.
 */
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
