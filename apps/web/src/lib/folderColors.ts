// Folder colours: 25 distinct colours (packages/design-tokens/covers/folder-colors.json; the server checks
// against the same file). Folders coloured with the earlier palette (the note themes' pale page colours)
// show the nearest of these (folder-colors-legacy.json) until they're given a new one.
import folderColors from "@folevi/design-tokens/folder-colors.json";
import legacyColors from "@folevi/design-tokens/folder-colors-legacy.json";

export const FOLDER_COLORS: readonly { id: string; name: string; hex: string }[] = folderColors;
/** Folders without a colour show this. */
export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS.find((c) => c.id === "sky")?.id ?? FOLDER_COLORS[0]!.id;
const LEGACY: Record<string, string> = legacyColors;
/** The palette colour a folder shows: its own, the one an earlier colour maps to, or the default. */
export const folderColorId = (color: string | null | undefined): string => {
  if (color && FOLDER_COLORS.some((c) => c.id === color)) return color;
  return (color && LEGACY[color]) || DEFAULT_FOLDER_COLOR;
};
export const folderHex = (color: string | null | undefined) => FOLDER_COLORS.find((c) => c.id === folderColorId(color))!.hex;
