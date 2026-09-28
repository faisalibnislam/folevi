// Folder colours: the note styles' light page colours, one per distinct colour, named after the first style
// with it (packages/design-tokens/covers/folder-colors.json, written by scripts/covers.mjs; the server
// checks against the same file).
import folderColors from "@folevi/design-tokens/folder-colors.json";

export const FOLDER_COLORS: readonly { id: string; name: string; hex: string }[] = folderColors;
/** Folders without a colour (older ones) show this. */
export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS.find((c) => c.id === "blue-haze")?.id ?? FOLDER_COLORS[0]!.id;
export const folderHex = (color: string | null | undefined) => (FOLDER_COLORS.find((c) => c.id === color) ?? FOLDER_COLORS.find((c) => c.id === DEFAULT_FOLDER_COLOR)!).hex;
