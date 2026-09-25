import type { AuthConfig } from "convex/server";

/**
 * Identity providers trusted by the backend. Convex validates issuer, audience (applicationID), expiry
 * and signature of every token before `ctx.auth.getUserIdentity()` returns an identity.
 *
 * - Auth0 web (Regular Web Application) and Auth0 macOS (Native Application) share one tenant but have
 *   different client ids, so each gets its own entry.
 * - The development issuer exists ONLY when FOLEVI_DEV_AUTH_JWKS holds a key set (local/dev).
 *   Production sets it to "none"; `scripts/check-prod-env.mjs` fails a deploy otherwise.
 *
 * Convex requires every variable referenced here to exist on each deployment, so unused ones are set
 * to the literal "none".
 */
const providers: AuthConfig["providers"] = [];
const configured = (value: string | undefined): value is string => Boolean(value) && value !== "none";

const auth0Domain = process.env.AUTH0_DOMAIN;
if (configured(auth0Domain)) {
  const domain = auth0Domain.startsWith("https://") ? auth0Domain : `https://${auth0Domain}/`;
  for (const clientId of [process.env.AUTH0_WEB_CLIENT_ID, process.env.AUTH0_MAC_CLIENT_ID]) {
    if (configured(clientId)) providers.push({ domain, applicationID: clientId });
  }
}

const devJwks = process.env.FOLEVI_DEV_AUTH_JWKS;
if (configured(devJwks) && process.env.FOLEVI_ENV !== "production") {
  providers.push({
    type: "customJwt",
    applicationID: "folevi-dev",
    issuer: configured(process.env.FOLEVI_DEV_AUTH_ISSUER) ? process.env.FOLEVI_DEV_AUTH_ISSUER : "http://localhost:3000/dev-auth",
    jwks: `data:text/plain;charset=utf-8;base64,${btoa(devJwks)}`,
    algorithm: "RS256",
  });
}

export default { providers } satisfies AuthConfig;
