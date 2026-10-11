import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ThemedFrame } from "./ThemedFrame";
import { Breadcrumbs } from "./parts";
import type { Crumb } from "./seo";
import { container, cx } from "./ui";

/*
 * The site's page layout, as on Home: one blurred artwork held behind the page, and the page's parts as
 * separate cards stacked over it (the header first), like panels in the app.
 */

/**
 * The page's frame: the site's note theme (picked on Home, remembered on this device) behind the stack of
 * cards, lighting the page and its accents. `art` is kept for older call sites; every page now follows the
 * site's theme.
 */
export function PageFrame({ children }: { art?: string; children: ReactNode }) {
  return <ThemedFrame>{children}</ThemedFrame>;
}

/** Inner padding of a card (the home cards'). */
export const cardPad = "px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12";

type CardProps = { as?: "section" | "div" | "article" | "aside" | "nav"; inner?: string; /** In the site theme's paper (.mk-tint). */ tint?: boolean; children: ReactNode } & Omit<ComponentPropsWithoutRef<"section">, "children">;

/** One card of the stack: the page's width (the home cards'), with the card's surface and padding. */
export function Card({ as: As = "section", className, inner, tint, children, ...rest }: CardProps) {
  return (
    <As className={cx(container, className)} {...rest}>
      <div className={cx("mk-box", tint && "mk-tint", inner ?? cardPad)}>{children}</div>
    </As>
  );
}

/** The page's header card: its breadcrumbs, then the eyebrow, title, lede and actions. */
export function HeaderCard({ crumbs, className, children }: { crumbs?: Crumb[]; className?: string; children: ReactNode }) {
  return (
    <header className={container}>
      <div className={cx("mk-box mk-tint relative overflow-hidden px-5 pb-10 pt-5 sm:px-10 sm:pb-14 sm:pt-7 lg:px-14", className)}>
        {crumbs ? <Breadcrumbs items={crumbs} className="-ml-1.5" /> : null}
        <div className={crumbs ? "mt-6 sm:mt-8" : "pt-3 sm:pt-5"}>{children}</div>
      </div>
    </header>
  );
}
