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
import { NoteStyles } from "@/components/marketing/home/NoteStyles";
import { SlashSection } from "@/components/marketing/home/SlashSection";
import { JsonLd, organizationLd, pageMetadata, softwareLd } from "@/components/marketing/seo";

export const metadata = pageMetadata({
  title: "Folevi: a quiet notes app for ideas that keep growing",
  absoluteTitle: true,
  description:
    "Folevi is a calm notes app for the web, with a Mac app coming soon: block documents, tasks, linked pages and offline editing that syncs. Free to start.",
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
          <Included />
          <NoteStyles />
          <SlashSection />
          <Chapters />
          <AiSection />
          <PricingSection />
          <FinalCta />
        </div>
      </div>
    </>
  );
}
