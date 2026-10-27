import type { DocumentCover } from "@folevi/editor-schema";
import { MoreHorizontal } from "lucide-react";
import { folderHex } from "@/lib/folderColors";
import { coverArtOf, coverArtThumbUrl, styleColorsOf } from "@/lib/cover";

/*
 * How a folder card looks, shared by the app's FolderCard (the Folders page and Home's Recent folders, in
 * OrganizeIndex.tsx) and the site's replica of the Folders page, so both draw and move the same way. No
 * hooks, no data: the app wraps it in its link and menu, the site in plain decorative elements.
 *
 * Hover: the card lifts 4 px (FOLDER_CARD_FRAME, 200 ms) and the notes inside rise a little out of the
 * folder, the front one most (FolderNote, 300 ms), both on the app's easing. The global
 * prefers-reduced-motion rule in globals.css makes both instant.
 */

export type FolderPreview = { cover: DocumentCover; title?: string; excerpt?: string };

/**
 * The card's box: portrait, and the container its cqw sizes are measured against (`--fc-text` scales the
 * cover's labels on their own: a small card keeps a full-size card's count, age and name). `group` drives the hover; it isn't text to select (a held finger opens its menu). */
export const FOLDER_CARD_BOX = "group relative aspect-[820/912] select-none [container-type:inline-size]";
/** What lifts on hover: the whole drawing (its soft shadow is the back's own, FolderCardArt). */
export const FOLDER_CARD_FRAME =
  "absolute inset-0 block rounded-panel outline-none transition-transform duration-200 ease-[var(--ease-folio)] hover:-translate-y-1";

/**
 * The folder's soft shadow, cast by its back (the tab and the body, each its own rounded box): the same two
 * shadows the whole drawing used to cast as a `drop-shadow` filter, which made WebKit draw every tile off screen
 * and blur it again on every new screen (docs/IOS_PERFORMANCE.md). The body is drawn after the tab, so the tab's
 * shadow never falls on it; the front cover sits inside the back, so the outline is the same.
 */
const BACK_SHADOW = "0 8px 14px rgb(20 20 30 / 0.1), 0 1px 2px rgb(20 20 30 / 0.06)";
/** Where the folder's "…" menu appears on hover, over the front cover. */
export const FOLDER_CARD_MENU =
  "absolute left-1/2 top-[70%] z-10 -translate-x-1/2 -translate-y-1/2 rounded-chip bg-white/90 text-[#17171a] opacity-0 shadow-[0_1px_3px_rgb(0_0_0/0.18)] transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100";

