import { appUrl, marketingUrl } from "@/lib/env";

export const SIGN_IN_URL = `${appUrl()}/signin`;
export const SIGN_UP_URL = `${appUrl()}/signup`;
export const WEB_APP_URL = appUrl();
/** Folevi for Mac's latest DMG: the update bucket through folevi.com/download (next.config.ts, docs/MAC_RELEASE.md). */
export const MAC_DOWNLOAD_URL = "https://folevi.com/download/mac/Folevi.dmg";
/** Folevi for Windows' latest installers, one per kind of PC (the same bucket through folevi.com/download, docs/WINDOWS.md). */
export const WINDOWS_DOWNLOAD_ARM64_URL = "https://folevi.com/download/windows/Folevi-arm64-setup.exe";
export const WINDOWS_DOWNLOAD_X64_URL = "https://folevi.com/download/windows/Folevi-x64-setup.exe";
/** Folevi for Linux's latest packages, by format and kind of PC (folevi.com/download/linux). */
export const LINUX_DOWNLOADS = {
  appimage: { x64: "https://folevi.com/download/linux/Folevi-x86_64.AppImage", arm64: "https://folevi.com/download/linux/Folevi-aarch64.AppImage" },
  deb: { x64: "https://folevi.com/download/linux/Folevi-amd64.deb", arm64: "https://folevi.com/download/linux/Folevi-arm64.deb" },
  rpm: { x64: "https://folevi.com/download/linux/Folevi-x86_64.rpm", arm64: "https://folevi.com/download/linux/Folevi-aarch64.rpm" },
} as const;
export const LINUX_CHECKSUMS_URL = "https://folevi.com/download/linux/SHA256SUMS.txt";
/**
 * Folevi for iPhone and iPad on the App Store. TODO(owner, 2026-11-07): replace with the app's own App Store link
 * (https://apps.apple.com/app/folevi/id…). Until then it opens an App Store search for Folevi.
 */
export const APP_STORE_URL = "https://apps.apple.com/us/search?term=Folevi";
/** The apps' minimum systems (apps/native-kit/Package.swift, apps/mac/project.yml). */
export const MAC_REQUIREMENT = "macOS 26 or later";
export const IOS_REQUIREMENT = "iOS 26 or iPadOS 26 or later";
/** Folevi for Android, signed with Google Play’s app signing key so a later Play install updates it (PR manager, 2026-11-27). */
export const ANDROID_DOWNLOAD_URL = "https://folevi.com/download/android/Folevi.apk";
export const ANDROID_REQUIREMENT = "Android 13 or later";
/** It doesn’t update itself while there is no public Play listing, and Android asks once to allow installs from the browser. */
export const ANDROID_INSTALL_NOTE = "The first time, Android asks you to allow installs from your browser. It doesn’t update itself yet, so get new versions here.";
export const WINDOWS_REQUIREMENT = "Windows 11 or Windows 10 (22H2), on Arm or Intel and AMD PCs";
/** The Windows installers aren't code signed yet (docs/DESKTOP_APP.md), so SmartScreen asks first. Drop this once they are. */
export const WINDOWS_SMARTSCREEN_NOTE = "This early build isn’t signed yet, so Windows SmartScreen asks you to confirm it: choose More info, then Run anyway.";
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
  { path: "/", priority: 1, changeFrequency: "weekly", updated: "2026-11-19" },
  { path: "/apps", priority: 0.9, changeFrequency: "monthly", updated: "2026-11-26" },
  { path: "/downloads", priority: 0.8, changeFrequency: "monthly", updated: "2026-11-26" },
  { path: "/features", priority: 0.9, changeFrequency: "monthly", updated: "2026-11-06" },
  { path: "/mac", priority: 0.8, changeFrequency: "monthly", updated: "2026-11-19" },
  { path: "/windows", priority: 0.8, changeFrequency: "monthly", updated: "2026-11-27" },
  { path: "/linux", priority: 0.7, changeFrequency: "monthly", updated: "2026-11-27" },
  { path: "/server", priority: 0.7, changeFrequency: "weekly", updated: "2026-11-26" },
  { path: "/security", priority: 0.8, changeFrequency: "monthly", updated: "2026-11-06" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly", updated: "2026-11-19" },
  { path: "/template-gallery", priority: 0.7, changeFrequency: "monthly", updated: "2026-09-30" },
  { path: "/docs", priority: 0.7, changeFrequency: "weekly", updated: "2026-09-30" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly", updated: "2026-11-06" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly", updated: "2026-11-19" },
  { path: "/status", priority: 0.3, changeFrequency: "monthly", updated: "2026-09-29" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly", updated: "2026-09-30" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly", updated: "2026-10-27" },
  { path: "/ai-policy", priority: 0.3, changeFrequency: "yearly", updated: "2026-10-27" },
] as const;

export function absoluteUrl(path: string): string {
  return new URL(path, marketingUrl()).toString();
}

/** "2026-09-30" → "30 September 2026" (UTC, so the day never shifts). */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The company that operates Folevi (owner, 2026-11-27): named in the footer, the terms, the privacy policy,
 *  the support page and the Organization data for search engines. */
export const OPERATOR = {
  name: "Space Cherries LLC",
  url: "https://www.spacecherries.com",
  street: "5242 Elbetee Lane",
  city: "Alexandria",
  region: "VA",
  postalCode: "22312",
  country: "USA",
  countryCode: "US",
} as const;
/** "5242 Elbetee Lane, Alexandria, VA 22312, USA" */
export const OPERATOR_ADDRESS = `${OPERATOR.street}, ${OPERATOR.city}, ${OPERATOR.region} ${OPERATOR.postalCode}, ${OPERATOR.country}`;
/** The copyright line the apps, their metadata and their installers carry: "© 2026 Space Cherries LLC". The
 *  year is the first year Folevi was published under the company, so it stays put (the website's footer shows the
 *  current year instead). */
export const OPERATOR_COPYRIGHT = `© 2026 ${OPERATOR.name}`;
