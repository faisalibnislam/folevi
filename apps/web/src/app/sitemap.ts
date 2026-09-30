import type { MetadataRoute } from "next";
import { LATEST_RELEASE_DATE } from "@/components/marketing/content/changelog";
import { DOC_ARTICLES, docPath } from "@/components/marketing/content/docs";
import { FEATURES, featurePath } from "@/components/marketing/content/features";
import { GALLERY_TEMPLATES, TEMPLATE_GALLERY_UPDATED, templatePath } from "@/components/marketing/content/templates";
import { MARKETING_ROUTES, absoluteUrl } from "@/components/marketing/site";

// Marketing pages only. Product, admin and share URLs are never listed. Each page's lastModified is the
// date stored with its content (see MARKETING_ROUTES, content/features.tsx, content/docs.tsx,
// content/templates.ts and content/changelog.ts), so it changes only when that page does.

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const latest = (...values: string[]) => values.reduce((a, b) => (b > a ? b : a));

export default function sitemap(): MetadataRoute.Sitemap {
  const fixed: MetadataRoute.Sitemap = MARKETING_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: day(
      route.path === "/changelog"
        ? latest(route.updated, LATEST_RELEASE_DATE)
        : route.path === "/features"
          ? latest(route.updated, ...FEATURES.map((f) => f.updated))
          : route.path === "/docs"
            ? latest(route.updated, ...DOC_ARTICLES.map((a) => a.updated))
            : route.path === "/template-gallery"
              ? latest(route.updated, TEMPLATE_GALLERY_UPDATED)
              : route.updated,
    ),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
  const features: MetadataRoute.Sitemap = FEATURES.map((f) => ({ url: absoluteUrl(featurePath(f.slug)), lastModified: day(f.updated), changeFrequency: "monthly", priority: 0.7 }));
  const templates: MetadataRoute.Sitemap = GALLERY_TEMPLATES.map((t) => ({ url: absoluteUrl(templatePath(t.key)), lastModified: day(TEMPLATE_GALLERY_UPDATED), changeFrequency: "monthly", priority: 0.5 }));
  const docs: MetadataRoute.Sitemap = DOC_ARTICLES.map((a) => ({ url: absoluteUrl(docPath(a.slug)), lastModified: day(a.updated), changeFrequency: "monthly", priority: 0.6 }));
  return [...fixed, ...features, ...templates, ...docs];
}
