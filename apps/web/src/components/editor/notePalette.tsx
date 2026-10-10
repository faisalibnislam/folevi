"use client";

import { createContext, useContext, type ReactNode } from "react";
import { PALETTE_HIGHLIGHT_SLOTS, PALETTE_TEXT_SLOTS, paletteVars, type StyleColors } from "@/lib/cover";
import { COLOR_NAMES } from "./commands";

/**
 * The open note's theme palette, for pickers outside the page (Format panel, selection toolbar): the
 * attributes that make `.fb-color-*` / `.fb-hl-*` swatches show the theme's colours, and their names.
 * Null when the note has no theme palette (Plain, or a manual page colour): the fixed colours apply.
 */
interface NotePalette {
  attrs: { "data-palette": string; style: Record<string, string> };
  names: string[];
}
const Ctx = createContext<NotePalette | null>(null);

export function NotePaletteProvider({ colors, active, children }: { colors: StyleColors | null; active: boolean; children: ReactNode }) {
  const vars = active ? paletteVars(colors) : undefined;
  const value = vars && colors?.names?.length === 5 ? { attrs: { "data-palette": "", style: vars }, names: colors.names } : null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotePalette(): NotePalette | null {
  return useContext(Ctx);
}

/** A colour's name for labels: the theme's own name for its slot ("Teal"), else the fixed name ("Moss"). */
export function colorName(palette: NotePalette | null, id: string): string {
  if (palette) {
    const t = (PALETTE_TEXT_SLOTS as readonly string[]).indexOf(id);
    if (t >= 0) return palette.names[t]!;
    const h = (PALETTE_HIGHLIGHT_SLOTS as readonly string[]).indexOf(id);
    if (h >= 0) return palette.names[h]!;
  }
  return COLOR_NAMES[id] ?? id;
}
