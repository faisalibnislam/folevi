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
    style.card === "tinted" ? "bg-[color-mix(in_oklab,var(--card-accent-soft)_70%,var(--color-raised))]" :
    style.card === "outline" ? "bg-transparent border-[1.5px] border-[var(--card-accent)]" :
    style.card === "plain" ? "bg-raised" : "bg-raised";
  return (
    <div
      className={`relative h-full overflow-hidden rounded-[12px] border border-line ${cardClass}`}
      style={{ ["--card-accent" as string]: accentVar(style.accent), ["--card-accent-soft" as string]: softVar(style.accent) }}
    >
      {style.card === "folio" ? (
        // A small folded corner: the folio motif.
        <span aria-hidden className="absolute right-0 top-0 z-10 h-4 w-4 rounded-bl-[4px] bg-[linear-gradient(225deg,var(--color-canvas)_0_50%,color-mix(in_oklab,var(--color-line)_70%,var(--color-raised))_50%_100%)] shadow-[-1px_1px_1px_rgba(24,32,28,0.06)]" />
      ) : null}
      {!compact ? (
        <div className="h-16 border-b border-line/60" style={{ background: bg ?? "var(--color-surface)" }}>
          {!bg ? <div aria-hidden className="folio-lines h-full opacity-60" /> : null}
        </div>
      ) : null}
      <div className={compact ? "p-3" : "p-4 pt-3"}>
        {icon ? <div className={`${compact ? "" : "-mt-8"} mb-1 text-2xl leading-none`} aria-hidden>{icon}</div> : null}
        <h3 className={`line-clamp-2 text-[15px] font-semibold leading-snug text-ink ${style.font === "serif" ? "font-serif text-[17px] font-normal" : style.font === "mono" ? "font-mono text-[14px]" : ""}`}>
          {title || "Untitled"}
        </h3>
        {!compact ? <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{excerpt || "Empty page"}</p> : null}
      </div>
      {footer ? <div className="absolute bottom-3 left-4 right-4 flex items-center gap-2 text-[11px] text-faint">{footer}</div> : null}
      <span aria-hidden className="absolute bottom-0 left-4 right-4 h-[2px] rounded-t-full" style={{ background: accentVar(style.accent), opacity: 0.55 }} />
    </div>
  );
}
