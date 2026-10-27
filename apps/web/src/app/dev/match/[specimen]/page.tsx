import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { icons, type LucideIcon } from "lucide-react";
import specimens from "@folevi/design-tokens/match/specimens.json";
import { Samples } from "../samples";

export const metadata: Metadata = { title: "Match specimen", robots: { index: false, follow: false } };

type Style = { role?: string; weight?: number; display?: string; caps?: boolean };
type Spec = (typeof specimens.specimens)[number] & {
  items?: { text: string; style: Style }[];
  icons?: { name: string; size: number; strokeWidth: number }[];
  swatches?: string[];
  /** Component samples (../samples.tsx) by id, in a column. */
  samples?: string[];
  grid?: { cell: number; gap: number };
  gap?: number;
};

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
const pascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
/** `largeTitle` → `text-large-title`, `title1` → `text-title-1` (the type scale's classes). */
const roleClass = (r: string) => `text-${kebab(r)}`;

function className(s: Style): string {
  if (s.caps) return "ui-caps";
  if (s.display) return `ui-display ${roleClass(s.display)}`;
  return `${roleClass(s.role ?? "body")} text-ink`;
}

/**
 * Development only: one specimen of packages/design-tokens/match/specimens.json drawn with the web app's real
 * CSS, for the Mac app's screenshot diffs (apps/mac/scripts/match.mjs, docs/MAC_REBUILD_PLAN.md section 3.2).
 */
export default async function MatchSpecimenPage({ params }: { params: Promise<{ specimen: string }> }) {
  if (process.env.VERCEL_ENV === "production" || process.env.FOLEVI_ENV === "production") notFound();
  const { specimen } = await params;
  const spec = specimens.specimens.find((s) => s.id === specimen) as Spec | undefined;
  if (!spec) notFound();
  const grid = spec.grid ? { display: "grid", gridTemplateColumns: `repeat(auto-fill, ${spec.grid.cell}px)`, gap: `${spec.grid.gap}px` } : undefined;
  return (
    <div id="specimen" data-specimen={spec.id} className="ui-neutral-chrome" style={{ width: spec.width, padding: spec.padding, background: "var(--color-canvas)", boxSizing: "border-box" }}>
      {spec.items ? (
        <div style={{ display: "flex", flexDirection: "column", gap: spec.gap ?? 0 }}>
          {spec.items.map((item, i) => (
            <div key={i} className={className(item.style)} style={{ whiteSpace: "nowrap", ...(item.style.weight ? { fontWeight: item.style.weight } : {}) }}>
              {item.text}
            </div>
          ))}
        </div>
      ) : null}
      {spec.samples ? <Samples ids={spec.samples} gap={spec.gap ?? 0} /> : null}
      {spec.icons ? (
        <div style={grid}>
          {spec.icons.map((icon, i) => {
            const Icon = (icons as Record<string, LucideIcon>)[pascal(icon.name)];
            return (
              <div key={i} className="text-ink" style={{ width: spec.grid!.cell, height: spec.grid!.cell, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {Icon ? <Icon size={icon.size} strokeWidth={icon.strokeWidth} /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {spec.swatches ? (
        <div style={grid}>
          {spec.swatches.map((token) => (
            <div key={token} style={{ width: spec.grid!.cell, height: spec.grid!.cell, background: `var(--color-${kebab(token)})` }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
