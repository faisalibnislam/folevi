// Library paths and note file names, as packages/local-store/src/layout.ts defines them (restated because the
// main process can't load workspace TypeScript at run time; paths.test.ts checks both agree on a corpus).
import { LibraryError } from "./types";

export const LIBRARY_FILE = "folevi-library.json";
export const NOTES_DIR = "notes";
export const FILES_DIR = "files";
export const HISTORY_DIR = "history";
export const TMP_DIR = ".folevi-tmp";
export const NOTE_EXT = ".fnote";

/** Library paths are relative, use forward slashes, and never contain `..`, empty parts or control characters. */
export function isValidLibraryPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/") || path.endsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function checkPath(path: unknown): string {
  if (!isValidLibraryPath(path)) throw new LibraryError("invalid_path", `Invalid library path: ${JSON.stringify(path)}`);
  return path;
}

/** A directory argument: "" (the whole library) or a valid path. */
export function checkDir(dir: unknown): string {
  if (dir === "") return "";
  return checkPath(dir);
}

const isValidId = (v: string) => /^[A-Za-z0-9_-]{1,64}$/.test(v);

export interface ParsedNoteName {
  id: string;
  copy: null | { provider: "dropbox" | "icloud" | "numbered" | "onedrive"; label: string };
  placeholder: boolean;
}

const ULID = "[0-9A-Z]{26}";
const HMAC_NAME = "[0-9a-z]{26}";
const DERIVED = ["daily-\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{16}", "inbox-[0-9a-f]{16}"];
const STRICT_SHAPES = [ULID, HMAC_NAME, ...DERIVED].map((s) => new RegExp(`^(${s})(?:-(.+))?$`));

/** local-store's `parseNoteFileName`: the id of a note file, a provider's copy of one, or an iCloud placeholder. */
export function parseNoteFileName(fileName: string): ParsedNoteName | null {
  let name = fileName;
  let placeholder = false;
  const icloud = /^\.(.+)\.icloud$/.exec(name);
  if (icloud) {
    name = icloud[1]!;
    placeholder = true;
  }
  if (!name.endsWith(NOTE_EXT)) return null;
  const stem = name.slice(0, -NOTE_EXT.length);
  const cut = stem.search(/[ (]/);
  if (cut > 0) {
    const id = stem.slice(0, cut);
    const rest = stem.slice(cut);
    if (!isValidId(id)) return null;
    let provider: "dropbox" | "icloud" | "numbered" | null = null;
    if (/^ \(.*conflict.*\)$/i.test(rest)) provider = "dropbox";
    else if (/^ ?\(\d+\)$/.test(rest)) provider = "numbered";
    else if (/^ \d+$/.test(rest)) provider = "icloud";
    if (!provider) return null;
    return { id, copy: { provider, label: rest.trim() }, placeholder };
  }
  if (cut === 0) return null;
  for (const shape of STRICT_SHAPES) {
    const m = shape.exec(stem);
    if (m) {
      if (m[2] === undefined) return { id: m[1]!, copy: null, placeholder };
      if (/^[A-Za-z0-9_-]{1,64}$/.test(m[2])) return { id: m[1]!, copy: { provider: "onedrive", label: m[2] }, placeholder };
    }
  }
  if (isValidId(stem)) return { id: stem, copy: null, placeholder };
  return null;
}

/** `.<name>.icloud`, the placeholder older macOS versions leave for a file in iCloud Drive that isn't downloaded. */
export function placeholderName(fileName: string): string {
  return `.${fileName}.icloud`;
}

/** The real name behind a placeholder, or null. */
export function fromPlaceholderName(fileName: string): string | null {
  const m = /^\.(.+)\.icloud$/.exec(fileName);
  return m ? m[1]! : null;
}
