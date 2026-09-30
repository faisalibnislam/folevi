import Link from "next/link";
import { notFound } from "next/navigation";
import { DOC_ARTICLES, docBySlug, docPath } from "@/components/marketing/content/docs";
import { Icon } from "@/components/marketing/icons";
import { Breadcrumbs } from "@/components/marketing/parts";
import { JsonLd, articleLd, pageMetadata } from "@/components/marketing/seo";
import { SUPPORT_EMAIL, formatDay } from "@/components/marketing/site";
import { Eyebrow, container, cx } from "@/components/marketing/ui";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_ARTICLES.map((a) => ({ slug: a.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const article = docBySlug((await params).slug);
  if (!article) return {};
  return pageMetadata({ title: article.title, description: article.description, path: docPath(article.slug), ogImage: "segment", article: { modified: article.updated } });
}

export default async function DocArticlePage({ params }: Params) {
  const article = docBySlug((await params).slug);
  if (!article) notFound();
  const index = DOC_ARTICLES.indexOf(article);
  const prev = DOC_ARTICLES[index - 1];
  const next = DOC_ARTICLES[index + 1];
  const path = docPath(article.slug);

  return (
    <>
      <JsonLd
        data={articleLd({
          headline: article.title,
          description: article.description,
          path,
          published: article.published,
          modified: article.updated,
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Documentation", path: "/docs" },
          { name: article.nav, path },
        ]}
      />
      <div className={cx(container, "grid gap-10 pb-20 pt-8 sm:pb-28 sm:pt-12 lg:grid-cols-[228px_minmax(0,1fr)] lg:gap-16")}>
        <article className="min-w-0 max-w-[700px] lg:col-start-2 lg:row-start-1">
          <header>
            <Eyebrow>Documentation</Eyebrow>
            <h1 className="mk-display mt-4 text-[36px] sm:text-[48px] lg:text-[52px]">{article.title}</h1>
            <p className="mk-lede mt-4">{article.description}</p>
            <p className="mt-4 text-[13.5px] text-muted">
              Updated <time dateTime={article.updated}>{formatDay(article.updated)}</time>
            </p>
          </header>
          <div className="mk-prose mt-10">{article.body()}</div>

          <nav aria-label="Previous and next articles" className="mt-14 grid gap-3 border-t mk-hair pt-8 sm:grid-cols-2">
            {prev ? (
              <Link href={docPath(prev.slug)} className="mk-card flex min-h-[72px] flex-col justify-center gap-0.5 px-5 py-4 transition-shadow duration-150 hover:shadow-(--shadow-pop)" rel="prev">
                <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  <Icon name="chevron-left" size={13} /> Previous
                </span>
                <span className="text-[15px] font-semibold text-(--color-heading)">{prev.nav}</span>
              </Link>
            ) : (
              <span className="hidden sm:block" />
            )}
            {next ? (
              <Link href={docPath(next.slug)} className="mk-card flex min-h-[72px] flex-col items-end justify-center gap-0.5 px-5 py-4 text-right transition-shadow duration-150 hover:shadow-(--shadow-pop)" rel="next">
                <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  Next <Icon name="chevron-right" size={13} />
                </span>
                <span className="text-[15px] font-semibold text-(--color-heading)">{next.nav}</span>
              </Link>
            ) : null}
          </nav>
          <p className="mt-8 text-[14.5px] text-muted">
            Still stuck? <Link href="/support" className="mk-link">Contact support</Link> or write to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mk-link">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </article>

        <nav aria-label="Documentation" className="self-start border-t mk-hair pt-8 lg:sticky lg:top-24 lg:col-start-1 lg:row-start-1 lg:border-t-0 lg:pt-0">
          <p className="mk-caps px-2.5 pb-2 lg:pl-3.5">
            <Link href="/docs" className="hover:text-(--color-heading)">
              Documentation
            </Link>
          </p>
          <ol className="grid gap-0.5 sm:grid-cols-2 lg:block lg:space-y-0.5 lg:border-l mk-hair">
            {DOC_ARTICLES.map((a) => {
              const current = a.slug === article.slug;
              return (
                <li key={a.slug}>
                  <Link
                    href={docPath(a.slug)}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "flex min-h-11 items-center rounded-[6px] px-2.5 py-1 text-[14px] leading-snug transition-colors duration-150 hover:bg-(--color-surface-sunken) hover:text-(--color-heading) lg:-ml-px lg:min-h-8 lg:rounded-l-none lg:border-l lg:pl-3.5",
                      current ? "bg-(--color-surface-sunken) font-semibold text-(--color-heading) lg:border-(--color-heading) lg:bg-transparent" : "text-muted lg:border-transparent lg:hover:border-(--color-heading)",
                    )}
                  >
                    {a.nav}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </>
  );
}
