import Link from "next/link";
import { BLOG_POSTS, blogPath } from "@/components/marketing/content/blog";
import { Icon } from "@/components/marketing/icons";
import { HeaderCard, PageFrame } from "@/components/marketing/cards";
import { SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, pageMetadata } from "@/components/marketing/seo";
import { absoluteUrl, formatDay } from "@/components/marketing/site";
import { Eyebrow, container } from "@/components/marketing/ui";
import { Float, Hand, Mark, Sticker } from "@/components/marketing/fun";
import { CursorPiece, TaskPiece } from "@/components/marketing/pieces";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";

const base = pageMetadata({
  title: "Folevi blog: notes, offline sync and calm tools",
  description: "The Folevi blog: how offline sync works, why there’s a plan with no AI, what an AI credit is, and meeting notes that turn into tasks.",
  path: "/blog",
  ogImage: "segment",
});

export const metadata = { ...base, alternates: { ...base.alternates, types: { "application/rss+xml": [{ url: absoluteUrl("/blog/rss.xml"), title: "The Folevi blog" }] } } };

function blogLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "The Folevi blog",
    url: absoluteUrl("/blog"),
    publisher: { "@type": "Organization", name: "Folevi", url: absoluteUrl("/") },
    blogPost: BLOG_POSTS.map((post) => ({ "@type": "BlogPosting", headline: post.title, url: absoluteUrl(blogPath(post.slug)), datePublished: post.published, dateModified: post.updated })),
  };
}

export default function BlogIndexPage() {
  return (
    <>
      <JsonLd data={blogLd()} />
      <PageFrame>
        <HeaderCard
          crumbs={[
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
          ]}
        >
          <Float depth={0.14} className="right-[13%] top-[10%] max-xl:hidden [--tilt:-3deg]">
            <TaskPiece text="Read the new post" due="Today" />
          </Float>
          <Float depth={0.08} delay={800} className="bottom-[14%] right-[34%] max-xl:hidden">
            <CursorPiece name="Maya" />
          </Float>
          <div aria-hidden="true" className="pointer-events-none absolute bottom-14 right-[8%] z-10 hidden lg:block">
            <Hand rotate={-5}>grab a tea first</Hand>
          </div>
          <Eyebrow>Blog</Eyebrow>
          <h1 className="mk-display mt-5 max-w-[14ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px] xl:text-[80px]">
            Notes from the Folevi <Mark>team.</Mark>
          </h1>
          <p className="mk-lede mt-6 max-w-[60ch]">How Folevi works, and why. Newest first.</p>
          <p className="mt-5 text-[14.5px] text-muted">
            <a href="/blog/rss.xml" className="mk-link inline-flex min-h-11 items-center gap-1.5">
              Follow with RSS <Icon name="arrow-right" size={14} />
            </a>
          </p>
        </HeaderCard>
        <div className={container}>
          <ol className="grid gap-(--mk-stack-gap) lg:grid-cols-2">
            {BLOG_POSTS.map((post, i) => (
              <li key={post.slug} className="relative">
                <article className="mk-box group relative flex h-full flex-col p-6 hover:shadow-(--shadow-pop) sm:p-8">
                  <p className="text-[13px] text-muted">
                    <time dateTime={post.published}>{formatDay(post.published)}</time>
                    <span aria-hidden="true"> · </span>
                    {post.tags.join(", ")}
                  </p>
                  <h2 className="mk-h3 mt-3 text-[21px] leading-snug">
                    <Link
                      href={blogPath(post.slug)}
                      className="after:absolute after:inset-0 after:rounded-panel sm:after:rounded-container focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-(--color-focus)"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{post.description}</p>
                  <span aria-hidden="true" className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-(--color-heading)">
                    Read the post <Icon name="arrow-right" size={14} className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </span>
                </article>
                {/* The newest post wears a sticker, placed after the card so the tilting card never covers it. */}
                {i === 0 ? (
                  <span className="pointer-events-none absolute -top-3 right-5 z-10">
                    <Sticker tone="violet" rotate={5}>
                      Newest
                    </Sticker>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        <SignUpPanel
          body={`Free has no time limit. Try ${TIER_NAMES[TRIAL_TIER]} free for ${TRIAL_DAYS} days, no card.`}
          secondary={{ label: "Read the docs", href: "/docs" }}
        />
      </PageFrame>
    </>
  );
}
