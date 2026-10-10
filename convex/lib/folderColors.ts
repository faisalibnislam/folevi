// Folder colours: 25 distinct colours (packages/design-tokens/covers/folder-colors.json). The web app reads
// the same file for the swatches.
import folderColors from "../../packages/design-tokens/covers/folder-colors.json";
import legacyColors from "../../packages/design-tokens/covers/folder-colors-legacy.json";

export const FOLDER_COLORS: readonly string[] = (folderColors as { id: string }[]).map((c) => c.id);
export type FolderColor = string;
/** A random colour for a new folder. */
export const randomFolderColor = (random: () => number = Math.random): FolderColor => FOLDER_COLORS[Math.floor(random() * FOLDER_COLORS.length)]!;
export const isFolderColor = (c: string): c is FolderColor => FOLDER_COLORS.includes(c);

/**
 * A colour from the earlier palette (the note themes' pale page colours) as its nearest colour now. Folders keep their stored colour until it's changed; this is for
 * clients and jobs that need a current one.
 */
const LEGACY: Record<string, string> = legacyColors;
export const currentFolderColor = (c: string | null | undefined): FolderColor | null => (c ? (isFolderColor(c) ? c : (LEGACY[c] ?? null)) : null);
