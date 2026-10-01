import Link from "next/link";
import { FEATURES, featurePath } from "@/components/marketing/content/features";
import { GALLERY_TEMPLATES } from "@/components/marketing/content/templates";
import { FeatureCover } from "@/components/marketing/features/FeatureCover";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Features",
  description:
    "What Folevi does: offline notes that sync, tasks and a calendar, the / menu, search, comments, version history, linked pages and backlinks, flowcharts and whiteboards, audio recordings, note styles, sharing and public links, team workspaces, templates, export and an AI Assistant.",
  path: "/features",
  ogImage: "segment",
});

function collectionLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Folevi features",
    url: absoluteUrl("/features"),
    hasPart: FEATURES.map((f) => ({ "@type": "WebPage", name: f.h1, url: absoluteUrl(featurePath(f.slug)) })),
  };
}

/** The Mac app's card cover: the app window with its Mac chrome, as on the Mac page. */
function MacCover() {
  return (
    <div className="mk-stage p-7" style={{ ["--stage-art" as string]: artThumb(artById("art-39")) }}>
      <AppWindow art={artById("art-39")} chrome="mac" sidebar="main" note={READING_NOTE} className="h-[600px]" label="The Folevi Mac app" />
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <>
      <JsonLd data={collectionLd()} />
      <PageFrame>
        <HeaderCard
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Features", path: "/features" },
          ]}
        >
          <Eyebrow>Features</Eyebrow>
          <h1 className="mk-display mt-4 max-w-[18ch] text-[40px] sm:text-[56px] lg:text-[64px]">Everything Folevi does, one page each.</h1>
          <p className="mk-lede mt-5 max-w-[60ch]">
            Folevi is a notes app for documents, tasks and linked pages that works offline and syncs when you reconnect. Each page below explains one part of it, with the plans that include it.
          </p>
        </HeaderCard>
        <Card as="div" aria-label="Feature pages">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.slug}>
                <LinkCard href={featurePath(feature.slug)} title={feature.name} body={feature.summary} cover={<FeatureCover feature={feature} />} headingLevel="h2" />
              </li>
            ))}
            <li>
              <LinkCard
                href="/mac"
                title="Mac app"
                body="A native Mac app with menus, windows and shortcuts, and your notes stored on the Mac. Coming soon."
                cover={<FeatureCover picture={{ width: 1000, node: <MacCover /> }} />}
                headingLevel="h2"
              />
            </li>
          </ul>
        </Card>
        <div className={cx(container, "grid gap-(--mk-stack-gap) md:grid-cols-2")}>
          <div className="mk-box p-6 sm:p-8">
            <h2 className="mk-h3 text-[19px]">Template gallery</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              {GALLERY_TEMPLATES.length} free templates, from meeting notes to a travel plan, each with a preview of the page it makes.
            </p>
            <Link href="/template-gallery" className="mk-link mt-4 inline-flex min-h-11 items-center text-[15px]">
              Browse the templates
            </Link>
          </div>
          <div className="mk-box p-6 sm:p-8">
            <h2 className="mk-h3 text-[19px]">Documentation</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Step-by-step articles on blocks, tasks, sync, sharing, workspaces, import and export, and your account.</p>
            <Link href="/docs" className="mk-link mt-4 inline-flex min-h-11 items-center text-[15px]">
              Read the docs
            </Link>
          </div>
        </div>
        <SignUpPanel body="The Free plan has no time limit, and every feature on this page is part of it, with AI counted in credits." secondary={{ label: "See pricing", href: "/pricing" }} />
      </PageFrame>
    </>
  );
}
