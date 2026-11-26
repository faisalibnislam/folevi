import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devPagesAvailable } from "@/lib/edition";
import { CardLooks } from "./CardLooks";

export const metadata: Metadata = { title: "Card looks", robots: { index: false, follow: false } };

/**
 * Development only: every look a note's card takes (DocumentCard.tsx noteLook), drawn with sample notes, to
 * judge them side by side and for the native apps' screenshot diffs.
 */
export default function CardLooksPage() {
  if (!devPagesAvailable()) notFound();
  return <CardLooks />;
}
