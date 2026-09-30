import { COMPETITORS, FOLEVI_ROWS, competitorBySlug } from "@/components/marketing/content/compare";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

type Params = { slug: string };

export function generateStaticParams() {
  return COMPETITORS.map((x) => ({ slug: x.slug }));
}

/** One image per page, with the page's own alt text. */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const competitor = competitorBySlug((await params).slug) ?? COMPETITORS[0]!;
  return [{ id: "og", alt: `${competitor.h1}: prices, offline, AI, apps and export compared`, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const competitor = competitorBySlug((await params).slug) ?? COMPETITORS[0]!;
  // The sheet lists the table's first rows, as the page does.
  return renderOgImage({ eyebrow: "Compare", title: competitor.h1, sheetTitle: "At a glance", lines: competitor.rows.slice(0, 5).map((r) => FOLEVI_ROWS[r.key].label) });
}
