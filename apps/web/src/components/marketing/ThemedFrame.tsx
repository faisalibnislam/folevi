"use client";

import type { CSSProperties, ReactNode } from "react";
import { paletteVars } from "@/lib/cover";
import { heroGlow } from "./home/heroStyles";
import { PageBackdrop } from "./PageBackdrop";
import { artVars } from "./product/Replica";
import { useSiteTheme } from "./SiteShell";

/**
 * A page's frame in the site's note theme (the one picked on Home): its blurred backdrop, and the theme's
 * colours for the page's accents (marketing.css .mk-home), with the page's cards stacked over it.
 */
export function ThemedFrame({ children }: { children: ReactNode }) {
  const { art } = useSiteTheme();
  return (
    <div className="mk-home" style={{ ...artVars(art), ...paletteVars(art) } as CSSProperties}>
      <PageBackdrop image={heroGlow(art)} />
      <div className="mk-stack mk-page-stack">{children}</div>
    </div>
  );
}
