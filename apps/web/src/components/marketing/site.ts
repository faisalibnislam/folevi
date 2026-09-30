import { APP_URL, MARKETING_URL } from "@/lib/env";

export const SIGN_IN_URL = `${APP_URL}/signin`;
export const SIGN_UP_URL = `${APP_URL}/signup`;
export const WEB_APP_URL = APP_URL;
export const SECURITY_EMAIL = "security@folevi.com";
export const SUPPORT_EMAIL = "support@folevi.com";

/** Sign-up link that names a built-in template, so the app can offer it after sign-up. */
export function signUpWithTemplate(key: string): string {
  return `${SIGN_UP_URL}?template=${encodeURIComponent(key)}`;
}

export const PRIMARY_NAV = [
  { label: "Features", href: "/features" },
  { label: "Mac", href: "/mac" },
  { label: "Security", href: "/security" },
  { label: "Pricing", href: "/pricing" },
  { label: "Support", href: "/support" },
] as const;

/**
 * The fixed marketing routes, for the sitemap. `updated` is the day the page's content last changed
 * (YYYY-MM-DD). Change it in the same commit as the page. Feature, template and docs pages carry their own
 * dates next to their content (content/features.tsx, content/templates.ts, content/docs.tsx).
 */
export const MARKETING_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/features", priority: 0.9, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/mac", priority: 0.8, changeFrequency: "monthly", updated: "2026-09-29" },
  { path: "/security", priority: 0.8, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/template-gallery", priority: 0.7, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/docs", priority: 0.7, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/status", priority: 0.3, changeFrequency: "monthly", updated: "2026-09-29" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly", updated: "2026-09-30" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly", updated: "2026-09-30" },
] as const;

export function absoluteUrl(path: string): string {
  return new URL(path, MARKETING_URL).toString();
}

/** "2026-09-30" → "30 September 2026" (UTC, so the day never shifts). */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
