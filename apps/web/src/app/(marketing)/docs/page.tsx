import Link from "next/link";
import { DOC_ARTICLES, LEGACY_DOC_ANCHORS, docPath } from "@/components/marketing/content/docs";
import { LegacyAnchor } from "@/components/marketing/docs/LegacyAnchor";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { SUPPORT_EMAIL, absoluteUrl } from "@/components/marketing/site";
import { Eyebrow } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Folevi docs: how the notes app works",
  description:
    "How Folevi works: getting started, blocks and the / menu, tasks, sync and offline, sharing, workspaces, import and export, the AI Assistant and security.",
  path: "/docs",
  ogImage: "segment",
});

function collectionLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Folevi documentation",
    url: absoluteUrl("/docs"),
    hasPart: DOC_ARTICLES.map((a) => ({ "@type": "TechArticle", headline: a.title, url: absoluteUrl(docPath(a.slug)) })),
  };
}

export default function DocsIndexPage() {
  return (
    <>
      <JsonLd data={collectionLd()} />
      <LegacyAnchor anchors={LEGACY_DOC_ANCHORS} />
      <PageFrame>
        <HeaderCard
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Documentation", path: "/docs" },
          ]}
        >
          <Eyebrow>Documentation</Eyebrow>
          <h1 className="mk-display mt-4 max-w-[20ch] text-[40px] sm:text-[56px] lg:text-[64px]">How Folevi works.</h1>
          <p className="mk-lede mt-5 max-w-[60ch]">
            The essentials, one article at a time. If something here doesn’t match what you see in the app, <Link href="/support" className="mk-link">tell us</Link>. The docs should never be wrong.
          </p>
        </HeaderCard>
        <Card as="div">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_ARTICLES.map((article) => (
              <li key={article.slug}>
                {/* The card keeps the section's old anchor (/docs#sync), so old links still land on it. */}
                <LinkCard id={article.legacyAnchor} href={docPath(article.slug)} title={article.title} body={article.description} headingLevel="h2" />
              </li>
            ))}
          </ol>
          <p className="mt-10 text-[15px] text-muted">
            Looking for a feature overview instead? See <Link href="/features" className="mk-link">all features</Link>, or write to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mk-link">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </Card>
        <SignUpPanel body="The Free plan has no time limit, and you can export your notes to Markdown, HTML or PDF at any time." secondary={{ label: "Contact support", href: "/support" }} />
      </PageFrame>
    </>
  );
}
