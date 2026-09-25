// Host configuration. The same Next.js app serves the marketing site (folevi.com) and the product
// (app.folevi.com, including /admin). Locally: http://localhost:3000 and http://app.localhost:3000.
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com";

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export const MARKETING_HOST = hostOf(MARKETING_URL);
export const APP_HOST = hostOf(APP_URL);

/**
 * Development sign-in (a local token issuer, no Auth0) is available only when explicitly enabled and
 * never on a Vercel production deployment. `next start` builds (NODE_ENV=production) additionally need
 * FOLEVI_ALLOW_DEV_AUTH_BUILD=1, which is only ever set for local production-like previews and CI.
 */
export function isDevAuthEnabled(): boolean {
  if (process.env.FOLEVI_DEV_AUTH !== "1") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.FOLEVI_ALLOW_DEV_AUTH_BUILD === "1";
}

export function isAuth0Configured(): boolean {
  return Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && process.env.AUTH0_SECRET);
}
