import type { Viewport } from "next";
import "@/components/marketing/marketing.css";
import { HERO_STYLES, heroGlow } from "@/components/marketing/home/heroStyles";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteShell } from "@/components/marketing/SiteShell";
import { SIGN_IN_URL, SIGN_UP_URL } from "@/components/marketing/site";

// The marketing site is always light (light and dark are an app setting), with the app's white chrome.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell signInUrl={SIGN_IN_URL} signUpUrl={SIGN_UP_URL} homeAmbient={heroGlow(HERO_STYLES[0]!)} footer={<SiteFooter />}>
      {children}
    </SiteShell>
  );
}
