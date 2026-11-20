import { useIpadLayout, useIphoneApp } from "@/lib/iphone";

/**
 * Card sizes on Home and in the grids. On the web and the Mac (the desktop layout) folder and note cards are 25%
 * smaller than they were, so more fit in a row (the owner, 20 November 2026); the iPad and the iPhone keep the
 * full size. globals.css carries the same numbers as --note-card-min, --folder-card-min, --subfolder-card and
 * --card-gap for the CSS grids.
 */
export const DESKTOP_CARD_SCALE = 0.75;

export function useCardSizes() {
  const ipad = useIpadLayout();
  const phone = useIphoneApp();
  const s = ipad || phone ? 1 : DESKTOP_CARD_SCALE;
  return { scale: s, noteCard: Math.round(250 * s), folderMin: Math.round(210 * s), gap: Math.floor((32 * s) / 4) * 4, rowGap: Math.floor((40 * s) / 4) * 4 };
}
