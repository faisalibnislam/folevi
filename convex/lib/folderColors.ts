// Folder colours: the note styles' light page colours (packages/design-tokens/covers/folder-colors.json,
// written by scripts/covers.mjs). The web app reads the same file for the swatches.
import folderColors from "../../packages/design-tokens/covers/folder-colors.json";

export const FOLDER_COLORS: readonly string[] = (folderColors as { id: string }[]).map((c) => c.id);
export type FolderColor = string;
/** A random colour for a new folder. */
export const randomFolderColor = (random: () => number = Math.random): FolderColor => FOLDER_COLORS[Math.floor(random() * FOLDER_COLORS.length)]!;
export const isFolderColor = (c: string): c is FolderColor => FOLDER_COLORS.includes(c);
