import type { ReactNode } from "react";
import { artById, artThumb } from "./product/Replica";
import { Checks } from "./Checks";
import { cx } from "./ui";

// A feature with its picture, as the home page's Foli AI section and the Foli AI page lay them out: text and
// points beside (or above) the picture on a stage lit by a note theme.

/** Some features sit in a panel tinted by the page's note theme, so tinted and plain rows alternate. */
const TINTED = "mk-panel p-4 sm:p-8 lg:p-10";

export function Feature({
  eyebrow,
  title,
  art,
  picture,
  points,
  children,
  reverse = false,
  stacked = false,
  column = false,
  tint = false,
}: {
  eyebrow: string;
  title: string;
  /** The note theme that lights the picture's stage. */
  art: string;
  picture: ReactNode;
  points: ReactNode[];
  /** A line under the title (optional: bullets alone are fine). */
  children?: ReactNode;
  reverse?: boolean;
  /** Text on top in two columns, and the picture below at full width. */
  stacked?: boolean;
  /** One column of a pair: the picture on top, the text under it. */
  column?: boolean;
  tint?: boolean;
}) {
  const tinted = tint ? TINTED : undefined;
  const stage = (
    <div
      className={cx("mk-stage px-3 py-8 sm:px-8 sm:py-10", reverse && "lg:order-1")}
      style={{ ["--stage-art" as string]: artThumb(artById(art)) }}
    >
      {picture}
    </div>
  );
  if (column) {
    // In a two-column grid the pair shares its rows (subgrid), so both pictures end, and both texts start, level.
    return (
      <div className={cx(tinted, "grid gap-8 lg:row-span-2 lg:grid-rows-subgrid")}>
        <div
          className="mk-stage flex items-center px-3 py-8 sm:px-6 sm:py-10"
          style={{ ["--stage-art" as string]: artThumb(artById(art)) }}
        >
          {picture}
        </div>
        <div>
          <p className="mk-caps">{eyebrow}</p>
          <h3 className="mk-display mt-3 text-[26px] leading-[1.1] sm:text-[30px]">{title}</h3>
          {children ? <p className="mt-3 text-[16px] leading-relaxed text-muted">{children}</p> : null}
          <Points points={points} className="mt-5" />
        </div>
      </div>
    );
  }
  if (stacked) {
    return (
      <div className={tinted}>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="mk-caps">{eyebrow}</p>
            <h3 className="mk-display mt-3 max-w-[16ch] text-[28px] leading-[1.1] sm:text-[34px]">
              {title}
            </h3>
            {children ? (
              <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed text-muted [&_b]:font-medium [&_b]:text-ink">
                {children}
              </p>
            ) : null}
          </div>
          <Points points={points} className="lg:pt-8" />
        </div>
        <div className="mt-8">{stage}</div>
      </div>
    );
  }
  return (
    <div
      className={cx(
        tinted,
        "grid items-center gap-8 lg:gap-14",
        reverse
          ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
          : "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]",
      )}
    >
      <div className={cx("max-w-[460px]", reverse && "lg:order-2")}>
        <p className="mk-caps">{eyebrow}</p>
        <h3 className="mk-display mt-3 text-[28px] leading-[1.1] sm:text-[34px]">{title}</h3>
        {children ? (
          <p className="mt-4 text-[16px] leading-relaxed text-muted [&_b]:font-medium [&_b]:text-ink">
            {children}
          </p>
        ) : null}
        <Points points={points} className="mt-5" />
      </div>
      {stage}
    </div>
  );
}

/** A feature's points, as checkmark lines. */
export function Points({ points, className }: { points: ReactNode[]; className?: string }) {
  return <Checks items={points} className={className} />;
}

export function SmallFeature({
  art,
  picture,
  title,
  body,
}: {
  art: string;
  picture: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div
        className="mk-stage flex min-h-[380px] items-center px-3 py-8 sm:px-8"
        style={{ ["--stage-art" as string]: artThumb(artById(art)) }}
      >
        {picture}
      </div>
      <h3 className="mk-h3 mt-5 text-[17px]">{title}</h3>
      <p className="mt-1.5 max-w-[48ch] text-[14.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
