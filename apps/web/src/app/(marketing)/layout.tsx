import "@/components/marketing/marketing.css";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PRIMARY_NAV, SIGN_IN_URL, SIGN_UP_URL } from "@/components/marketing/site";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk-root flex min-h-dvh flex-col bg-canvas text-ink">
      <a href="#main" className="mk-skip sr-only-focusable">
        Skip to content
      </a>
      <SiteHeader nav={PRIMARY_NAV} signInUrl={SIGN_IN_URL} signUpUrl={SIGN_UP_URL} />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
