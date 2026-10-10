"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DocumentCover, DocumentStyle } from "@folevi/editor-schema";
import { PencilLine, Star } from "lucide-react";
import { FolderGlyph } from "@/components/ui/FolderGlyph";

import { accentVar, coverArtOf, coverArtThumbUrl, coverBackground, pageBackdrop, sheetProps, softVar } from "@/lib/cover";
import { useCoverImage } from "@/lib/app/coverImage";
import { ageText } from "@/lib/format";
import type { HomeFolder } from "./FolderBadge";
// Page colours (data-sheet / data-text) come from the editor stylesheet, so thumbnails match the page.
import "@/components/editor/editor.css";

export { coverBackground };

/** One line of the derived documents.preview (the page's first blocks). */
export interface PreviewLine {
  t: string;
  x: string;
  l?: number;
  c?: boolean;
  d?: number;
  rows?: string[][];
}

const LIST = new Set(["bulleted", "numbered", "todo"]);

/** The page's first blocks as plain text: paragraphs apart, list items on their own lines. */
function previewText(lines: PreviewLine[] | null | undefined, excerpt: string): string {
  if (!lines?.length) return excerpt;
  let out = "";
  let n = 0;
  let prev: string | null = null;
  for (const l of lines) {
    let x: string;
    n = l.t === "numbered" ? n + 1 : 0;
    if (l.t === "table") x = (l.rows ?? []).map((r) => r.filter(Boolean).join("  ")).filter(Boolean).join("\n");
    else if (l.t === "bulleted") x = `• ${l.x}`;
    else if (l.t === "numbered") x = `${n}. ${l.x}`;
    else if (l.t === "todo") x = `${l.c ? "☑" : "☐"} ${l.x}`;
    else x = l.x;
    x = x.trim();
    if (!x) continue;
    if (out) out += prev && LIST.has(prev) && LIST.has(l.t) ? "\n" : "\n\n";
    out += x;
    prev = l.t;
  }
  return out || excerpt;
}

