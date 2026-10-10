import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { coverArtThumbUrl } from "@/lib/cover";
import { HERO_STYLES, heroGlow } from "./home/heroStyles";
import { PageBackdrop } from "./PageBackdrop";
import { Breadcrumbs } from "./parts";
import type { Crumb } from "./seo";
import { container, cx } from "./ui";

/*
 * The site's page layout, as on Home: one blurred artwork held behind the page, and the page's parts as
 * separate cards stacked over it (the header first), like panels in the app.
 */

/** The small copy of a theme's artwork used for the blurred backdrop (the hero's 200 px copies, else the 640 px thumb). */
function backdropImage(art: string): string {
  const hero = HERO_STYLES.find((a) => a.id === art);
  return hero ? heroGlow(hero) : coverArtThumbUrl(art);
}

/** The page's frame: the backdrop (the page's own artwork, or the site's default) and the stack of cards. */
export function PageFrame({ art = HERO_STYLES[0]!.id, children }: { art?: string; children: ReactNode }) {
  return (
    <div className="mk-home">
      <PageBackdrop image={backdropImage(art)} />
      <div className="mk-stack mk-page-stack">{children}</div>
    </div>
  );
}

/** Inner padding of a card (the home cards'). */
export const cardPad = "px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12";

type CardProps = { as?: "section" | "div" | "article" | "aside" | "nav"; inner?: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<"section">, "children">;

/** One card of the stack: the page's width (the home cards'), with the card's surface and padding. */
export function Card({ as: As = "section", className, inner, children, ...rest }: CardProps) {
  return (
    <As className={cx(container, className)} {...rest}>
      <div className={cx("mk-box", inner ?? cardPad)}>{children}</div>
    </As>
  );
}

/** The page's header card: its breadcrumbs, then the eyebrow, title, lede and actions. */
export function HeaderCard({ crumbs, className, children }: { crumbs?: Crumb[]; className?: string; children: ReactNode }) {
  return (
    <header className={container}>
      <div className={cx("mk-box px-5 pb-8 pt-5 sm:px-10 sm:pb-12 sm:pt-7 lg:px-14", className)}>
        {crumbs ? <Breadcrumbs items={crumbs} className="-ml-1.5" /> : null}
        <div className={crumbs ? "mt-6 sm:mt-8" : "pt-3 sm:pt-5"}>{children}</div>
      </div>
    </header>
  );
}
