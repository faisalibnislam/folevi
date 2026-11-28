import {
  DEFAULT_DOCUMENT_STYLE,
  type DocumentCover,
  type DocumentStyle,
} from "@folevi/editor-schema";
import { MoreHorizontal } from "lucide-react";
import { folderHex } from "@/lib/folderColors";
import { editedText } from "@/lib/format";
import { NOTE_CARD_ASPECT, NoteCardFace, type PreviewLine } from "./DocumentCard";

/*
 * How a folder card looks, shared by the app's FolderCard (the Folders page, Home's Recent folders and a folder
 * page's subfolders) and the site's replica of the Folders page, so both draw and move the same way. No hooks,
 * no data: the app wraps it in its link and menu, the site in plain decorative elements.
 *
 * The "Frosted" folder (the owner, 20 November 2026): a back with a soft S-curved tab in the folder's muted
 * colour, 85% opaque; up to five of the notes inside, drawn as their own note cards and fanned a little to both
 * sides, standing well above the back; up to two subfolders as whole folders stacked straight up behind it,
 * each a step higher and narrower, with no names; and a see-through front over the notes' lower half with the
 * name, the counts and the last change, fully frosted so the name reads cleanly (21 November).
 *
 * Hover: the card lifts 4 px (FOLDER_CARD_FRAME, 200 ms) and the notes rise a little, the front one most
 * (300 ms), both on the app's easing. The global prefers-reduced-motion rule in globals.css makes both instant.
 */

/**
 * A note peeking out of a folder, with what its own card shows (organization.index's previews): it is drawn as
 * that card. Everything but the cover is optional (the site's replica and older previews leave some out).
 */
export type FolderPreview = {
  cover: DocumentCover;
  title?: string;
  excerpt?: string;
  createdAt?: number;
  updatedAt?: number;
  style?: DocumentStyle | null;
  preview?: PreviewLine[] | null;
  shape?: string | null;
  kind?: string;
};

/**
 * The card's box: square (the notes stand above the folder, which makes the whole drawing about square), and the
 * container its cqw sizes are measured against (`--fc-text` scales the front's words on their own: a small card
 * keeps a bigger card's name and counts). `group` drives the hover; it isn't text to select (a held finger opens
 * its menu).
 */
export const FOLDER_CARD_BOX =
  "group relative aspect-square select-none [container-type:inline-size]";
/** What lifts on hover: the whole drawing. */
export const FOLDER_CARD_FRAME =
  "absolute inset-0 block rounded-folder outline-none transition-transform duration-200 ease-[var(--ease-folio)] hover:-translate-y-1";

/** Where the back starts, as a share of the card's height: the notes stand in the space above it. */
const BACK_TOP = 17;
/** Where the front starts: the front covers the card's lower 55%. */
export const FOLDER_FRONT_TOP = 45;
/**
 * The back's outline: a tab on the left that curves down into the top edge (an S-curve), one piece with the
 * body, drawn as a mask over a 100 × 100 box stretched to the back so it can be a plain CSS gradient. The tab's
 * top-left and the bottom corners are square here: the element's own rounded-folder rounds them, so they are true
 * circles of the front's radius and the back's bottom corners lie exactly under the front's (a stretched curve
 * peeked out past them). Subfolders stacked behind use the same outline.
 */
const BACK_PATH = "M0 0H43.3C50 0 52 3.2 54 8C56 13.2 58.7 16 65.3 16H94.8Q100 16 100 22.24V100H0Z";
/** Where the back's body starts beside the tab, as a share of the back's height (BACK_PATH's 16 of 100). */
const BACK_BODY_TOP = 0.16;
/** The back's and the subfolders' box: rounded like the front, masked to BACK_PATH. */
const BACK_BOX = "absolute bottom-0 rounded-folder";
const BACK_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${BACK_PATH}'/></svg>`)}") 0 0 / 100% 100% no-repeat`;
/** The front's fine grain, so the frost reads as a material and not a flat tint. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;

/**
 * Where the folder's "…" menu appears on hover: the frosted front's top-right corner, 8 px in, the same raised
 * chip as a note card's "…" (shown on hover or focus, always on touch).
 */
export const FOLDER_CARD_MENU =
  "ui-raised absolute top-[calc(45%+3px)] right-[3px] z-10 rounded-chip opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100";

