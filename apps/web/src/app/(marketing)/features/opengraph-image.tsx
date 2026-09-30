import { FEATURES } from "@/components/marketing/content/features";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

export const alt = "Folevi features: offline notes, tasks, linked pages, flowcharts, sharing, templates and more.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Features",
    title: "Everything Folevi does, one page each.",
    sheetTitle: "Features",
    lines: FEATURES.slice(0, 5).map((f) => f.name),
  });
}
