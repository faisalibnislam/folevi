import { notFound } from "next/navigation";
import { renderShareCard, type ShareCard } from "../../s/[token]/cardImage";

/** Development only: a shared note's preview image for sample notes (?n=0…3), to judge it without a real link. */
const SAMPLES: ShareCard[] = [
  { title: "Kyoto in November", excerpt: "Temples early, markets late. Book the ryokan before the 3rd.", preview: [{ t: "heading", x: "Plan" }, { t: "todo", x: "Book the ryokan", c: true }, { t: "todo", x: "Rail pass" }, { t: "bulleted", x: "Fushimi Inari at sunrise" }, { t: "paragraph", x: "Temples early, markets late." }], cover: { kind: "art", value: "art-03" }, shape: "list", kind: "document" },
  { title: "Project Atlas Brief", excerpt: "A lightweight field guide app for the city's community gardens.", preview: [{ t: "paragraph", x: "Goal: a lightweight field guide app for the city's community gardens." }, { t: "page", x: "Research" }, { t: "page", x: "Plan" }], cover: { kind: "art", value: "art-12" }, shape: "pages", kind: "document" },
  { title: "Field Notes: A Quiet Morning", excerpt: "The kettle took longer than usual. Outside, the street was the colour of wet slate.", preview: [{ t: "paragraph", x: "The kettle took longer than usual. Outside, the street was the colour of wet slate." }, { t: "heading", x: "Noticed" }, { t: "bulleted", x: "Two magpies on the aerial" }], cover: { kind: "none" }, shape: "page", kind: "document" },
  { title: "Customer Target Flow", excerpt: "Cold email, replies, form, response.", preview: [{ t: "flowchart", x: "Flowchart" }, { t: "paragraph", x: "Cold email, replies, form, response." }], cover: { kind: "art", value: "art-27" }, shape: "canvas", kind: "document" },
];

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production" || process.env.FOLEVI_ENV === "production") notFound();
  const n = Number(new URL(req.url).searchParams.get("n") ?? 0);
  return renderShareCard(SAMPLES[Math.max(0, Math.min(SAMPLES.length - 1, n))]!);
}
