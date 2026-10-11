import Link from "next/link";
import { DOC_ARTICLES, LEGACY_DOC_ANCHORS, docPath } from "@/components/marketing/content/docs";
import { LegacyAnchor } from "@/components/marketing/docs/LegacyAnchor";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl } from "@/components/marketing/site";
import { Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { SlashPiece } from "@/components/marketing/pieces";
import { Eyebrow } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Folevi docs: how the notes app works",
  description:
    "How Folevi works: getting started, blocks and the / menu, tasks, sync and offline, sharing, workspaces, import and export, Foli AI (the AI assistant) and security.",
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
          <Float depth={0.16} className="right-[20%] top-[10%] max-xl:hidden [--tilt:4deg]">
            <SlashPiece />
          </Float>
          <div aria-hidden="true" className="pointer-events-none absolute bottom-12 right-[7%] z-10 hidden xl:block">
            <Hand rotate={-4}>short reads, promise</Hand>
          </div>
          <Eyebrow>Documentation</Eyebrow>
          <h1 className="mk-display mt-5 max-w-[14ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
            How Folevi <Mark kind="circle">works.</Mark>
          </h1>
          <p className="mk-lede mt-5 max-w-[60ch]">
            The essentials, one topic per article. Something wrong?{" "}
            <Link href="/support" className="mk-link">
              Tell us
            </Link>
            .
          </p>
        </HeaderCard>
        <Card as="div">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_ARTICLES.map((article) => (
              <li key={article.slug} className="relative">
                {/* The card keeps the section's old anchor (/docs#sync), so old links still land on it. */}
                <LinkCard id={article.legacyAnchor} href={docPath(article.slug)} title={article.title} body={article.description} headingLevel="h2" />
                {/* After the card, so the tilting card never paints over it. */}
                {article.slug === "getting-started" ? (
                  <span aria-hidden="true" className="pointer-events-none absolute -top-5 right-4 z-10">
                    <Sticker tone="violet" rotate={6}>
                      Start here
                    </Sticker>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-10 text-[15px] text-muted">
            Want an overview?{" "}
            <Link href="/features" className="mk-link">
              All features
            </Link>
          </p>
        </Card>
        <SignUpPanel body="Free has no time limit. Export your notes any time." secondary={{ label: "Contact support", href: "/support" }} />
      </PageFrame>
    </>
  );
}
