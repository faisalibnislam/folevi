import { BLOG_POSTS, postBySlug } from "@/components/marketing/content/blog";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

type Params = { slug: string };

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

/** One image per post, with the post's own alt text. */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const post = postBySlug((await params).slug) ?? BLOG_POSTS[0]!;
  return [{ id: "og", alt: `Folevi blog: ${post.title}`, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const post = postBySlug((await params).slug) ?? BLOG_POSTS[0]!;
  // The sheet lists the post's topics and the posts it links to, like a page outline.
  const lines = [...post.tags, ...post.related.map((slug) => postBySlug(slug)?.title ?? "")].filter(Boolean);
  return renderOgImage({ eyebrow: "Folevi blog", title: post.title, sheetTitle: "Blog", lines });
}
