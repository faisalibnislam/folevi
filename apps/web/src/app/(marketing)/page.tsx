import { AiSection } from "@/components/marketing/home/AiSection";
import { Chapters } from "@/components/marketing/home/Chapters";
import { FinalCta, PricingSection, SecuritySection } from "@/components/marketing/home/Closing";
import { Folders } from "@/components/marketing/home/Folders";
import { Hero, ProofStrip } from "@/components/marketing/home/Hero";
import { MacSection } from "@/components/marketing/home/MacSection";
import { NoteStyles } from "@/components/marketing/home/NoteStyles";
import { JsonLd, organizationLd, pageMetadata, softwareLd } from "@/components/marketing/seo";

export const metadata = pageMetadata({
  title: "Folevi: a quieter place for ideas that keep growing",
  absoluteTitle: true,
  description:
    "Folevi is a calm writing and notes workspace for the web and a native Mac app: block documents, nested pages, tasks, offline editing and real-time sync. Free to start, with a 7-day Pro AI trial.",
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationLd(), softwareLd()]} />
      <Hero />
      <ProofStrip />
      <NoteStyles />
      <Chapters />
      <Folders />
      <AiSection />
      <MacSection />
      <SecuritySection />
      <PricingSection />
      <FinalCta />
    </>
  );
}
