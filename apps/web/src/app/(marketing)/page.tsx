import type { CSSProperties } from "react";
import { AiSection } from "@/components/marketing/home/AiSection";
import { HERO_STYLES } from "@/components/marketing/home/heroStyles";
import { artVars } from "@/components/marketing/product/Replica";
import { paletteVars } from "@/lib/cover";
import { Chapters } from "@/components/marketing/home/Chapters";
import { FinalCta, PricingSection } from "@/components/marketing/home/Closing";
import { Hero } from "@/components/marketing/home/Hero";
import { PageBackdrop } from "@/components/marketing/PageBackdrop";
import { Included } from "@/components/marketing/home/Included";
import { Suite } from "@/components/marketing/home/Suite";
import { FoliDna, VaultSecurity } from "@/components/marketing/home/DnaAndVault";
import { HomeFaq } from "@/components/marketing/home/HomeFaq";
import { SlashSection } from "@/components/marketing/home/SlashSection";
import { JsonLd, organizationLd, pageMetadata, softwareLd } from "@/components/marketing/seo";

export const metadata = pageMetadata({
  title: "Folevi: a digital workspace for Mac, iPhone, iPad and web",
  absoluteTitle: true,
  description:
    "Folevi is a calm digital workspace for notes, docs, tasks and databases, with a Vault and Foli DNA. Free Mac, iPhone and iPad apps, no account.",
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationLd(), softwareLd()]} />
      {/* The hero note, then every section in its own card, all over one blurred copy of the note's theme image. */}
      {/* The first theme's colours are in the HTML; the hero updates them when the visitor picks another. */}
      <div className="mk-home" style={{ ...artVars(HERO_STYLES[0]!), ...paletteVars(HERO_STYLES[0]!) } as CSSProperties}>
        <PageBackdrop />
        <Hero />
        <div className="mk-stack mk-home-stack">
          <PricingSection />
          <Suite />
          <FoliDna />
          <VaultSecurity />
          <Included />
          <AiSection />
          <SlashSection />
          <Chapters />
          <HomeFaq />
          <FinalCta />
        </div>
      </div>
    </>
  );
}
