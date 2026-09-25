import type { MetadataRoute } from "next";
import { MARKETING_ROUTES, absoluteUrl } from "@/components/marketing/site";

// Marketing pages only. Product, admin and share URLs are never listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-25T00:00:00Z");
  return MARKETING_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
