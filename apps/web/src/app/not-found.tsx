import type { Metadata } from "next";
import { headers } from "next/headers";
import "@/components/marketing/marketing.css";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { HERO_STYLES, heroGlow } from "@/components/marketing/home/heroStyles";
import { MarketingNotFound } from "@/components/marketing/MarketingNotFound";
import { NotFoundHead } from "@/components/marketing/NotFoundHead";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteShell } from "@/components/marketing/SiteShell";
import { SIGN_IN_URL, SIGN_UP_URL } from "@/components/marketing/site";
import { APP_HOST, MARKETING_URL } from "@/lib/env";

// Any address that matches no route (and notFound() outside the marketing pages). The same app serves both
// hosts, so the page follows the host: on the marketing site it sits in the site's shell, and on the product
// host it uses the app's own plain frame (the one shared pages and the sign-in screens use).
// Next adds <meta name="robots" content="noindex"> to every 404 itself.
export const metadata: Metadata = { title: "Page not found" };

export default async function NotFound() {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "";
  if (host === APP_HOST) return <AppNotFound />;
  return (
    <SiteShell signInUrl={SIGN_IN_URL} signUpUrl={SIGN_UP_URL} homeAmbient={heroGlow(HERO_STYLES[0]!)} footer={<SiteFooter />}>
      <MarketingNotFound />
    </SiteShell>
  );
}

/** The product host's 404, in the look of the app's own not-found views (RouteView, DocumentView). */
function AppNotFound() {
  return (
    <div className="ui-neutral-chrome min-h-dvh bg-canvas">
      <NotFoundHead site="app" />
      <header className="px-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center py-4">
          <a href={MARKETING_URL} className="inline-flex items-center gap-2 text-ink" aria-label="Folevi home">
            <FoleviLogo height={22} title={null} />
          </a>
        </div>
      </header>
      <main id="main" className="px-3 pb-16 sm:px-6">
        <div className="mx-auto mt-24 max-w-md text-center">
          <h1 className="ui-display text-large-title">This page isn’t here</h1>
          <p className="mt-3 text-muted">The link may be old, or the address has a typo.</p>
          <nav aria-label="Ways back" className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <a href="/documents" className="ui-btn ui-btn-primary h-9 px-4 text-callout">
              Open Folevi
            </a>
            <a href={`${MARKETING_URL}/docs`} className="ui-btn ui-btn-secondary h-9 px-4 text-callout">
              Docs
            </a>
            <a href={MARKETING_URL} className="ui-btn ui-btn-ghost h-9 px-4 text-callout">
              Home
            </a>
          </nav>
        </div>
      </main>
    </div>
  );
}
