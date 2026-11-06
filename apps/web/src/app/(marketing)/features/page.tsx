import Link from "next/link";
import { FEATURES, featurePath } from "@/components/marketing/content/features";
import { GALLERY_TEMPLATES } from "@/components/marketing/content/templates";
import { FeatureCover } from "@/components/marketing/features/FeatureCover";
import { LibraryPlaces } from "@/components/marketing/mac/LibraryPlaces";
import { AppWindow, READING_NOTE, artById, artThumb } from "@/components/marketing/product/Replica";
import { Card, HeaderCard, PageFrame } from "@/components/marketing/cards";
import { LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";
import { Doodle, Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { SearchPiece, TaskPiece } from "@/components/marketing/pieces";

export const metadata = pageMetadata({
  title: "Workspace features: docs, tasks, databases, notes",
  description:
    "Folevi is a workspace for docs, wikis, tasks and databases, with team sharing and Foli AI. Free notes apps for Mac, iPhone and iPad, no account.",
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

/** The no-account card's cover: the apps' "Where should your library live?" step. */
function LocalCover() {
  return (
    <div className="mk-stage p-7" style={{ ["--stage-art" as string]: artThumb(artById("art-13")) }}>
      <LibraryPlaces />
    </div>
  );
}

/**
 * The index's groups, the four workspace pillars first, then Foli AI, then the rest. Inside a group the grid
 * has six tracks on large screens: a card spans all six (one wide card on its row, cover beside the text),
 * three (two on a row), two (three on a row) or four (the bigger of a pair beside a third). Each row adds up
 * to six. On tablets every card is half width but the wide ones; on phones, one column.
 */
type Size = "wide" | "half" | "third" | "twoThirds";
type Group = { id: string; name: string; lede: string; cards: { slug: string; size: Size }[] };
const GROUPS: Group[] = [
  {
    id: "docs-and-wikis",
    name: "Docs and wikis",
    lede: "Pages built from blocks, nested and linked, for your own notes or a team wiki.",
    cards: [
      { slug: "blocks", size: "twoThirds" },
      { slug: "linked-notes", size: "third" },
      { slug: "foli-dna", size: "third" },
      { slug: "templates", size: "third" },
      { slug: "version-history", size: "third" },
    ],
  },
  {
    id: "tasks-and-calendar",
    name: "Tasks and calendar",
    lede: "To-dos with dates from any page, on one list and one calendar.",
    cards: [
      { slug: "tasks", size: "half" },
      { slug: "calendar", size: "half" },
    ],
  },
  {
    id: "databases-and-views",
    name: "Databases and views",
    lede: "Rows that are pages, shown as a table, a kanban board, a gallery or a calendar.",
    cards: [{ slug: "databases", size: "wide" }],
  },
  {
    id: "teams-and-sharing",
    name: "Teams and sharing",
    lede: "A workspace for your team, with shared pages, comments, free guests and public links.",
    cards: [
      { slug: "team-workspaces", size: "wide" },
      { slug: "sharing", size: "half" },
      { slug: "comments", size: "half" },
    ],
  },
  {
    id: "foli-ai",
    name: "Foli AI",
    lede: "Answers from your pages, and edits you approve first.",
    cards: [{ slug: "ai-notes", size: "wide" }],
  },
  {
    id: "apps-and-offline",
    name: "Free apps, offline and private",
    lede: "Free forever, no account. Everything saves on your device first.",
    cards: [
      { slug: "notes-on-your-devices", size: "twoThirds" },
      { slug: "mac", size: "third" },
      { slug: "offline-notes", size: "third" },
      { slug: "import-and-export", size: "third" },
      { slug: "security-and-privacy", size: "third" },
    ],
  },
  {
    id: "draw-and-organise",
    name: "Draw, record and organise",
    lede: "Flowcharts, sketches and voice notes in the page, and folders and search to find it all.",
    cards: [
      { slug: "flowcharts", size: "third" },
      { slug: "whiteboard", size: "third" },
      { slug: "audio-recordings", size: "third" },
      { slug: "search", size: "third" },
      { slug: "folders", size: "third" },
      { slug: "note-themes", size: "third" },
    ],
  },
];

/** A sticker on a few cards, placed after the card so it sits on top. Decorative. */
const STICKERS: Record<string, { text: string; tone: "paper" | "violet" | "ink"; rotate: number }> = {
  "notes-on-your-devices": { text: "No account", tone: "violet", rotate: -6 },
  "offline-notes": { text: "Most loved", tone: "paper", rotate: -7 },
  tasks: { text: "Due today", tone: "paper", rotate: 6 },
  mac: { text: "New", tone: "ink", rotate: -5 },
};

function CardSticker({ slug }: { slug: string }) {
  const sticker = STICKERS[slug];
  if (!sticker) return null;
  return (
    <span aria-hidden="true" className={cx("pointer-events-none absolute -top-3 z-10", sticker.rotate > 0 ? "right-3" : "-left-1.5")}>
      <Sticker tone={sticker.tone} rotate={sticker.rotate} className="text-[13px]">
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
  // A feature missing from GROUPS still gets a card, a third wide, in a last group.
  const listed = new Set(GROUPS.flatMap((g) => g.cards.map((c) => c.slug)));
  const rest = FEATURES.filter((f) => !listed.has(f.slug)).map((f) => ({ slug: f.slug, size: "third" as Size }));
  const groups = rest.length ? [...GROUPS, { id: "more", name: "More", lede: "Everything else Folevi does.", cards: rest }] : GROUPS;
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
          <h1 className="mk-display mt-5 max-w-[15ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
            One workspace for your <Mark>docs, tasks</Mark> and team.
          </h1>
          <p className="mk-lede mt-6 max-w-[60ch]">
            Write docs and wikis, plan your week, keep databases and work with your team, with Foli AI when you want it. On the web, Mac, iPhone and iPad, and it works offline.
          </p>
          <nav aria-label="Feature groups" className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <a href={`#${g.id}`} className="mk-chip min-h-9 hover:bg-(--color-surface-sunken) hover:text-(--color-heading)">
                    {g.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
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
        {groups.map((group, gi) => (
          <Card tint={gi % 2 === 1} key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="relative scroll-mt-8">
            <h2 id={`${group.id}-title`} className="mk-h2 text-[30px] sm:text-[38px]">
              {group.name}
            </h2>
            <p className="mt-2 text-[16px] text-muted">{group.lede}</p>
            <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              {group.cards.map(({ slug, size }) => {
                const layout = size === "wide" ? "wide" : "grow";
                if (slug === "mac") {
                  return (
                    <li key="mac" className={cx("relative", SPAN[size])}>
                      <LinkCard
                        href="/mac"
                        title="Mac app"
                        body="Free with no account. Quick Add and a menu bar icon. Also on iPhone and iPad."
                        cover={<FeatureCover picture={{ width: 1000, node: <MacCover /> }} className={COVER[size]} />}
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
                      cover={
                        slug === "notes-on-your-devices" ? (
                          <FeatureCover picture={{ width: 520, node: <LocalCover /> }} className={COVER[size]} />
                        ) : (
                          <FeatureCover feature={feature} className={COVER[size]} />
                        )
                      }
                      layout={layout}
                    />
                    <CardSticker slug={slug} />
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
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
        <SignUpPanel body="Free has no time limit. The Mac, iPhone and iPad apps are free forever, with no account." secondary={{ label: "See pricing", href: "/pricing" }} />
      </PageFrame>
    </>
  );
}
