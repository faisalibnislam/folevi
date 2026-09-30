import { DOC_ARTICLES } from "@/components/marketing/content/docs";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

export const alt = "Folevi documentation: how Folevi works.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({ eyebrow: "Documentation", title: "How Folevi works.", sheetTitle: "Docs", lines: DOC_ARTICLES.slice(0, 5).map((a) => a.nav) });
}