/** The "…" button's look inside FOLDER_CARD_MENU, for pictures of the card (the app uses its MenuButton). */
export function FolderCardMenuLook() {
  return (
    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-chip text-muted">
      <MoreHorizontal size={16} aria-hidden />
    </span>
  );
}

/** The palette colour a little greyed, so a page of folders stays calm (the app's muted folder colours). */
const toneOf = (hex: string) => `color-mix(in oklab, ${hex} 84%, #9a9fab)`;

/** Up to two subfolders, stacked straight up behind the folder: where each starts and how far in its sides are. */
function stackOf(subfolders: number) {
  if (subfolders >= 2) return { tops: [5, 13.5], insets: [8, 4], back: 22 };
  if (subfolders === 1) return { tops: [9], insets: [4.5], back: 18 };
  return { tops: [] as number[], insets: [] as number[], back: BACK_TOP };
}

/* Each note's tilt and sideways step, front note first: fanned a little to both sides, as in today's cards. */
const TILT = [-1.6, 3, -3.4, 2.4, -2.6];
const STEP = [0, 3, -2.5, 2, -1.5];

/**
 * One note inside a folder, drawn as exactly its own note card (DocumentCard.tsx NoteCardFace, the owner,
 * 28 November 2026): its look, title, created date, first blocks and last edit, at the card's 25:27 shape and
 * scaled to 70% of the folder's width (everything on a note card is sized against its own width). No folder chip:
 * it is in this folder. Notes whose preview came without a style (stored before then) use the default look.
 */
function FolderNote({ note, depth, top }: { note: FolderPreview; depth: number; top: number }) {
  const rise = [
    "group-hover:-translate-y-[5%]",
    "group-hover:-translate-y-[3.5%]",
    "group-hover:-translate-y-[2.5%]",
    "group-hover:-translate-y-[1.5%]",
    "group-hover:-translate-y-[1%]",
  ][depth];
  const at = top + depth * 1.4;
  return (
    <div
      aria-hidden
      data-fc="note"
      className={`note-card-r absolute w-[70%] ${NOTE_CARD_ASPECT} origin-bottom rounded-l-tiny rounded-r-small shadow-[0_0_0_0.5px_rgb(40_40_60/0.16),0_1cqw_2cqw_-1cqw_rgb(0_0_0/0.25)] transition-transform duration-300 ease-[var(--ease-folio)] ${rise}`}
      style={{ left: `${15 + STEP[depth]!}%`, top: `${at}%`, rotate: `${TILT[depth]}deg` }}
    >
      <NoteCardFace
        title={note.title ?? ""}
        excerpt={note.excerpt ?? ""}
        preview={note.preview ?? null}
        cover={note.cover}
        style={note.style ?? DEFAULT_DOCUMENT_STYLE}
        createdAt={note.createdAt ?? 0}
        time={note.updatedAt ? editedText(note.updatedAt) : ""}
        shape={note.shape ?? null}
        kind={note.kind}
        showFolder={false}
        miniature
      />
    </div>
  );
}

/** The counts on the front: "3 notes", "1 folder · 2 notes", "3 folders", or "No notes yet". */
export function folderCountText(notes: number, subfolders = 0) {
  const parts: string[] = [];
  if (subfolders > 0)
    parts.push(`${subfolders.toLocaleString()} ${subfolders === 1 ? "folder" : "folders"}`);
  if (notes > 0) parts.push(`${notes.toLocaleString()} ${notes === 1 ? "note" : "notes"}`);
  return parts.length ? parts.join(" · ") : "No notes yet";
}

/**
 * The drawing. Goes inside an element with FOLDER_CARD_FRAME, inside one with FOLDER_CARD_BOX. `age` is the last
 * change as the app writes it ("Nov 18", "2 days ago"); the front says "Edited <age>".
 */
