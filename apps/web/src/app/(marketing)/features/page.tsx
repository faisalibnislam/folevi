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
import { Doodle, Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { SearchPiece, TaskPiece } from "@/components/marketing/pieces";

export const metadata = pageMetadata({
  title: "Notes app features: tasks, offline sync and AI",
  description:
    "Everything the Folevi notes app does: offline sync, tasks and a calendar, the / menu, search, comments, flowcharts, audio, sharing, templates and AI.",
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
      <AppWindow art={artById("art-39")} artSize="thumb" chrome="mac" sidebar="main" note={READING_NOTE} className="h-[600px]" label="The Folevi Mac app" />
    </div>
  );
}

/**
 * The index's mixed grid, most important first. On large screens it has six tracks: a card spans all six
 * (one wide card on its row, cover beside the text), three (two on a row), two (three on a row) or four
 * (the bigger of a pair beside a third). Each row adds up to six. On tablets every card is half width but
 * the wide ones; on phones, one column.
 */
type Size = "wide" | "half" | "third" | "twoThirds";
const LAYOUT: { slug: string; size: Size }[] = [
  { slug: "ai-notes", size: "wide" },
  { slug: "offline-notes", size: "twoThirds" },
  { slug: "tasks", size: "third" },
  { slug: "blocks", size: "third" },
  { slug: "search", size: "third" },
  { slug: "linked-notes", size: "third" },
  { slug: "sharing", size: "half" },
  { slug: "calendar", size: "half" },
  { slug: "team-workspaces", size: "wide" },
  { slug: "comments", size: "third" },
  { slug: "version-history", size: "twoThirds" },
  { slug: "note-themes", size: "third" },
  { slug: "flowcharts", size: "third" },
  { slug: "whiteboard", size: "third" },
  { slug: "audio-recordings", size: "half" },
  { slug: "templates", size: "half" },
  { slug: "folders", size: "twoThirds" },
  { slug: "import-and-export", size: "third" },
  { slug: "security-and-privacy", size: "half" },
  { slug: "mac", size: "half" },
];

/** A sticker on a few cards, placed after the card so it sits on top. Decorative. */
const STICKERS: Record<string, { text: string; tone: "paper" | "violet" | "ink"; rotate: number }> = {
  "offline-notes": { text: "Most loved", tone: "violet", rotate: -7 },
  tasks: { text: "Due today", tone: "paper", rotate: 6 },
  mac: { text: "Coming soon", tone: "ink", rotate: -5 },
};

function CardSticker({ slug }: { slug: string }) {
  const sticker = STICKERS[slug];
  if (!sticker) return null;
  return (
    <span aria-hidden="true" className={cx("pointer-events-none absolute -top-3 z-10", sticker.rotate > 0 ? "right-3" : "-left-1.5")}>
      <Sticker tone={sticker.tone} rotate={sticker.rotate} className="text-[12.5px]">
        {sticker.text}
      </Sticker>
    </span>
  );
}

const SPAN: Record<Size, string> = {
  wide: "sm:col-span-2 lg:col-span-6",
  half: "lg:col-span-3",
  third: "lg:col-span-2",
  twoThirds: "lg:col-span-4",
};

/** Covers keep 16:10 until the grid has tracks, then grow to their row's height from at least this. */
const COVER: Record<Size, string> = {
  wide: "aspect-[16/10] lg:aspect-auto lg:min-h-[420px] lg:flex-1",
  half: "aspect-[16/10] lg:aspect-auto lg:min-h-[300px] lg:flex-1",
  third: "aspect-[16/10] lg:aspect-auto lg:min-h-[260px] lg:flex-1",
  twoThirds: "aspect-[16/10] lg:aspect-auto lg:min-h-[300px] lg:flex-1",
};

export default function FeaturesPage() {
  const bySlug = new Map(FEATURES.map((f) => [f.slug, f]));
  // A feature missing from LAYOUT still gets a card, a third wide, at the end.
  const cards = [...LAYOUT, ...FEATURES.filter((f) => !LAYOUT.some((l) => l.slug === f.slug)).map((f) => ({ slug: f.slug, size: "third" as Size }))];
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
          <h1 className="mk-display mt-5 max-w-[14ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
            Everything Folevi does, <Mark>one page</Mark> each.
          </h1>
          <p className="mk-lede mt-6 max-w-[60ch]">Notes, tasks and linked pages that work offline.</p>
          <div aria-hidden="true" className="pointer-events-none absolute bottom-[72px] right-[24%] hidden xl:block">
            <Hand rotate={-6} arrow="down-left">
              pick one, any one
            </Hand>
          </div>
          <Float depth={0.1} className="right-14 top-[56%] hidden xl:block [--tilt:-3deg]">
            <TaskPiece text="Water the seedlings" due="Today" />
          </Float>
          <Float depth={0.18} delay={700} className="right-[30%] top-16 hidden xl:block [--tilt:2deg]">
            <SearchPiece query="seed labels" />
          </Float>
        </HeaderCard>
        <Card as="div" aria-label="Feature pages">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {cards.map(({ slug, size }) => {
              const layout = size === "wide" ? "wide" : "grow";
              if (slug === "mac") {
                return (
                  <li key="mac" className={cx("relative", SPAN[size])}>
                    <LinkCard
                      href="/mac"
                      title="Mac app"
                      body="Quick Add, a menu bar icon and notifications. Coming soon."
                      cover={<FeatureCover picture={{ width: 1000, node: <MacCover /> }} className={COVER[size]} />}
                      headingLevel="h2"
                      layout={layout}
                    />
                    <CardSticker slug="mac" />
                  </li>
                );
              }
              const feature = bySlug.get(slug);
              if (!feature) return null;
              return (
                <li key={slug} className={cx("relative", SPAN[size])}>
                  <LinkCard
                    href={featurePath(slug)}
                    title={feature.name}
                    body={feature.summary}
                    cover={<FeatureCover feature={feature} className={COVER[size]} />}
                    headingLevel="h2"
                    layout={layout}
                  />
                  <CardSticker slug={slug} />
                </li>
              );
            })}
          </ul>
        </Card>
        <div className={cx(container, "grid gap-(--mk-stack-gap) md:grid-cols-2")}>
          <div className="mk-box relative p-6 sm:p-8">
            <Doodle kind="squiggle" className="absolute right-8 top-9 h-4 w-20 max-sm:hidden" />
            <h2 className="mk-h3 text-[19px]">Template gallery</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              {GALLERY_TEMPLATES.length} free templates, each with a preview.
            </p>
            <Link href="/template-gallery" className="mk-link mt-4 inline-flex min-h-11 items-center text-[15px]">
              Browse the templates
            </Link>
          </div>
          <div className="mk-box p-6 sm:p-8">
            <h2 className="mk-h3 text-[19px]">Documentation</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Step-by-step guides to every part of Folevi.</p>
            <Link href="/docs" className="mk-link mt-4 inline-flex min-h-11 items-center text-[15px]">
              Read the docs
            </Link>
          </div>
        </div>
        <SignUpPanel body="Free has no time limit and includes every feature here." secondary={{ label: "See pricing", href: "/pricing" }} />
      </PageFrame>
    </>
  );
}
