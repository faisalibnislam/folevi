import { folderHex } from "@/lib/folderColors";

/*
 * A folder in the folder's muted colour, the folder card in miniature (the owner, 20 November 2026): a back with a
 * curved tab, a white page standing in it when it holds notes, and a plain front. A folder with subfolders shows a
 * small stack of folders behind it; an empty one shows no page. `size` is the height; the colours (light and
 * dark) are in globals.css (.fg-*).
 */
const BACK = "M0 22Q0 0 22 0H72C86 0 90 14 104 14H218Q240 14 240 36V198Q240 220 218 220H22Q0 220 0 198Z";

export type FolderGlyphKind = "notes" | "stack" | "empty";

export function FolderGlyph({ color, size = 18, kind = "notes", className = "" }: { color: string | null | undefined; size?: number; kind?: FolderGlyphKind; className?: string }) {
  const base = folderHex(color);
  const stack = kind === "stack";
  const vb = stack ? { y: -44, h: 264 } : { y: 0, h: 220 };
  return (
    <svg
      width={(size * 240) / vb.h}
      height={size}
      viewBox={`0 ${vb.y} 240 ${vb.h}`}
      aria-hidden
      className={`fg flex-none overflow-visible ${className}`}
      style={{ ["--fg-tone" as string]: `color-mix(in oklab, ${base} 84%, #9a9fab)` }}
    >
      {stack ? (
        <>
          <path className="fg-sub" opacity="0.7" d={BACK} transform="translate(30 -44) scale(0.75 0.8)" />
          <path className="fg-sub" d={BACK} transform="translate(15 -22) scale(0.875 0.9)" />
        </>
      ) : null}
      <path className="fg-back" d={BACK} />
      {kind === "notes" ? <rect className="fg-page" x="40" y="32" width="160" height="120" rx="12" /> : null}
      <rect className="fg-front" x="0" y="96" width="240" height="124" rx="24" />
    </svg>
  );
}
