import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Samples } from "../samples";

export const metadata: Metadata = { title: "Web styles", robots: { index: false, follow: false } };

/** Development only: every component sample, for scripts/web-styles.mjs to read computed styles from. */
export default function WebStylesPage() {
  if (process.env.VERCEL_ENV === "production" || process.env.FOLEVI_ENV === "production") notFound();
  return (
    <div id="specimen" className="ui-neutral-chrome" style={{ width: 640, padding: 16, background: "var(--color-canvas)" }}>
      <Samples gap={16} />
    </div>
  );
}
