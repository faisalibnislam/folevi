import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_POSTS, blogPath, postBySlug } from "@/components/marketing/content/blog";
import { Icon } from "@/components/marketing/icons";
import { Breadcrumbs, LinkCard, SignUpPanel } from "@/components/marketing/parts";
import { JsonLd, articleLd, pageMetadata } from "@/components/marketing/seo";
import { formatDay } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";
import { TIER_NAMES, TRIAL_DAYS, TRIAL_TIER } from "@/lib/plans";

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const post = postBySlug((await params).slug);
  if (!post) return {};
  const metadata = pageMetadata({ title: post.title, description: post.description, path: blogPath(post.slug), ogImage: "segment", article: { modified: post.updated } });
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, type: "article" as const, publishedTime: post.published, modifiedTime: post.updated, authors: [post.author], tags: post.tags },
  };
}

export default async function BlogPostPage({ params }: Params) {
  const post = postBySlug((await params).slug);
  if (!post) notFound();
  const path = blogPath(post.slug);
  const related = post.related.map(postBySlug).filter((p) => p !== undefined);

  return (
    <>
      <JsonLd
        data={articleLd({
          type: "BlogPosting",
          headline: post.title,
          description: post.description,
          path,
          published: post.published,
          modified: post.updated,
          authorName: post.author,
          keywords: post.tags,
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path },
        ]}
      />
      <div className={cx(container, "grid gap-10 pb-16 pt-8 sm:pb-24 sm:pt-12 lg:grid-cols-[228px_minmax(0,1fr)] lg:gap-16")}>
        <article className="min-w-0 max-w-[700px] lg:col-start-2 lg:row-start-1">
          <header>
            <Eyebrow>Blog</Eyebrow>
            <h1 className="mk-display mt-4 text-[36px] sm:text-[48px] lg:text-[52px]">{post.title}</h1>
            <p className="mk-lede mt-4">{post.description}</p>
          </header>
          <div className="mk-prose mt-10">{post.body()}</div>
        </article>

        <aside aria-label="About this post" className="self-start border-t mk-hair pt-8 lg:sticky lg:top-24 lg:col-start-1 lg:row-start-1 lg:border-t-0 lg:pt-0">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-[14px] sm:grid-cols-4 lg:grid-cols-1">
            <div>
              <dt className="mk-caps">Written by</dt>
              <dd className="mt-1 text-ink">{post.author}</dd>
            </div>
            <div>
              <dt className="mk-caps">Published</dt>
              <dd className="mt-1 text-ink">
                <time dateTime={post.published}>{formatDay(post.published)}</time>
              </dd>
            </div>
            <div>
              <dt className="mk-caps">Updated</dt>
              <dd className="mt-1 text-ink">
                <time dateTime={post.updated}>{formatDay(post.updated)}</time>
              </dd>
            </div>
            <div>
              <dt className="mk-caps">Topics</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {post.tags.map((tag) => (
                  <span key={tag} className="inline-flex h-6 items-center rounded-[5px] bg-(--color-surface-sunken) px-2 text-[12.5px] font-medium text-muted">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
          <Link href="/blog" className="mk-link mt-6 inline-flex min-h-11 items-center gap-1.5 text-[14px] lg:min-h-8">
            <Icon name="chevron-left" size={14} /> All posts
          </Link>
        </aside>
      </div>

      {related.length ? (
        <section aria-labelledby="related-title" className={cx(container, "pb-16 sm:pb-24")}>
          <h2 id="related-title" className="mk-h2">
            Keep reading
          </h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {related.map((r) => (
              <li key={r.slug}>
                <LinkCard href={blogPath(r.slug)} title={r.title} body={r.description} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SignUpPanel
        body={`The Free plan has no time limit. New accounts get ${TIER_NAMES[TRIAL_TIER]} free for ${TRIAL_DAYS} days, with no card.`}
        secondary={{ label: "See pricing", href: "/pricing" }}
      />
    </>
  );
}
