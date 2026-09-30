import { BLOG_POSTS } from "@/components/marketing/content/blog";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

export const alt = "The Folevi blog: notes on how Folevi works and how to use it.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({ eyebrow: "Blog", title: "Notes from the Folevi team.", sheetTitle: "Blog", lines: BLOG_POSTS.slice(0, 5).map((post) => post.title) });
}
