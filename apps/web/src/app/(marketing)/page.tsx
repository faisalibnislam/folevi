import type { CSSProperties } from "react";
import { AiSection } from "@/components/marketing/home/AiSection";
import { HERO_STYLES } from "@/components/marketing/home/heroStyles";
import { artVars } from "@/components/marketing/product/Replica";
import { paletteVars } from "@/lib/cover";
import { Chapters } from "@/components/marketing/home/Chapters";
import { FinalCta, PricingSection, SecuritySection } from "@/components/marketing/home/Closing";
import { Hero } from "@/components/marketing/home/Hero";
import { PageBackdrop } from "@/components/marketing/PageBackdrop";
import { Included } from "@/components/marketing/home/Included";
import { MacSection } from "@/components/marketing/home/MacSection";
import { NoteStyles } from "@/components/marketing/home/NoteStyles";
import { JsonLd, organizationLd, pageMetadata, softwareLd } from "@/components/marketing/seo";

export const metadata = pageMetadata({
  title: "Folevi: a quiet notes app for ideas that keep growing",
  absoluteTitle: true,
  description:
    "Folevi is a calm writing and notes workspace for the web and a native Mac app: block documents, nested pages, tasks, offline editing and real-time sync. Free to start, with a 7-day Pro AI trial.",
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationLd(), softwareLd()]} />
      {/* The hero note, then every section in its own card, all over one blurred copy of the note's style image. */}
      {/* The first style's colours are in the HTML; the hero updates them when the visitor picks another. */}
      <div className="mk-home" style={{ ...artVars(HERO_STYLES[0]!), ...paletteVars(HERO_STYLES[0]!) } as CSSProperties}>
        <PageBackdrop />
        <Hero />
        <div className="mk-stack mk-home-stack">
          <Included />
          <NoteStyles />
          <Chapters />
          <AiSection />
          <MacSection />
          <SecuritySection />
          <PricingSection />
          <FinalCta />
        </div>
      </div>
    </>
  );
}
