// foleviShell.files.save (docs/LOCAL_MODE_PLAN.md §4.1): a file the page made (local mode's export ZIP)
// saved where the person picks in a save dialog. The page never names a path: it gives a file name, which is
// cleaned here and only suggested; the dialog decides. Bytes are checked before anything is shown.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The largest file the page may hand over (an export holds at most 400 MB of attachments, plus the notes). */
export const MAX_SAVE_BYTES = 600 * 1024 * 1024;

/** A file name safe to suggest: no folders, no control or reserved characters, not hidden, at most 180 characters. */
export function saveFileName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, "-")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "Folevi file";
}

/** The page's bytes, when they're bytes of an acceptable size; null otherwise. */
export function saveBytes(input: unknown): Uint8Array | null {
  if (!(input instanceof Uint8Array)) return null;
  if (input.byteLength === 0 || input.byteLength > MAX_SAVE_BYTES) return null;
  return input;
}

/** What the dialog's filter offers for a name ("ZIP archive" for .zip, and so on). */
export function saveFilters(name: string): { name: string; extensions: string[] }[] {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
  if (!ext) return [];
  const label: Record<string, string> = { zip: "ZIP archive", md: "Markdown", html: "HTML", pdf: "PDF", json: "JSON", txt: "Text", csv: "CSV" };
  return [{ name: label[ext] ?? `${ext.toUpperCase()} file`, extensions: [ext] }];
}

export interface SaveDeps {
  /** Shows the save dialog; the chosen path, or null when cancelled. */
  choose(o: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  /** Where the dialog starts (Downloads). */
  folder: string;
  write?: (path: string, bytes: Uint8Array) => Promise<void>;
}

/** Saves the page's file where the person chooses. True once written; false when cancelled or refused. */
export async function saveFromPage(name: unknown, bytes: unknown, deps: SaveDeps): Promise<boolean> {
  const data = saveBytes(bytes);
  if (!data) return false;
  const file = saveFileName(name);
  const path = await deps.choose({ defaultPath: join(deps.folder, file), filters: saveFilters(file) });
  if (!path) return false;
  await (deps.write ?? ((p, b) => writeFile(p, b)))(path, data);
  return true;
}
