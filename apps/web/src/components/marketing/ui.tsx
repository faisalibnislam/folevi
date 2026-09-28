import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Icon, type IconName } from "./icons";

export const container = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

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
    size === "sm" ? "h-10 px-4 text-[14px]" : size === "lg" ? "h-12 px-6 text-[15.5px]" : "h-11 px-5 text-[15px]",
    className,
  );
  const content = (
    <>
      {children}
      {icon ? <Icon name={icon} size={16} /> : null}
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

/** The Folevi wordmark as the brand guide describes it: the mark in heading colour with an ember middle leaf. */
export function Wordmark({ className, markSize = 22 }: { className?: string; markSize?: number }) {
  return (
    <span className={cx("inline-flex items-center text-(--color-heading)", className)}>
      <FoleviLogo height={markSize} title={null} />
    </span>
  );
}

/** A small raised pill that introduces a section. */
export function Eyebrow({ children, className, tone }: { children: ReactNode; className?: string; tone?: Tone }) {
  return (
    <p className={cx("mk-chip mk-chip--raised", tone && `mk-tone--${tone}`, className)}>
      <span aria-hidden="true" className="mk-dot" />
      {children}
    </p>
  );
}

export type Tone = "moss" | "marigold" | "plum" | "coral" | "ember" | "accent";

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mk-kbd">{children}</kbd>;
}

export type BubbleSpec = { emoji: string; size: number; style: CSSProperties; className?: string; dur?: number; delay?: number };

/** Decorative glass bubbles holding small objects. Purely ornamental; hidden from assistive tech. */
export function Bubbles({ items }: { items: BubbleSpec[] }) {
  return (
    <>
      {items.map((b) => (
        <span
          key={`${b.emoji}-${b.size}`}
          aria-hidden="true"
          className={cx("mk-bubble", b.className)}
          style={{ ...b.style, ["--s" as string]: `${b.size}px`, ["--dur" as string]: `${b.dur ?? 9}s`, ["--delay" as string]: `${b.delay ?? 0}s` }}
        >
          <span>{b.emoji}</span>
        </span>
      ))}
    </>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  id,
  lede,
  align = "left",
  tone,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  id: string;
  lede?: ReactNode;
  align?: "left" | "center";
  tone?: Tone;
  className?: string;
}) {
  const center = align === "center";
  return (
    <div className={cx(center && "mx-auto text-center", className)}>
      <Eyebrow tone={tone} className={center ? "mx-auto" : undefined}>
        {eyebrow}
      </Eyebrow>
      <h2 id={id} className={cx("mk-h2 mt-5 max-w-[17ch]", center && "mx-auto")}>
        {title}
      </h2>
      {lede ? <p className={cx("mk-lede mt-5 max-w-[52ch]", center && "mx-auto")}>{lede}</p> : null}
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
    <header className="relative -mt-[76px] overflow-hidden pt-[76px]">
      <div aria-hidden="true" className="mk-glow mk-glow--soft mk-fade-bottom" />
      <div className={cx(container, "relative pb-12 pt-14 sm:pb-16 sm:pt-20")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mk-display mt-6 max-w-[18ch] text-[42px] sm:text-[60px] lg:text-[68px]">{title}</h1>
        {lede ? <div className="mk-lede mt-6 max-w-[58ch]">{lede}</div> : null}
        {children}
      </div>
    </header>
  );
}

export function DraftNotice({ updated }: { updated: string }) {
  return (
    <div
      role="note"
      className="mk-tone--marigold mt-8 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] bg-(--color-marigold-soft) px-4 py-3 text-[14px] text-ink shadow-[inset_0_1px_0_var(--mk-rim),0_0_0_1px_color-mix(in_oklab,var(--color-marigold-ink)_16%,transparent)]"
    >
      <span aria-hidden="true" className="mk-dot" />
      <strong className="font-semibold text-(--color-marigold-ink)">Draft — pending legal review</strong>
      <span className="text-muted">Last updated {updated}. This plain-language draft is not yet final.</span>
    </div>
  );
}
