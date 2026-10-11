import Link from "next/link";
import { COMPARE_CHECKED, COMPETITORS, TRIAL_LINE, comparePath, trademarkLine } from "@/components/marketing/content/compare";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { Checks } from "@/components/marketing/Checks";
import { CompareChart } from "@/components/marketing/CompareChart";
import { LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl, formatDay } from "@/components/marketing/site";
import { Eyebrow } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Folevi alternatives and comparisons",
  description:
    "How Folevi compares with Notion, Craft, Apple Notes, Obsidian, Bear and Evernote on price, offline editing, AI, apps and export, with every fact sourced.",
  path: "/compare",
  ogImage: "segment",
});

function collectionLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Folevi alternatives and comparisons",
    url: absoluteUrl("/compare"),
    hasPart: COMPETITORS.map((x) => ({ "@type": "WebPage", name: x.h1, url: absoluteUrl(comparePath(x.slug)) })),
  };
}

export default function CompareIndexPage() {
  return (
    <>
      <JsonLd data={collectionLd()} />
      <PageFrame>
        <HeaderCard
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Compare", path: "/compare" },
          ]}
        >
          <Eyebrow>Compare</Eyebrow>
          <h1 className="mk-display mt-4 max-w-[20ch] text-[40px] sm:text-[56px] lg:text-[64px]">How Folevi compares.</h1>
          <p className="mk-lede mt-5 max-w-[60ch]">One page per app, with sources and how to move across.</p>
        </HeaderCard>
        <Card as="div">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COMPETITORS.map((x) => (
              <li key={x.slug}>
                <LinkCard href={comparePath(x.slug)} title={x.h1} body={x.summary} headingLevel="h2" />
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="side-by-side">
          <h2 id="side-by-side" className="mk-h3 text-[19px]">
            Side by side
          </h2>
          <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-muted">Every app on one chart, a topic per row.</p>
          <div className="mt-6">
            <CompareChart />
          </div>
        </Card>
        <Card aria-labelledby="how-we-compare">
          <h2 id="how-we-compare" className="mk-h3 text-[19px]">
            How we compare
          </h2>
          <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-muted">Only facts we could confirm on each maker’s own website.</p>
          <Checks
            className="mt-5"
            items={[
              <>Every page lists its sources, with links</>,
              <>No reviews, ratings or rankings</>,
              <>
                Checked {formatDay(COMPARE_CHECKED)}. Out of date?{" "}
                <Link href="/support" className="mk-link">
                  Tell us
                </Link>
              </>,
            ]}
          />
          <p className="mt-6 text-[13px] text-muted">{trademarkLine(COMPETITORS.flatMap((x) => x.trademarks).filter((name, i, all) => all.indexOf(name) === i))}</p>
        </Card>
        <SignUpPanel body={TRIAL_LINE} secondary={{ label: "See pricing", href: "/pricing" }} />
      </PageFrame>
    </>
  );
}
