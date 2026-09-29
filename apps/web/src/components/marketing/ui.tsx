import Link from "next/link";
import type { ReactNode } from "react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "./icons";

export const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A link styled as the app's buttons (6 px corners; the primary one is near-black, or near-white in dark mode). */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  icon,
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  className?: string;
}) {
  const classes = cx(
    "mk-btn",
    variant === "primary" ? "mk-btn-primary" : variant === "secondary" ? "mk-btn-secondary" : "mk-btn-ghost",
    size === "sm" ? "h-8 px-3 text-[13px]" : size === "lg" ? "h-11 px-5 text-[15px]" : "h-10 px-4 text-[14px]",
    className,
  );
  const content = (
    <>
      {children}
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
    </>
  );
  if (/^https?:/.test(href) || href.startsWith("mailto:")) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}

/** The Folevi logo: the round F mark and the letterforms, which follow the heading colour. */
export function Wordmark({ className, markSize = 22 }: { className?: string; markSize?: number }) {
  return (
    <span className={cx("inline-flex items-center text-(--color-heading)", className)}>
      <FoleviLogo height={markSize} title={null} />
    </span>
  );
}

/** A small caps label that introduces a section (the app's section labels). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("mk-caps", className)}>{children}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mk-kbd">{children}</kbd>;
}

export function SectionHeading({
  eyebrow,
  title,
  id,
  lede,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  id: string;
  lede?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const center = align === "center";
  return (
    <div className={cx(center && "mx-auto text-center", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className={cx("mk-h2 mt-4 max-w-[20ch]", center && "mx-auto")}>
        {title}
      </h2>
      {lede ? <p className={cx("mk-lede mt-4 max-w-[54ch]", center && "mx-auto")}>{lede}</p> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={cx(container, "pb-10 pt-12 sm:pb-14 sm:pt-20")}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mk-display mt-4 max-w-[20ch] text-[40px] sm:text-[56px] lg:text-[64px]">{title}</h1>
      {lede ? <div className="mk-lede mt-5 max-w-[60ch]">{lede}</div> : null}
      {children}
    </header>
  );
}

export function DraftNotice({ updated }: { updated: string }) {
  return (
    <div role="note" className="mt-8 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] bg-(--color-surface-sunken) px-4 py-3 text-[14px] text-ink">
      <strong className="font-semibold text-(--color-heading)">Draft: pending legal review</strong>
      <span className="text-muted">Last updated {updated}. This plain-language draft is not yet final.</span>
    </div>
  );
}
