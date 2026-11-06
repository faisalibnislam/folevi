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
const BACK_SHADOW = "0 8px 18px -4px rgb(20 20 30 / 0.12), 0 2px 4px rgb(20 20 30 / 0.07)";
/**
 * The back's outline: a tab on the left whose shoulder slopes down into the top edge, one piece with the body
 * (the owner, 7 November 2026, after a classic folder icon). Drawn as a mask over a 100 × 100 box stretched to
 * the card, so the back can be a plain CSS gradient (and dark mode can restyle it).
 */
const BACK_PATH =
  "M0 7C0 2.5 2 0 6.5 0H31C35 0 36.5 1 38.5 3.2C40.5 5.4 42 6 45 6H93.5C98 6 100 8.5 100 13V93C100 97.5 98 100 93.5 100H6.5C2 100 0 97.5 0 93Z";
const BACK_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${BACK_PATH}'/></svg>`)}") 0 0 / 100% 100% no-repeat`;
/** Where the folder's "…" menu appears on hover, at the right of the name on the front: the same raised chip as a note card's "…". */
export const FOLDER_CARD_MENU =
  "ui-raised absolute bottom-[8%] right-[4%] z-10 rounded-chip opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100";

/** The "…" button's look inside FOLDER_CARD_MENU, for pictures of the card (the app uses its MenuButton). */
export function FolderCardMenuLook() {
  return (
    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-chip text-muted">
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
      className={`absolute h-[70%] w-[78%] overflow-hidden rounded-chip shadow-[0_1px_3px_rgb(0_0_0/0.16),0_8px_18px_-6px_rgb(0_0_0/0.32)] transition-transform duration-300 ease-[var(--ease-folio)] ${place}`}
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
 * The drawing, after a classic folder icon but in the folder's softened colour (the owner, 7 November 2026): a
 * back with a sloped tab, lighter at the top; up to three of the notes inside, fanned; and a front pocket in the
 * folder's colour over their lower half, with the name and, under it, the count and last update. Goes inside an
 * element with FOLDER_CARD_FRAME, inside one with FOLDER_CARD_BOX.
 */
export function FolderCardArt({ name, color, count, age, previews = [] }: { name: string; color: string | null; count: number; age: string; previews?: FolderPreview[] }) {
  const base = folderHex(color);
  // The palette colour a little greyed, so a page of folders stays calm, then lightened (the owner, 7 November 2026: "lighter color overall"); the back is a lighter tint still.
  const tone = `color-mix(in oklab, ${base} 84%, #9a9fab)`;
  const shown = previews.slice(0, 3);
  return (
    <>
      {/* the back's soft shadow (the mask below would clip a box-shadow), then the back with its tab */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 top-[6%] rounded-panel" style={{ boxShadow: BACK_SHADOW }} />
      <div
        aria-hidden
        data-fc="back"
        className="absolute inset-0"
        style={{ background: `linear-gradient(to bottom, color-mix(in oklab, ${tone} 36%, #ffffff), color-mix(in oklab, ${tone} 52%, #ffffff))`, mask: BACK_MASK, WebkitMask: BACK_MASK, ["--fc" as string]: base }}
      />
      {/* the notes inside */}
      <div aria-hidden className="absolute inset-0">
        {shown.length ? (
          [...shown].reverse().map((p, i) => <FolderNote key={i} note={p} index={shown.length - 1 - i} />)
        ) : (
          <div className="absolute left-[12%] top-[14%] h-[60%] w-[76%] rounded-chip bg-white/70" />
        )}
      </div>
      {/* the front pocket, with the name and, under it, the count and last update */}
      <div
        aria-hidden
        data-fc="front"
        className="absolute inset-x-0 bottom-0 top-[50%] rounded-panel"
        style={{
          background: `linear-gradient(to bottom, color-mix(in oklab, ${tone} 58%, #ffffff), color-mix(in oklab, ${tone} 70%, #ffffff))`,
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 0 0 1px rgb(0 0 0 / 0.05), 0 -6px 14px -6px rgb(0 0 0 / 0.26)",
          ["--fc" as string]: base,
        }}
      >
        <span data-fc="name" className="absolute bottom-[30%] left-[8%] right-[18%] line-clamp-2 text-ellipsis wrap-normal break-normal text-[clamp(16px,calc(8.4cqw*var(--fc-text,1)),34px)] font-semibold leading-[1.15] tracking-[-0.015em] text-[#121318]">
          {name}
        </span>
        {/* count and last update (dark enough for 4.5:1 on every folder colour) */}
        <span data-fc="age" className="absolute bottom-[13%] left-[8%] right-[18%] truncate text-[clamp(12px,calc(5cqw*var(--fc-text,1)),20px)] font-medium leading-[1.25] tabular-nums" style={{ color: `color-mix(in oklab, ${base} 14%, #2a2c33)` }}>
          <span data-fc="count">{count.toLocaleString()} {count === 1 ? "note" : "notes"}</span> · {age}
        </span>
      </div>
    </>
  );
}
