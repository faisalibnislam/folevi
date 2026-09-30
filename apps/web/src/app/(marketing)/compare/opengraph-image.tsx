import { COMPETITORS } from "@/components/marketing/content/compare";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

export const alt = "Folevi alternatives and comparisons: Notion, Craft, Apple Notes, Obsidian, Bear and Evernote.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({ eyebrow: "Compare", title: "How Folevi compares.", sheetTitle: "Compare", lines: COMPETITORS.slice(0, 5).map((x) => `Folevi vs ${x.name}`) });
}
