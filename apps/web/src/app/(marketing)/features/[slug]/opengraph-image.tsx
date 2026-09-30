import { FEATURES, featureBySlug } from "@/components/marketing/content/features";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

type Params = { slug: string };

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

/** One image per page, with the page's own alt text. */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const feature = featureBySlug((await params).slug) ?? FEATURES[0]!;
  return [{ id: "og", alt: `Folevi: ${feature.h1}`, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const feature = featureBySlug((await params).slug) ?? FEATURES[0]!;
  return renderOgImage({ eyebrow: "Folevi feature", title: feature.h1, sheetTitle: feature.name, lines: feature.sections.map((s) => s.title) });
}
