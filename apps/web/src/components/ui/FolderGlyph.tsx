import { useId } from "react";
import { folderHex } from "@/lib/folderColors";

/*
 * A folder in the folder's muted colour, the folder card in miniature (the owner, 20 November 2026): a back with a
 * curved tab, a white page standing in it when it holds notes, and a plain front. A folder with subfolders shows a
 * small stack of folders behind it; an empty one shows no page. `size` is the height; the colours (light and
 * dark) are in globals.css (.fg-*).
 *
 * With the card's depth (the owner, 28 November 2026: "too flat"): the back's diagonal gradient, darker at the
 * top-left, the front's soft top-to-bottom tint with a light top edge, a hairline shadow where the front meets the
 * back and a small drop shadow, in the folder card's own colours (FolderCardArt, globals.css [data-fc]).
 */
// Corners 35% less round than they were (22 and 24 units, the owner, 2026-11-25): 14.3 and 15.6.
const BACK = "M0 14.3Q0 0 14.3 0H72C86 0 90 14 104 14H225.7Q240 14 240 28.3V205.7Q240 220 225.7 220H14.3Q0 220 0 205.7Z";

export type FolderGlyphKind = "notes" | "stack" | "empty";

export function FolderGlyph({ color, size = 18, kind = "notes", className = "" }: { color: string | null | undefined; size?: number; kind?: FolderGlyphKind; className?: string }) {
  const base = folderHex(color);
  const stack = kind === "stack";
  const vb = stack ? { y: -44, h: 264 } : { y: 0, h: 220 };
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={(size * 240) / vb.h}
      height={size}
      viewBox={`0 ${vb.y} 240 ${vb.h}`}
      aria-hidden
      className={`fg flex-none overflow-visible ${className}`}
      style={{ ["--fg-tone" as string]: `color-mix(in oklab, ${base} 84%, #9a9fab)` }}
    >
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" className="fg-b1" />
          <stop offset="1" className="fg-b2" />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="fg-f1" />
          <stop offset="1" className="fg-f2" />
        </linearGradient>
      </defs>
      {stack ? (
        <>
          <path className="fg-sub" opacity="0.7" d={BACK} transform="translate(30 -44) scale(0.75 0.8)" fill={`url(#${id}b)`} />
          <path className="fg-sub" d={BACK} transform="translate(15 -22) scale(0.875 0.9)" fill={`url(#${id}b)`} />
        </>
      ) : null}
      <path className="fg-back" d={BACK} fill={`url(#${id}b)`} />
      {kind === "notes" ? <rect className="fg-page" x="40" y="32" width="160" height="120" rx="12" /> : null}
      {/* the front's shadow on the back and the page, a hairline above it */}
      <rect className="fg-lip" x="0" y="88" width="240" height="132" rx="15.6" />
      <rect className="fg-front" x="0" y="96" width="240" height="124" rx="15.6" fill={`url(#${id}f)`} />
      {/* the front's light top edge */}
      <path className="fg-edge" d="M15.6 101H224.4" />
    </svg>
  );
}
