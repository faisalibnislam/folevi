import { DOC_ARTICLES, docBySlug } from "@/components/marketing/content/docs";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

type Params = { slug: string };

export function generateStaticParams() {
  return DOC_ARTICLES.map((a) => ({ slug: a.slug }));
}

/** One image per page, with the page's own alt text. */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const article = docBySlug((await params).slug) ?? DOC_ARTICLES[0]!;
  return [{ id: "og", alt: `Folevi docs: ${article.title}`, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const article = docBySlug((await params).slug) ?? DOC_ARTICLES[0]!;
  const index = DOC_ARTICLES.indexOf(article);
  // The sheet lists the articles around this one, as the docs navigation does.
  const start = Math.max(0, Math.min(index - 2, DOC_ARTICLES.length - 5));
  return renderOgImage({ eyebrow: "Folevi docs", title: article.title, sheetTitle: "Docs", lines: DOC_ARTICLES.slice(start, start + 5).map((a) => a.nav) });
}
