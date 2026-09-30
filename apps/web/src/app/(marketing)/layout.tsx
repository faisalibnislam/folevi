import type { Viewport } from "next";
import "@/components/marketing/marketing.css";
import { HERO_STYLES, heroGlow } from "@/components/marketing/home/heroStyles";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteShell } from "@/components/marketing/SiteShell";
import { SIGN_IN_URL, SIGN_UP_URL } from "@/components/marketing/site";

// The marketing site uses the app's neutral chrome: white in light mode, near-black in dark mode.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#101011" },
  ],
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell signInUrl={SIGN_IN_URL} signUpUrl={SIGN_UP_URL} homeAmbient={heroGlow(HERO_STYLES[0]!)} footer={<SiteFooter />}>
      {children}
    </SiteShell>
  );
}