export function FolderCardArt({
  name,
  color,
  count,
  age,
  previews = [],
  subfolders = 0,
  subfolderColors = [],
  menuRoom = false,
  nameLines,
}: {
  name: string;
  color: string | null;
  count: number;
  age: string;
  previews?: FolderPreview[];
  /** How many folders are directly inside (up to two are drawn behind). */
  subfolders?: number;
  /** The colours of the two most recently changed subfolders (null: the default colour). */
  subfolderColors?: (string | null)[];
  /** The card has its "…" in the front's top-right corner (FOLDER_CARD_MENU): the name stops short of the 32 px chip. */
  menuRoom?: boolean;
  /**
   * How many lines the name may take. Left out: two, or one on a card under 144 px wide, where two lines, the counts
   * and the Edited date don't all fit on the front (as the Mac's WebFolderCard.nameLines), so the date never gets cut.
   */
  nameLines?: 1 | 2;
}) {
  const base = folderHex(color);
  const tone = toneOf(base);
  const shown = previews.slice(0, Math.min(5, Math.max(previews.length, 0)));
  const stack = stackOf(subfolders);
  // Notes in a folder with subfolders start a little lower, so the stacked tabs stay in sight.
  const noteTop = subfolders > 0 ? 7 : 3;
  // The two most recent subfolders, the farther one first (it is drawn first, so it sits behind).
  const kids = stack.tops
    .map((_, i) => folderHex(subfolderColors[stack.tops.length - 1 - i] ?? color))
    .reverse();
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ ["--fc" as string]: base, ["--fc-tone" as string]: tone }}
    >
      {/* the folder's soft shadow, under its back (half its first strength: the owner, 28 November 2026). It starts where the back's body does (BACK_PATH's 16 of 100), so its
          edge never shows in the gap beside the tab. */}
      <div
        className="absolute inset-x-0 bottom-0 rounded-folder shadow-[0_1px_2px_rgb(0_0_0/0.03),0_14px_26px_-14px_rgb(30_30_50/0.21)]"
        data-fc="shadow"
        style={{ top: `${stack.back + (100 - stack.back) * BACK_BODY_TOP}%` }}
      />
      {/* subfolders stacked behind, and the back with its tab: one 85% layer, so a subfolder's outline doesn't show through the back */}
      <div className="absolute inset-0 opacity-85">
        {kids.map((hex, i) => (
          <div
            key={i}
            data-fc="sub"
            className={BACK_BOX}
            style={{
              top: `${stack.tops[i]}%`,
              left: `${stack.insets[i]}%`,
              right: `${stack.insets[i]}%`,
              mask: BACK_MASK,
              WebkitMask: BACK_MASK,
              ["--fs" as string]: toneOf(hex),
            }}
          />
        ))}
        <div
          data-fc="back"
          className={`${BACK_BOX} inset-x-0`}
          style={{ top: `${stack.back}%`, mask: BACK_MASK, WebkitMask: BACK_MASK }}
        />
      </div>
      {/* the notes inside, the newest in front */}
      {[...shown].reverse().map((p, i) => (
        <FolderNote key={i} note={p} depth={shown.length - 1 - i} top={noteTop} />
      ))}
      {/* the frost: the notes blurred behind the whole front (globals.css) */}
      <div
        data-fc="frost"
        className="pointer-events-none absolute inset-x-0 bottom-0 rounded-folder"
        style={{ top: `${FOLDER_FRONT_TOP}%` }}
      />
      {/* the front, with the name, the counts and the last change */}
      <div
        data-fc="front"
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-folder px-[7cqw] pb-[5.6cqw] pt-[6.4cqw]"
        style={{ top: `${FOLDER_FRONT_TOP}%` }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.1] mix-blend-soft-light"
          style={{ backgroundImage: GRAIN }}
        />
        <span
          data-fc="name"
          className={`relative ${menuRoom ? "pr-[max(0px,calc(46px-7cqw))]" : ""} ${nameLines === 1 ? "block truncate" : nameLines === 2 ? "line-clamp-2" : "line-clamp-2 @max-[144px]:block @max-[144px]:truncate"} text-ellipsis wrap-normal break-normal font-serif text-[clamp(14px,calc(8cqw*var(--fc-text,1)*var(--fc-name,1)),30px)] font-semibold leading-[1.15]`}
        >
          {name}
        </span>
        <span data-fc="age" className="relative flex min-h-0 flex-1 flex-col tabular-nums">
          <span
            data-fc="count"
            className="mt-[1cqw] truncate text-[clamp(11px,calc(4.9cqw*var(--fc-text,1)),18px)] font-medium leading-[1.3] opacity-90"
          >
            {folderCountText(count, subfolders)}
          </span>
          <span data-fc="edited" className="mt-auto truncate text-footnote opacity-85">
            Edited {age}
          </span>
        </span>
      </div>
    </div>
  );
}
