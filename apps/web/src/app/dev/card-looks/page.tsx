import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardLooks } from "./CardLooks";

export const metadata: Metadata = { title: "Card looks", robots: { index: false, follow: false } };

/**
 * Development only: every look a note's card takes (DocumentCard.tsx noteLook), drawn with sample notes, to
 * judge them side by side and for the native apps' screenshot diffs.
 */
export default function CardLooksPage() {
  if (process.env.VERCEL_ENV === "production" || process.env.FOLEVI_ENV === "production") notFound();
  return <CardLooks />;
}