/** How many lines of body text fit in the element (its line height scales with the card). */
function useFitLines() {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(12);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (lh > 0) setLines(Math.max(1, Math.floor((el.clientHeight + 1) / lh)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, lines };
}

/**
 * Classes for the link that wraps a NoteCardFace in a grid (shape, shadow, hover lift, focus ring). The card
 * is a notebook: portrait, square-ish at the spine and rounded on the open edge, with a soft shadow falling
 * down and a little to the left. The close layer reaches under the spine too, so that corner never shows a
 * pale gap.
 */
export const NOTE_CARD_LINK =
  "block aspect-[25/27] rounded-l-tiny rounded-r-panel shadow-[-3px_10px_14px_-8px_rgb(20_20_30/0.16),-4px_18px_30px_-18px_rgb(20_20_30/0.14),0_2px_5px_rgb(20_20_30/0.03)] outline-none transition-[transform,box-shadow] duration-200 ease-[var(--ease-folio)] hover:-translate-y-0.5 hover:shadow-[-3px_12px_16px_-8px_rgb(20_20_30/0.18),-5px_24px_36px_-18px_rgb(20_20_30/0.18),0_3px_8px_rgb(20_20_30/0.04)] focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/** Aspect ratio of a note card (a portrait notebook), for placeholders that stand in for one. */
export const NOTE_CARD_ASPECT = "aspect-[25/27]";

/**
 * A note in the grid, drawn as a binder page: a strip down the left carries the note's artwork (cover,
 * gradient or colour) with punched holes in the page colour, and the page itself shows the title (serif),
 * when it was created, its opening text (clamped with "…"), and a footer with the last edit and its
 * folder (or Draft). Starred notes get a corner tab. Everything scales with the card width.
 */
export function NoteCardFace({
  title,
  excerpt,
  preview,
  cover,
  style,
  createdAt,
  time,
  starred,
  folder,
  showFolder = true,
  extra,
}: {
  title: string;
  excerpt: string;
  preview?: PreviewLine[] | null;
  cover: DocumentCover;
  style: DocumentStyle;
  createdAt: number;
  /** The footer time, e.g. "1 hour ago" (edited) or "Deleted 2 days ago". */
  time: string;
  starred?: boolean;
  folder?: HomeFolder | null;
  showFolder?: boolean;
  extra?: ReactNode;
}) {
  const body = useFitLines();
  const { url: imageUrl, palette } = useCoverImage(cover);
  // A built-in style shows its small thumbnail in the spine (sharp at 2×, much lighter than the full image).
  const artOnSpine = cover.kind === "art" && !style.backdrop ? coverArtOf(cover) : null;
  const strip =
    (artOnSpine ? `url(${coverArtThumbUrl(artOnSpine.id)}) center / cover no-repeat` : null) ??
    pageBackdrop(style, cover, imageUrl) ??
    coverBackground(cover, style, imageUrl) ??
    // Plain notes (no artwork): a very light grey strip.
    "color-mix(in oklab, var(--color-heading) 7%, var(--color-canvas))";
  const text = previewText(preview, excerpt);
  const chip = "bg-[color-mix(in_oklab,var(--color-line)_75%,transparent)]";
  const sheet = sheetProps(style, cover, palette);
  return (
    <div className="relative h-full w-full [container-type:inline-size]">
      {/* the page block, peeking out past the cover's open edge and bottom */}
      <span aria-hidden className="absolute bottom-0 left-0 right-0 top-[1.4%] rounded-l-tiny rounded-r-panel bg-[color-mix(in_oklab,var(--color-heading)_13%,var(--color-canvas))]" />
      {/* the cover */}
      <div
        {...sheet}
        className="fb-sheet absolute bottom-[1cqw] left-0 right-[1cqw] top-0 flex overflow-hidden rounded-l-tiny rounded-r-panel bg-surface text-ink"
      >
      {/* the spine, in the note's theme */}
      <div aria-hidden className="relative w-[6%] flex-none shadow-[inset_-1px_0_0_rgb(0_0_0/0.06)]" style={{ background: strip }} />
      {/* the cover's face: title, preview and footer */}
      <div className="flex min-w-0 flex-1 flex-col pb-[6cqw] pl-[7cqw] pr-[6cqw] pt-[8cqw]">
        <h3 className="line-clamp-2 break-words pr-[7cqw] font-serif text-[6.6cqw] font-medium leading-[1.22] tracking-[0.005em] text-heading">{title || "Untitled"}</h3>
        <p className="mt-[1cqw] truncate text-[4.5cqw] leading-[1.3] text-faint">
          <span className="sr-only">Created </span>
          {ageText(createdAt, { title: true })}
        </p>
        <div ref={body.ref} className="mt-[4.6cqw] min-h-0 flex-1 overflow-hidden text-[3.6cqw] leading-[5cqw]">
          <p className="whitespace-pre-line break-words text-faint [-webkit-box-orient:vertical] [display:-webkit-box] overflow-hidden" style={{ WebkitLineClamp: body.lines }}>
            {text || <span className="italic">Empty page</span>}
          </p>
        </div>
        <div className="mt-[3.5cqw] flex h-[8.6cqw] flex-none items-center gap-[2cqw] text-[3.8cqw]">
          {extra}
          <span className="min-w-0 flex-1 truncate text-muted">{time}</span>
          {showFolder ? (
            <span className={`inline-flex h-full min-w-0 max-w-[62%] flex-none items-center gap-[1.8cqw] rounded-tiny px-[3cqw] font-semibold text-heading ${chip}`}>
              {folder ? <FolderGlyph color={folder.color} className="h-[4.4cqw] w-auto" /> : <PencilLine aria-hidden className="h-[3.8cqw] w-[3.8cqw] flex-none" strokeWidth={2} />}
              <span className="truncate">
                {folder ? (
                  <>
                    <span className="sr-only">In folder </span>
                    {folder.name}
                  </>
                ) : (
                  "Draft"
                )}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {/* A 1px, 5% black outline drawn above the spine and cover so it runs round the whole cover. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-l-tiny rounded-r-panel shadow-[inset_0_0_0_1px_rgb(0_0_0/0.05)]" />
      {starred ? (
        <span className={`absolute right-0 top-0 grid h-[12cqw] w-[12cqw] place-items-center rounded-bl-chip text-heading ${chip}`}>
          <Star className="h-[5.6cqw] w-[5.6cqw] fill-current" aria-label="Starred" />
        </span>
      ) : null}
      </div>
    </div>
  );
}

/** The compact card (Compact layout): title and folder. */
export function DocumentCardPreview({ title, style, footer }: { title: string; style: DocumentStyle; footer?: ReactNode }) {
  const cardClass =
    style.card === "tinted" ? "bg-[color-mix(in_oklab,var(--card-accent-soft)_60%,var(--color-surface))]" :
    style.card === "outline" ? "bg-surface shadow-[inset_0_0_0_1.5px_var(--card-accent)]" : "bg-surface";
  return (
    <div
      className={`relative h-full overflow-hidden rounded-chip ${cardClass}`}
      style={{ ["--card-accent" as string]: accentVar(style.accent), ["--card-accent-soft" as string]: softVar(style.accent) }}
    >
      <div className="p-3.5">
        <h3 className="line-clamp-2 font-serif text-[16.5px] font-semibold leading-snug text-heading">
          {title || "Untitled"}
        </h3>
      </div>
      {footer ? <div className="absolute bottom-3.5 left-4 right-4 flex items-center gap-2 text-[11.5px] text-[var(--color-ink-faint)]">{footer}</div> : null}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-chip shadow-[inset_0_0_0_1px_rgb(0_0_0/0.05)]" />
    </div>
  );
}
