import Link from "next/link";
import { COMPARE_CHECKED, COMPETITORS, TRIAL_LINE, comparePath, trademarkLine } from "@/components/marketing/content/compare";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { Checks } from "@/components/marketing/Checks";
import { CompareChart } from "@/components/marketing/CompareChart";
import { LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl, formatDay } from "@/components/marketing/site";
import { Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { CursorPiece, SearchPiece } from "@/components/marketing/pieces";
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
          <Float depth={0.14} className="right-[19%] top-[9%] max-xl:hidden [--tilt:-3deg]">
            <SearchPiece query="Folevi or Notion?" />
          </Float>
          <Float depth={0.08} delay={700} className="bottom-[14%] right-[30%] max-xl:hidden">
            <CursorPiece name="You" />
          </Float>
          <div aria-hidden="true" className="pointer-events-none absolute bottom-10 right-[7%] z-10 hidden lg:block">
            <Sticker tone="ink" rotate={-7}>
              Every fact sourced
            </Sticker>
          </div>
          <Eyebrow>Compare</Eyebrow>
          <h1 className="mk-display mt-5 max-w-[14ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
            How Folevi <Mark>compares.</Mark>
          </h1>
          <p className="mk-lede mt-6 max-w-[60ch]">One page per app, with sources and how to move across.</p>
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
          <h2 id="side-by-side" className="mk-h2">
            Side by <Mark kind="squiggle">side</Mark>
          </h2>
          <p className="mk-lede mt-4 max-w-[60ch]">Every app on one chart, a topic per row.</p>
          <div className="mt-12">
            <CompareChart />
          </div>
        </Card>
        <Card tint aria-labelledby="how-we-compare">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
            <div>
              <h2 id="how-we-compare" className="mk-h2">
                How we compare
              </h2>
              <p className="mk-lede mt-4 max-w-[60ch]">Only facts we could confirm on each maker’s own website.</p>
            </div>
            <div aria-hidden="true" className="relative pb-2 pr-6 max-md:hidden">
              <Hand rotate={-4}>no stars, no rankings</Hand>
            </div>
          </div>
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
