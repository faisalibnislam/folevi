import { ComingSoonPlatform } from "@/components/marketing/ComingSoonPlatform";
import { pageMetadata } from "@/components/marketing/seo";

// Folevi for Windows is paused (owner, 2026-11-28): the page stays, says Coming soon and offers no download. The
// app (apps/desktop) and its release scripts are kept. Out of the sitemap and search results until it's back.

export const metadata = pageMetadata({
  title: "Folevi for Windows: coming soon",
  description: "Folevi for Windows is coming soon. Until then, use the Folevi web app in any browser on your PC, or the free apps for Mac, iPhone and iPad.",
  path: "/windows",
  noindex: true,
});

export default function WindowsPage() {
  return <ComingSoonPlatform name="Windows" device="PC" />;
}