/** The "…" button's look inside FOLDER_CARD_MENU, for pictures of the card (the app uses its MenuButton). */
export function FolderCardMenuLook() {
  return (
    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-chip text-[#17171a]/75">
      <MoreHorizontal size={16} aria-hidden />
    </span>
  );
}

/** One note inside a folder, drawn small: its page colour, theme image down the spine, title and opening text. */
function FolderNote({ note, index }: { note: FolderPreview; index: number }) {
  const colors = styleColorsOf(note.cover);
  const art = coverArtOf(note.cover);
  const place = [
    "left-[9%] top-[8%] -rotate-[4deg] group-hover:-translate-y-[5%]",
    "left-[14%] top-[10%] rotate-[3deg] group-hover:-translate-y-[3.5%]",
    "left-[11%] top-[12.5%] -rotate-[1deg] group-hover:-translate-y-[2%]",
  ][index]!;
  const ink = colors?.ink ?? "#1c1c1f";
  return (
    <div
      aria-hidden
      className={`absolute h-[70%] w-[78%] overflow-hidden rounded-chip shadow-[0_1px_2px_rgb(0_0_0/0.12),0_6px_14px_-6px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-[var(--ease-folio)] ${place}`}
      style={{ background: colors?.paper ?? "#ffffff" }}
    >
      {art ? <div className="absolute inset-y-0 left-0 w-[7%]" style={{ background: `url(${coverArtThumbUrl(art.id)}) center / cover no-repeat` }} /> : null}
      <div className="absolute inset-0 left-[13%] right-[7%] top-[7%] overflow-hidden">
        <p className="line-clamp-2 text-ellipsis wrap-normal break-normal font-serif text-[5.4cqw] font-medium leading-[1.2]" style={{ color: ink }}>
          {note.title || "Untitled"}
        </p>
        <p className="mt-[2cqw] whitespace-pre-line break-words text-[3.2cqw] leading-[1.45]" style={{ color: `color-mix(in oklab, ${ink} 82%, ${colors?.paper ?? "#ffffff"})` }}>
          {note.excerpt || ""}
        </p>
      </div>
    </div>
  );
}

/**
 * The drawing: a tinted back with a tab, up to three of the notes inside (faint and soft, fanned), and a
 * frosted-glass front cover in the folder's colour that the notes show through. Count, last update and
 * name sit on the front. Goes inside an element with FOLDER_CARD_FRAME, inside one with FOLDER_CARD_BOX.
 */
export function FolderCardArt({ name, color, count, age, previews = [] }: { name: string; color: string | null; count: number; age: string; previews?: FolderPreview[] }) {
  const base = folderHex(color);
  const backTone = `color-mix(in oklab, ${base} 80%, #8e94a3)`;
  const shown = previews.slice(0, 3);
  return (
    <>
      {/* back, with its tab */}
      <div aria-hidden data-fc="back" className="absolute left-0 top-0 h-[9%] w-[44%] rounded-t-control" style={{ background: backTone, boxShadow: `inset 0 0 0 1px rgb(0 0 0 / 0.08), ${BACK_SHADOW}`, ["--fc" as string]: base }} />
      <div aria-hidden data-fc="back" className="absolute inset-x-0 bottom-0 top-[5%] rounded-panel rounded-tl-none" style={{ background: backTone, boxShadow: `inset 0 0 0 1px rgb(0 0 0 / 0.08), ${BACK_SHADOW}`, ["--fc" as string]: base }} />
      {/* the notes inside, faint and soft */}
      <div aria-hidden className="absolute inset-0">
        {shown.length ? (
          [...shown].reverse().map((p, i) => <FolderNote key={i} note={p} index={shown.length - 1 - i} />)
        ) : (
          <div className="absolute left-[12%] top-[12%] h-[60%] w-[76%] rounded-chip bg-white/60" />
        )}
      </div>
      {/* frosted front cover, with the count, last update and name on it. They're its children, not siblings
          after it: on an iPhone's GPU a later sibling of a backdrop-filtered layer can be drawn under it and only
          show while the card is pressed; a child is always drawn over its own backdrop. */}
      <div
        aria-hidden
        data-fc="front"
        className="absolute inset-x-0 bottom-0 top-[46%] rounded-panel shadow-[inset_0_1px_0_rgb(255_255_255/0.75),inset_0_0_0_1px_rgb(0_0_0/0.08),0_-6px_16px_-10px_rgb(0_0_0/0.25)] [-webkit-backdrop-filter:blur(9px)_saturate(1.3)] [backdrop-filter:blur(9px)_saturate(1.3)]"
        style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${base} 62%, transparent), color-mix(in oklab, ${base} 86%, transparent))`, ["--fc" as string]: base }}
      >
        {/* page count */}
        <span
          data-fc="count"
          className="absolute left-[7%] top-[9.26%] inline-flex items-center rounded-tiny px-[calc(2.2cqw*var(--fc-text,1))] py-[calc(1.3cqw*var(--fc-text,1))] font-serif text-[clamp(12px,calc(5.4cqw*var(--fc-text,1)),22px)] font-semibold leading-none tabular-nums text-[#111114]"
          style={{ background: `color-mix(in oklab, ${base} 55%, #8e94a3)` }}
        >
          {count.toLocaleString()}
        </span>
        {/* last update */}
        <span data-fc="age" className="absolute right-[7%] top-[10.37%] -mt-[0.15em] max-w-[55%] truncate pb-[0.1em] font-serif text-[clamp(11px,calc(5.6cqw*var(--fc-text,1)),24px)] leading-[1.2]" style={{ color: `color-mix(in oklab, ${base} 25%, #3c4250)` }}>
          {age}
        </span>
        {/* name */}
        <span data-fc="name" className="absolute bottom-[11.48%] left-[7%] right-[7%] line-clamp-2 text-ellipsis wrap-normal break-normal font-serif text-[clamp(16px,calc(9.4cqw*var(--fc-text,1)),40px)] leading-[1.12] tracking-[-0.01em] text-[#0d0d10]">
          {name}
        </span>
      </div>
    </>
  );
}
