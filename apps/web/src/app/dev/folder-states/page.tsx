import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FolderStates } from "./FolderStates";

export const metadata: Metadata = { title: "Folder states", robots: { index: false, follow: false } };

/**
 * Development only: the folder card in every state (0 to 5+ notes, subfolders, the hover menu), at the web's
 * and the iPad's sizes, to judge it and for the native apps' screenshot diffs.
 */
export default function FolderStatesPage() {
  if (process.env.VERCEL_ENV === "production" || process.env.FOLEVI_ENV === "production") notFound();
  return <FolderStates />;
}
