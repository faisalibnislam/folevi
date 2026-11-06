import { APP_URL, MARKETING_URL } from "@/lib/env";

export const SIGN_IN_URL = `${APP_URL}/signin`;
export const SIGN_UP_URL = `${APP_URL}/signup`;
export const WEB_APP_URL = APP_URL;
/** Folevi for Mac's latest DMG: the update bucket through folevi.com/download (next.config.ts, docs/MAC_RELEASE.md). */
export const MAC_DOWNLOAD_URL = "https://folevi.com/download/mac/Folevi.dmg";
/**
 * Folevi for iPhone and iPad on the App Store. TODO(owner, 2026-11-07): replace with the app's own App Store link
 * (https://apps.apple.com/app/folevi/id…). Until then it opens an App Store search for Folevi.
 */
export const APP_STORE_URL = "https://apps.apple.com/us/search?term=Folevi";
/** The apps' minimum systems (apps/native-kit/Package.swift, apps/mac/project.yml). */
export const MAC_REQUIREMENT = "macOS 15 or later";
export const IOS_REQUIREMENT = "iOS 18 or iPadOS 18 or later";
export const SECURITY_EMAIL = "security@folevi.com";
export const SUPPORT_EMAIL = "support@folevi.com";

/** Sign-up link that names a built-in template, so the app can offer it after sign-up. */
export function signUpWithTemplate(key: string): string {
  return `${SIGN_UP_URL}?template=${encodeURIComponent(key)}`;
}

/**
 * The fixed marketing routes, for the sitemap. `updated` is the day the page's content last changed
 * (YYYY-MM-DD). Change it in the same commit as the page. Feature, template and docs pages carry their own
 * dates next to their content (content/features.tsx, content/templates.ts, content/docs.tsx).
 */
export const MARKETING_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/features", priority: 0.9, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/mac", priority: 0.8, changeFrequency: "monthly", updated: "2026-10-23" },
  { path: "/security", priority: 0.8, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/template-gallery", priority: 0.7, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/docs", priority: 0.7, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/status", priority: 0.3, changeFrequency: "monthly", updated: "2026-09-29" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly", updated: "2026-09-30" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly", updated: "2026-10-27" },
  { path: "/ai-policy", priority: 0.3, changeFrequency: "yearly", updated: "2026-10-27" },
] as const;

export function absoluteUrl(path: string): string {
  return new URL(path, MARKETING_URL).toString();
}

/** "2026-09-30" → "30 September 2026" (UTC, so the day never shifts). */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
