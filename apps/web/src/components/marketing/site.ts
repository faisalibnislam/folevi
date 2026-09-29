import { APP_URL, MARKETING_URL } from "@/lib/env";

export const SIGN_IN_URL = `${APP_URL}/signin`;
export const SIGN_UP_URL = `${APP_URL}/signup`;
export const WEB_APP_URL = APP_URL;
export const SECURITY_EMAIL = "security@folevi.com";
export const SUPPORT_EMAIL = "support@folevi.com";

export const PRIMARY_NAV = [
  { label: "Product", href: "/#chapters" },
  { label: "Mac", href: "/mac" },
  { label: "Security", href: "/security" },
  { label: "Pricing", href: "/pricing" },
  { label: "Support", href: "/support" },
] as const;

/** Marketing routes, used by the sitemap and footer. */
export const MARKETING_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/mac", priority: 0.9, changeFrequency: "monthly" },
  { path: "/security", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs", priority: 0.7, changeFrequency: "weekly" },
  { path: "/support", priority: 0.6, changeFrequency: "monthly" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/status", priority: 0.3, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
] as const;

export function absoluteUrl(path: string): string {
  return new URL(path, MARKETING_URL).toString();
}
