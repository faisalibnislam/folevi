import type { CSSProperties, ReactNode } from "react";
import { cx } from "./ui";

/*
 * The site's playful touches, all decorative (aria-hidden) and all still when motion is reduced:
 *
 *   Doodle   a hand-drawn stroke in the accent violet (underline, circle, arrow, squiggle)
 *            that draws itself once it scrolls into view (MarketingMotion adds data-seen).
 *   Mark     a word with a doodle behind it: <Mark>notes app</Mark>.
 *   Hand     a handwritten note (Mali), tilted, with an optional arrow pointing at something.
 *   Sticker  a tilted badge that wobbles on hover.
 *   Float    an app piece that bobs gently and drifts with scroll (data-float: how far, against the scroll).
 *
 * The motion is MarketingMotion's (one observer for the whole site); these are plain server markup.
 */

export type DoodleKind = "underline" | "circle" | "arrow" | "squiggle" | "loop-arrow";

const PATHS: Record<DoodleKind, { viewBox: string; d: string[]; stretch?: boolean }> = {
  underline: { viewBox: "0 0 200 14", d: ["M3 9.5C38 4.5 82 3.5 120 5.5S178 9 197 6"], stretch: true },
  circle: {
    viewBox: "0 0 220 64",
    d: ["M118 6C64 3 14 12 8 30c-5 17 38 29 104 29 62 0 102-10 104-27 2-18-52-28-112-26-34 1-58 6-72 12"],
    stretch: true,
  },
  arrow: { viewBox: "0 0 64 64", d: ["M8 6c10 26 22 40 46 50", "M40 56l15 1-3-15"] },
  "loop-arrow": { viewBox: "0 0 90 70", d: ["M6 10c22-8 40 4 34 18-5 11-20 6-15-5 6-12 30-10 44 4 8 8 12 18 13 30", "M72 50l10 9 6-13"] },
  squiggle: { viewBox: "0 0 120 18", d: ["M3 12c10-12 18-12 24 0s14 12 22 0 16-12 24 0 14 12 22 0 14-10 22-2"], stretch: true },
};

export function Doodle({ kind, className, style, width = 2.4 }: { kind: DoodleKind; className?: string; style?: CSSProperties; width?: number }) {
  const p = PATHS[kind];
  return (
    <svg
      aria-hidden="true"
      viewBox={p.viewBox}
      preserveAspectRatio={p.stretch ? "none" : undefined}
      className={cx("mk-doodle pointer-events-none", className)}
      style={style}
      fill="none"
    >
      {p.d.map((d, i) => (
        <path
          key={i}
          d={d}
          pathLength={1}
          strokeWidth={width}
          vectorEffect={p.stretch ? "non-scaling-stroke" : undefined}
          style={{ ["--d" as string]: `${i * 140}ms` }}
        />
      ))}
    </svg>
  );
}

/** A word with a hand-drawn mark behind it (an underline by default, or a circle around it). */
export function Mark({ children, kind = "underline" }: { children: ReactNode; kind?: "underline" | "circle" | "squiggle" }) {
  return (
    <span className="mk-mark" data-kind={kind}>
      {children}
      <Doodle kind={kind} className="mk-mark-doodle" width={kind === "circle" ? 2.2 : 3} />
    </span>
  );
}

/** A handwritten aside, tilted, with an arrow drawn towards what it's about. */
export function Hand({
  children,
  rotate = -4,
  arrow,
  className,
}: {
  children: ReactNode;
  rotate?: number;
  /** Where the arrow points from the note (below-left, below-right…), or none. */
  arrow?: "down-left" | "down-right" | "up-left" | "up-right" | "loop";
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cx("mk-hand", className)} style={{ ["--r" as string]: `${rotate}deg` }}>
      {children}
      {arrow ? (
        <span className="mk-hand-arrow" data-dir={arrow}>
          <Doodle kind={arrow === "loop" ? "loop-arrow" : "arrow"} className="size-full" />
        </span>
      ) : null}
    </span>
  );
}

/** A tilted badge. Tones: paper (white), violet, ink (black). */
export function Sticker({
  children,
  tone = "paper",
  rotate = -6,
  className,
  icon,
}: {
  children: ReactNode;
  tone?: "paper" | "violet" | "ink";
  rotate?: number;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span className={cx("mk-sticker", className)} data-tone={tone} style={{ ["--r" as string]: `${rotate}deg` }}>
      {icon ? <span aria-hidden="true" className="mk-sticker-icon">{icon}</span> : null}
      {children}
    </span>
  );
}

/**
 * A piece of the app floating beside a section: it bobs gently and drifts against the scroll by `depth`
 * (0.05 to 0.3; deeper drifts more). Decorative: hidden from assistive tech, and from small screens unless
 * `phone` is set.
 */
export function Float({ children, depth = 0.12, delay = 0, className, phone = false }: { children: ReactNode; depth?: number; delay?: number; className?: string; phone?: boolean }) {
  return (
    <div
      aria-hidden="true"
      inert
      data-float={depth}
      className={cx("mk-float pointer-events-none select-none", !phone && "max-lg:hidden", className)}
      style={{ ["--bob-delay" as string]: `${delay}ms` }}
    >
      <div className="mk-float-bob">{children}</div>
    </div>
  );
}
