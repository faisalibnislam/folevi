import Link from "next/link";
import { COMPARE_CHECKED, COMPETITORS, TRIAL_LINE, comparePath, trademarkLine } from "@/components/marketing/content/compare";
import { Breadcrumbs, LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl, formatDay } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Folevi alternatives and comparisons",
  description:
    "How Folevi compares with Notion, Craft, Apple Notes, Obsidian, Bear and Evernote on price, offline editing, AI, apps, sharing and export, with every competitor fact linked to its source.",
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
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
        ]}
      />
      <header className={cx(container, "pb-10 pt-8 sm:pb-14 sm:pt-12")}>
        <Eyebrow>Compare</Eyebrow>
        <h1 className="mk-display mt-4 max-w-[20ch] text-[40px] sm:text-[56px] lg:text-[64px]">How Folevi compares.</h1>
        <p className="mk-lede mt-5 max-w-[60ch]">
          Folevi next to the notes apps people ask us about, one page each. Every page has a table with a plain value for each product, what the other app does better, and how to move your notes across.
        </p>
      </header>
      <div className={cx(container, "pb-16 sm:pb-24")}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMPETITORS.map((x) => (
            <li key={x.slug}>
              <LinkCard href={comparePath(x.slug)} title={x.h1} body={x.summary} headingLevel="h2" />
            </li>
          ))}
        </ul>
        <div className="mk-panel mt-16 p-6 sm:p-8">
          <h2 className="mk-h3 text-[19px]">How we compare</h2>
          <div className="mt-2 max-w-[70ch] space-y-3 text-[15px] leading-relaxed text-muted">
            <p>
              Facts about other products come only from their makers’ own websites: pricing pages, help centres and download pages. Each page lists its sources with links. We leave out anything we couldn’t confirm there, and we don’t quote reviews, ratings or rankings.
            </p>
            <p>
              Facts about Folevi come from our <Link href="/pricing" className="mk-link">pricing</Link>, <Link href="/features" className="mk-link">features</Link> and <Link href="/docs" className="mk-link">docs</Link>. Folevi runs on the web today; the Mac app is coming soon, and there is no iOS or Android app yet.
            </p>
            <p>
              Prices and features of other products are from their public websites on {formatDay(COMPARE_CHECKED)} and may have changed. {trademarkLine(COMPETITORS.flatMap((x) => x.trademarks).filter((name, i, all) => all.indexOf(name) === i))} If something is out of date, <Link href="/support" className="mk-link">tell us</Link>.
            </p>
          </div>
        </div>
      </div>
      <SignUpPanel body={TRIAL_LINE} secondary={{ label: "See pricing", href: "/pricing" }} />
    </>
  );
}
