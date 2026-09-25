import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { APP_HOST, MARKETING_URL } from "@/lib/env";

// Product-only paths (kept in step with proxy.ts). Nothing behind sign-in, and no share links, is crawlable.
const APP_PATHS = [
  "/api/",
  "/admin",
  "/s/",
  "/d/",
  "/documents",
  "/tasks",
  "/calendar",
  "/daily",
  "/shared",
  "/templates",
  "/starred",
  "/archive",
  "/trash",
  "/unsorted",
  "/folders",
  "/tags",
  "/settings",
  "/help",
  "/onboarding",
  "/invite",
  "/signin",
  "/signup",
  "/verify-email",
  "/signout",
  "/auth/",
  "/dev-auth",
  "/offline",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  // Only the production marketing host is indexable. Previews, local builds and the app host are not.
  if (process.env.VERCEL_ENV !== "production" || host === APP_HOST) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: APP_PATHS }],
    sitemap: `${MARKETING_URL}/sitemap.xml`,
    host: MARKETING_URL,
  };
}
