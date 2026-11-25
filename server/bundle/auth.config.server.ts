// Folevi Server's auth config. prepare-functions.mjs copies it over convex/auth.config.ts in the bundle's
// functions/ (Folevi Cloud keeps the repo's own convex/auth.config.ts, unchanged).
//
// Convex evaluates an auth config with a guarded environment: reading any variable that isn't set fails the
// deploy ("is used in auth config file but its value was not set"), and checks such as `in` don't see set
// values. So this file reads only what folevid always sets on a server: FOLEVI_JWKS (a single space until the
// keys exist, docs/self-hosting/CONTRACT.md 10.1) and Convex's own CONVEX_SITE_URL.
import type { AuthConfig } from "convex/server";
import { authProvider } from "./lib/jwks";

export default {
  providers: [authProvider({ FOLEVI_EDITION: "server", FOLEVI_JWKS: process.env.FOLEVI_JWKS, CONVEX_SITE_URL: process.env.CONVEX_SITE_URL })],
} satisfies AuthConfig;
