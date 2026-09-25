"use client";

import type { DocumentCover, DocumentStyle } from "@folevi/editor-schema";

import { accentVar, coverBackground, softVar } from "@/lib/cover";

export { coverBackground };

/**
 * Visual preview of a document for the browser grid. Each document's own accent, font and card
 * style carry through so browsing feels expressive while the chrome stays quiet.
 */
export function DocumentCardPreview({
  title,
  icon,
  excerpt,
  cover,
  style,
  compact,
  footer,
}: {
  footer?: React.ReactNode;
  title: string;
  icon: string | null;
  excerpt: string;
  cover: DocumentCover;
  style: DocumentStyle;
  compact?: boolean;
}) {
  const bg = coverBackground(cover, style);
  const cardClass =
    style.card === "tinted" ? "bg-[color-mix(in_oklab,var(--card-accent-soft)_60%,var(--color-surface))]" :
    style.card === "outline" ? "bg-surface shadow-[inset_0_0_0_1.5px_var(--card-accent)]" : "bg-surface";
  return (
    <div
      className={`relative h-full overflow-hidden rounded-[18px] ${cardClass}`}
      style={{ ["--card-accent" as string]: accentVar(style.accent), ["--card-accent-soft" as string]: softVar(style.accent) }}
    >
      {!compact ? (
        <div
          aria-hidden
          className="relative h-[72px]"
          style={{
            background:
              bg ??
              `radial-gradient(90% 140% at 100% 0%, color-mix(in oklab, var(--card-accent-soft) 90%, transparent), transparent 70%), linear-gradient(180deg, color-mix(in oklab, var(--card-accent-soft) 45%, var(--color-surface)), var(--color-surface))`,
          }}
        >
          <span className="absolute inset-x-0 bottom-0 h-px bg-[color-mix(in_oklab,var(--color-heading)_6%,transparent)]" />
        </div>
      ) : null}
      <div className={compact ? "p-3.5" : "px-4 pb-11 pt-0"}>
        {icon ? (
          <div className={`${compact ? "mb-1.5" : "relative z-10 -mt-6 mb-2"} grid h-11 w-11 place-items-center rounded-[13px] bg-surface text-[24px] leading-none shadow-[var(--shadow-control)]`} aria-hidden>
            {icon}
          </div>
        ) : !compact ? (
          <div className="-mt-6 mb-2 h-11" aria-hidden />
        ) : null}
        <h3 className={`line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.012em] text-heading ${style.font === "serif" ? "font-serif text-[16.5px]" : style.font === "mono" ? "font-mono text-[14px]" : ""}`}>
          {title || "Untitled"}
        </h3>
        {!compact ? <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{excerpt || "Empty page"}</p> : null}
      </div>
      {footer ? <div className="absolute bottom-3.5 left-4 right-4 flex items-center gap-2 text-[11.5px] text-[var(--color-ink-faint)]">{footer}</div> : null}
    </div>
  );
}
