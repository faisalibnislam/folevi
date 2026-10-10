"use client";

import type { StylePalette } from "@/lib/palette";
import { familyFor, SHEETS, TEXTS, type ThemeDefaults, type ThemeFonts } from "@/lib/themes";

export interface PreviewTheme {
  name: string;
  /** The image as CSS (url(…)), or null while there's none. */
  image: string | null;
  palette: StylePalette;
  defaults: ThemeDefaults;
  fonts: ThemeFonts;
}

/** The title's typeface: the theme's serif for Modern and Serif pages, else the page's own font type. */
const titleFont = (d: ThemeDefaults, fonts: ThemeFonts) => familyFor(d.font === "sans" ? "serif" : d.font, fonts);

function Separator({ kind, color }: { kind: ThemeDefaults["separator"]; color: string }) {
  if (kind === "doodle") {
    return (
      <svg aria-hidden viewBox="0 0 120 10" className="my-3 h-2.5 w-28" preserveAspectRatio="none">
        <path d="M1 6 Q8 1 15 6 T29 6 T43 6 T57 6 T71 6 T85 6 T99 6 T113 6" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return <hr aria-hidden className="my-3 border-0" style={{ borderTop: kind === "dots" ? `2px dotted ${color}` : `1px solid ${color}` }} />;
}

/**
 * A sample note in a theme, light or dark: the image behind and on the cover, the page and text colours,
 * the title and body in the theme's typefaces, the accent, the five text colours, four highlights and the
 * separator. Drawn from the values being edited, so it changes as they do.
 */
export function ThemePreview({ theme, dark }: { theme: PreviewTheme; dark: boolean }) {
  const { palette: p, defaults: d, fonts } = theme;
  const sheet = SHEETS.find((s) => s.id === d.sheet);
  const night = d.sheet === "night";
  const paper = sheet?.color ?? (dark ? p.paperDark : p.paper);
  const ink = TEXTS.find((t) => t.id === d.text)?.color ?? (night ? "#f2f2f4" : sheet ? "#1c1c1f" : dark ? p.inkDark : p.ink);
  // The theme's own accent and colours apply while the page is on Auto (as in the app).
  const own = !sheet;
  const deep = dark || night;
  const accent = own ? (deep ? p.accentDark : p.accent) : ink;
  const text = deep ? p.textDark : p.text;
  const hl = deep ? p.highlightDark : p.highlight;
  const line = `color-mix(in oklab, ${ink} 22%, transparent)`;
  const titleOnCover = p.tone === "deep" ? "#ffffff" : ink;
  return (
    <div className="overflow-hidden rounded-panel p-4" style={{ background: theme.image ? `${theme.image} center / cover no-repeat` : "var(--color-surface-sunken)" }}>
      <article className="overflow-hidden rounded-control shadow-[var(--shadow-sheet)]" style={{ background: paper, color: ink }}>
        <div className="relative h-24" style={{ background: theme.image ? `${theme.image} center / cover no-repeat` : "transparent" }}>
          <h3 className="absolute bottom-2 left-5 right-5 truncate text-[26px] font-semibold leading-tight" style={{ fontFamily: titleFont(d, fonts), color: titleOnCover, textShadow: p.tone === "deep" ? "0 1px 14px rgb(0 0 0 / 0.4)" : undefined }}>
            {theme.name || "Untitled theme"}
          </h3>
        </div>
        <div className="px-5 pb-5 pt-4 text-[14.5px] leading-relaxed" style={{ fontFamily: familyFor(d.font, fonts) }}>
          <p>
            A quiet morning, <strong>bold</strong> and <em>italic</em>, with a{" "}
            <span className="rounded-tiny px-0.5" style={{ background: hl[0] }}>
              highlight
            </span>{" "}
            and a{" "}
            <a className="underline underline-offset-2" style={{ color: accent }}>
              link
            </a>
            .
          </p>
          <Separator kind={d.separator} color={line} />
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <span aria-hidden className="grid size-4 place-items-center rounded-tiny text-[10px] text-white" style={{ background: accent }}>
                ✓
              </span>
              <span className="line-through opacity-60">Water the plants</span>
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="size-4 rounded-tiny" style={{ boxShadow: `inset 0 0 0 1.5px ${line}` }} />
              Call the framer
            </li>
          </ul>
          <blockquote className="mt-3 pl-3" style={{ borderLeft: `3px solid ${accent}` }}>
            Slow mornings make fast afternoons.
          </blockquote>
          <p className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[13px]">
            {text.map((c, i) => (
              <span key={i} className="font-semibold" style={{ color: c }}>
                {p.names[i] ?? "Colour"}
              </span>
            ))}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1.5 text-[12.5px]">
            {hl.map((c, i) => (
              <span key={i} className="rounded-tiny px-1" style={{ background: c }}>
                Highlight {i + 1}
              </span>
            ))}
          </p>
          <p className="mt-3 text-[12.5px]" style={{ fontFamily: familyFor("mono", fonts) }}>
            const note = &quot;mono&quot;;
          </p>
        </div>
      </article>
    </div>
  );
}
