import type { Metadata } from "next";
import { MarketingNotFound } from "@/components/marketing/MarketingNotFound";

// A marketing page that calls notFound() (an unknown docs, blog or template slug): the 404 inside the site's
// own layout. Unknown addresses that match no route at all land on app/not-found.tsx instead.
// Next adds <meta name="robots" content="noindex"> to every 404 itself.
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return <MarketingNotFound />;
}
