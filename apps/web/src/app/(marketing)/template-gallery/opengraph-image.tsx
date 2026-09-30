import { GALLERY_TEMPLATES } from "@/components/marketing/content/templates";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/components/marketing/og";

export const alt = "Free note templates for Folevi.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    eyebrow: "Template gallery",
    title: `${GALLERY_TEMPLATES.length} free note templates for Folevi.`,
    sheetTitle: "Templates",
    lines: ["meeting-notes", "weekly-reset", "project-brief", "travel-plan", "recipe"].map((key) => GALLERY_TEMPLATES.find((t) => t.key === key)?.name ?? key),
  });
}
