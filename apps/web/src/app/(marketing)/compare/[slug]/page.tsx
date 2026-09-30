import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { COMPARE_CHECKED, COMPETITORS, FOLEVI_ROWS, TRIAL_LINE, comparePath, competitorBySlug, trademarkLine, type Competitor } from "@/components/marketing/content/compare";
import { DocShell } from "@/components/marketing/DocShell";
import { Breadcrumbs, FaqSection, LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { SIGN_UP_URL, absoluteUrl, formatDay } from "@/components/marketing/site";
import { ButtonLink, Eyebrow, container, cx } from "@/components/marketing/ui";

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPETITORS.map((x) => ({ slug: x.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const competitor = competitorBySlug((await params).slug);
  if (!competitor) return {};
  return pageMetadata({ title: competitor.title, description: competitor.description, path: comparePath(competitor.slug), absoluteTitle: true, ogImage: "segment" });
}

function webPageLd(competitor: Competitor): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: competitor.h1,
    description: competitor.description,
    url: absoluteUrl(comparePath(competitor.slug)),
    dateModified: competitor.updated,
    isPartOf: { "@type": "WebSite", name: "Folevi", url: absoluteUrl("/") },
    about: [
      { "@type": "SoftwareApplication", name: "Folevi", applicationCategory: "ProductivityApplication", operatingSystem: "Web" },
      { "@type": "SoftwareApplication", name: competitor.name, applicationCategory: "ProductivityApplication" },
    ],
  };
}

/** The comparison table: one row per fact, a plain value per product, and the sources for the other one. */
function CompareTable({ competitor }: { competitor: Competitor }) {
  const number = (id: string) => competitor.sources.findIndex((s) => s.id === id) + 1;
  const sourceNumbers = (ids: string[]) => {
    const numbers = ids.map(number).filter((x) => x > 0);
    return numbers.length ? (
      <sup className="ml-0.5 whitespace-nowrap text-[11px] font-medium text-muted">
        <span className="sr-only"> Sources: </span>
        {numbers.join(", ")}
      </sup>
    ) : null;
  };
  return (
    <>
      {/* Phones: one card per fact, both products stacked, so neither column scrolls out of view. */}
      <dl className="mk-card px-5 sm:hidden">
        {competitor.rows.map((row, i) => (
          <div key={row.key} className={cx("py-4", i > 0 && "border-t mk-hair")}>
            <dt className="text-[15.5px] font-semibold text-(--color-heading)">{FOLEVI_ROWS[row.key].label}</dt>
            <dd className="mt-2 grid gap-2.5 text-[15px] leading-relaxed">
              <p>
                <span className="mk-caps block">Folevi</span>
                {FOLEVI_ROWS[row.key].value}
              </p>
              <p>
                <span className="mk-caps block">{competitor.name}</span>
                {row.them}
                {sourceNumbers(row.sources)}
              </p>
            </dd>
          </div>
        ))}
      </dl>
      <CompareTableWide competitor={competitor} sourceNumbers={sourceNumbers} />
    </>
  );
}

function CompareTableWide({ competitor, sourceNumbers }: { competitor: Competitor; sourceNumbers: (ids: string[]) => ReactNode }) {
  return (
    <div className="mk-table-card overflow-x-auto max-sm:hidden" role="region" aria-label={`Folevi and ${competitor.name} compared`} tabIndex={0}>
      <table className="min-w-[560px]">
        <caption className="sr-only">
          Folevi and {competitor.name} compared. {competitor.name}’s details are from its website on {formatDay(COMPARE_CHECKED)}; the numbers after each one point to the sources below.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-[24%]">
              <span className="sr-only">Feature</span>
            </th>
            <th scope="col" className="w-[38%]">
              Folevi
            </th>
            <th scope="col" className="w-[38%]">
              {competitor.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {competitor.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="font-semibold text-(--color-heading)">
                {FOLEVI_ROWS[row.key].label}
              </th>
              <td>{FOLEVI_ROWS[row.key].value}</td>
              <td>
                {row.them}
                {sourceNumbers(row.sources)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ComparePage({ params }: Params) {
  const competitor = competitorBySlug((await params).slug);
  if (!competitor) notFound();
  const path = comparePath(competitor.slug);
  const others = COMPETITORS.filter((x) => x.slug !== competitor.slug).slice(0, 3);
  const toc = [
    { id: "at-a-glance", label: "At a glance" },
    { id: "different", label: "Where Folevi is different" },
    { id: "suits-better", label: `Where ${competitor.name} may suit you better` },
    { id: "switching", label: `Switching from ${competitor.name}` },
    { id: "faq-title", label: "Questions" },
    { id: "sources", label: "Sources" },
  ];

  return (
    <>
      <JsonLd data={webPageLd(competitor)} />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: competitor.h1, path },
        ]}
      />
      <header className={cx(container, "pb-10 pt-8 sm:pb-14 sm:pt-12")}>
        <Eyebrow>Compare</Eyebrow>
        <h1 className="mk-display mt-4 max-w-[20ch] text-[40px] sm:text-[56px] lg:text-[64px]">{competitor.h1}</h1>
        <p className="mk-lede mt-5 max-w-[62ch]">{competitor.intro}</p>
        <div className="mt-8 flex flex-wrap items-center gap-2.5">
          <ButtonLink href={SIGN_UP_URL} icon="arrow-right" size="lg">
            Try Folevi free
          </ButtonLink>
          <ButtonLink href="/pricing" variant="secondary" size="lg">
            See pricing
          </ButtonLink>
        </div>
        <p className="mt-4 text-[13.5px] text-muted">
          {competitor.name}’s details checked on <time dateTime={COMPARE_CHECKED}>{formatDay(COMPARE_CHECKED)}</time>. Updated <time dateTime={competitor.updated}>{formatDay(competitor.updated)}</time>.
        </p>
      </header>

      <DocShell toc={toc}>
        <h2 id="at-a-glance">At a glance</h2>
        <CompareTable competitor={competitor} />

        <h2 id="different">Where Folevi is different</h2>
        {competitor.different.map((section) => (
          <div key={section.title} className="[&>*+*]:mt-[1em]">
            <h3>{section.title}</h3>
            {section.body}
          </div>
        ))}

        <h2 id="suits-better">Where {competitor.name} may suit you better</h2>
        {competitor.suitsBetter.map((section) => (
          <div key={section.title} className="[&>*+*]:mt-[1em]">
            <h3>{section.title}</h3>
            {section.body}
          </div>
        ))}

        <h2 id="switching">Switching from {competitor.name}</h2>
        {competitor.switching}
        <p>
          The details are in <Link href="/docs/import-and-export">Import and export</Link>, and <Link href="/blog/moving-your-notes-into-folevi">moving your notes into Folevi</Link> explains what comes across.
        </p>

        <FaqSection faqs={competitor.faq} path={path} className="mt-[2.4em]" />

        <h2 id="sources">Sources</h2>
        <p>
          {competitor.name}’s details come from its own website. Each was checked on <time dateTime={COMPARE_CHECKED}>{formatDay(COMPARE_CHECKED)}</time>. Folevi’s come from our <Link href="/pricing">pricing</Link>, <Link href="/features">features</Link> and <Link href="/docs">docs</Link>.
        </p>
        <ol className="text-[15px]">
          {competitor.sources.map((s) => (
            <li key={s.id} id={`source-${s.id}`}>
              <a href={s.url} rel="noopener">
                {s.title}
              </a>
              <span className="text-muted">, checked {formatDay(s.checked)}</span>
            </li>
          ))}
        </ol>
        <p className="text-[14.5px] text-muted">
          Prices and features of other products are from their public websites on {formatDay(COMPARE_CHECKED)} and may have changed. {trademarkLine(competitor.trademarks)} If something here is out of date, <Link href="/support">tell us</Link> and we’ll fix it.
        </p>
      </DocShell>

      <section aria-labelledby="more-title" className={cx(container, "pb-16 sm:pb-24")}>
        <h2 id="more-title" className="mk-h2">
          More comparisons
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {others.map((x) => (
            <li key={x.slug}>
              <LinkCard href={comparePath(x.slug)} title={x.h1} body={x.summary} />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14.5px] text-muted">
          <Link href="/compare" className="mk-link">
            All comparisons
          </Link>
        </p>
      </section>

      <SignUpPanel body={TRIAL_LINE} secondary={{ label: "See pricing", href: "/pricing" }} />
    </>
  );
}
