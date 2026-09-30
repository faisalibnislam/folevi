import { GALLERY_TEMPLATES, templateByKey, templateSections } from "@/components/marketing/content/templates";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

type Params = { key: string };

export function generateStaticParams() {
  return GALLERY_TEMPLATES.map((t) => ({ key: t.key }));
}

/** One image per page, with the page's own alt text. */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const t = templateByKey((await params).key) ?? GALLERY_TEMPLATES[0]!;
  return [{ id: "og", alt: `${t.searchName} template for Folevi, free`, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const t = templateByKey((await params).key) ?? GALLERY_TEMPLATES[0]!;
  return renderOgImage({ eyebrow: "Free template", title: `${t.searchName} template`, sheetTitle: t.name, lines: templateSections(t) });
}
