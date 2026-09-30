import { BLOG_POSTS, blogPath } from "@/components/marketing/content/blog";
import { absoluteUrl } from "@/components/marketing/site";

// RSS 2.0 feed of the blog, newest first, with absolute URLs. Built once at build time from the post modules.
export const dynamic = "force-static";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** RFC 822 date, as RSS 2.0 requires ("Wed, 30 Sep 2026 00:00:00 GMT"). */
const rfc822 = (day: string) => new Date(`${day}T00:00:00Z`).toUTCString();

export function GET() {
  const feedUrl = absoluteUrl("/blog/rss.xml");
  const newest = BLOG_POSTS.reduce((latest, post) => (post.updated > latest ? post.updated : latest), BLOG_POSTS[0]?.updated ?? "2026-09-30");
  const items = BLOG_POSTS.map((post) => {
    const url = absoluteUrl(blogPath(post.slug));
    return [
      "    <item>",
      `      <title>${escape(post.title)}</title>`,
      `      <link>${escape(url)}</link>`,
      `      <guid isPermaLink="true">${escape(url)}</guid>`,
      `      <pubDate>${rfc822(post.published)}</pubDate>`,
      `      <dc:creator>${escape(post.author)}</dc:creator>`,
      ...post.tags.map((tag) => `      <category>${escape(tag)}</category>`),
      `      <description>${escape(post.description)}</description>`,
      "    </item>",
    ].join("\n");
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>The Folevi blog</title>
    <link>${escape(absoluteUrl("/blog"))}</link>
    <description>How Folevi works, why it works that way, and how to get more out of it.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(newest)}</lastBuildDate>
    <atom:link href="${escape(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
