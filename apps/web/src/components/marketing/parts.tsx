import Link from "next/link";
import { Float } from "./fun";
import { CursorPiece, TaskPiece } from "./pieces";
import type { ReactNode } from "react";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { Icon } from "./icons";
import { JsonLd, breadcrumbLd, faqLd, type Crumb, type FaqItem } from "./seo";
import { SIGN_UP_URL } from "./site";
import { ButtonLink, container, cx } from "./ui";

/*
 * Pieces shared by the feature, template gallery and docs pages: breadcrumbs (with their structured data),
 * a question list (with FAQPage data), a card that links to another page, and the closing sign-up panel.
 */

/** Visible breadcrumbs and the matching BreadcrumbList. The last crumb is the current page. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <>
      <JsonLd data={breadcrumbLd(items)} />
      <nav aria-label="Breadcrumb" className={className}>
        <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[13.5px] text-muted">
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <li key={item.path} className="flex min-w-0 items-center gap-0.5">
                {last ? (
                  <span aria-current="page" className="truncate px-1.5 text-ink">
                    {item.name}
                  </span>
                ) : (
                  <>
                    <Link
                      href={item.path}
                      className="inline-flex min-h-8 items-center rounded-chip px-1.5 transition-colors duration-150 hover:bg-(--color-surface-sunken) hover:text-(--color-heading)"
                    >
                      {item.name}
                    </Link>
                    <Icon name="chevron-right" size={13} className="flex-none text-faint" />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

/** Questions and answers in their own card, plus FAQPage structured data built from the same text. */
export function FaqSection({
  id = "faq",
  title = "Questions",
  faqs,
  path,
  className,
  bare = false,
  collapsed = false,
}: {
  id?: string;
  title?: string;
  faqs: FaqItem[];
  path: string;
  className?: string;
  /** In a column of cards, not the page's width. */ bare?: boolean;
  /** Questions only, each opening on click (the main pages keep them short). */ collapsed?: boolean;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={cx(!bare && container, className)}>
      <div className="mk-box px-5 pt-8 sm:px-10 sm:pt-10 lg:px-14 lg:pt-12">
        <JsonLd data={faqLd(path, faqs)} />
        <h2 id={`${id}-title`} className="mk-h2">
          {title}
        </h2>
        {collapsed ? (
          <div className="mt-4 pb-4 sm:pb-6">
            {faqs.map((item, index) => (
              <details key={item.q} className={cx("group py-4", index > 0 && "border-t mk-hair")}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold tracking-[-0.012em] text-(--color-heading) [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span
                    aria-hidden="true"
                    className="grid size-7 flex-none place-items-center rounded-chip text-[18px] font-normal text-(--mk-violet-ink) bg-(--mk-violet-soft) transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        ) : (
          <dl className="mk-prose mt-4 max-w-none pb-2 sm:pb-4 [&>div]:mt-0">
            {faqs.map((item, index) => (
              <div
                key={item.q}
                className={cx(
                  "grid gap-2 py-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10",
                  index > 0 && "border-t mk-hair",
                )}
              >
                <dt className="text-[16.5px] font-semibold tracking-[-0.012em] text-(--color-heading)">
                  {item.q}
                </dt>
                <dd className="text-muted">{item.a}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

/** A card that links to another page; the whole card is the link's target area. */
export function LinkCard({
  href,
  title,
  body,
  icon,
  cover,
  headingLevel = "h3",
  layout = "stack",
  id,
  className,
}: {
  href: string;
  title: string;
  body: ReactNode;
  icon?: ReactNode;
  /** A picture across the top of the card (the features index's covers). */
  cover?: ReactNode;
  headingLevel?: "h2" | "h3";
  /**
   * "grow": the cover takes the card's spare height, so covers in a row line up whatever the text below.
   * "wide": the same, and on large screens the cover sits on the left with the text beside it.
   */
  layout?: "stack" | "grow" | "wide";
  id?: string;
  className?: string;
}) {
  const Heading = headingLevel;
  const grow = layout !== "stack";
  const wide = layout === "wide";
  return (
    <div
      id={id}
      data-tilt={wide ? "1.5" : "3"}
      className={cx(
        "mk-card group relative flex h-full scroll-mt-24 flex-col hover:shadow-(--shadow-pop)",
        wide && "lg:flex-row",
        cover ? "overflow-hidden" : "p-5 sm:p-6",
        className,
      )}
    >
      {/* The card clips the cover to its own corners, so the cover's stage needs none. */}
      {cover ? (
        <div className={cx("border-b mk-hair [&>.mk-stage]:rounded-none", grow && "flex flex-1 flex-col", wide && "lg:w-[62%] lg:flex-none lg:border-b-0 lg:border-r")}>
          {cover}
        </div>
      ) : null}
      <div className={cx("flex flex-col", grow ? "flex-none" : "flex-1", cover ? "p-5 sm:p-6" : undefined, wide && "lg:flex-1 lg:justify-center lg:p-10")}>
        {icon ? <span className="mb-4">{icon}</span> : null}
        <Heading className={cx("mk-h3 text-[16.5px] leading-snug", wide && "lg:text-[24px]")}>
          <Link
            href={href}
            className="after:absolute after:inset-0 after:rounded-control focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-(--color-focus)"
          >
            {title}
          </Link>
        </Heading>
        <div className={cx("mt-1.5 text-[14.5px] leading-relaxed text-muted", grow ? undefined : "flex-1", wide && "lg:mt-3 lg:text-[16px]")}>{body}</div>
        <span
          aria-hidden="true"
          className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-(--color-heading)"
        >
          Read more{" "}
          <Icon
            name="arrow-right"
            size={14}
            className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
      </div>
    </div>
  );
}

/** The closing card on feature, template and docs pages. */
export function SignUpPanel({
  title = "Start with one note.",
  body,
  href = SIGN_UP_URL,
  cta = "Start writing",
  secondary,
}: {
  title?: string;
  body: ReactNode;
  href?: string;
  cta?: string;
  secondary?: { label: string; href: string };
}) {
  return (
    <section aria-labelledby="signup-title" className={container}>
      <div className="mk-box mk-tint relative overflow-hidden px-6 py-16 text-center sm:px-10 sm:py-24">
        <Float depth={0.16} className="left-[7%] top-14 [--tilt:-5deg]">
          <TaskPiece text="Write the first note" done />
        </Float>
        <Float depth={0.1} delay={900} className="bottom-14 right-[7%]">
          <CursorPiece name="You" tone="ink" />
        </Float>
        <FoleviMark size={44} className="mx-auto block" />
        <h2
          id="signup-title"
          className="mk-display relative mx-auto mt-6 max-w-[18ch] text-[38px] sm:text-[60px]"
        >
          {title}
        </h2>
        <p className="mk-lede mx-auto mt-4 max-w-[48ch]">{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          <ButtonLink href={href} icon="arrow-right" size="lg">
            {cta}
          </ButtonLink>
          {secondary ? (
            <ButtonLink href={secondary.href} variant="secondary" size="lg">
              {secondary.label}
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </section>
  );
}
