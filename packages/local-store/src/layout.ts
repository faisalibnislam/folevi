// The library folder (LOCAL_MODE_PLAN.md §3.1): paths, the manifest, path validation (the bridge rules in
// §4.1) and recognising the copies cloud providers make when two devices write the same file (§3.7).
import { isValidId } from "@folevi/editor-schema";
import { fromUtf8, utf8 } from "./bytes";
import { isDeviceId } from "./hlc";

export const LIBRARY_FILE = "folevi-library.json";
export const NOTES_DIR = "notes";
export const FILES_DIR = "files";
export const HISTORY_DIR = "history";
export const INDEX_DIR = "index";
export const INDEX_FILE = "index/library.findex";
export const CATALOG_DIR = "index/catalog";
export const DEVICES_DIR = "devices";
export const TMP_DIR = ".folevi-tmp";
export const NOTE_EXT = ".fnote";

export class PathError extends Error {
  override name = "PathError";
}

/** Library paths are relative, use forward slashes, and never contain `..`, empty parts or control characters. */
export function isValidLibraryPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function assertLibraryPath(path: string): string {
  if (!isValidLibraryPath(path))
    throw new PathError(`Invalid library path: ${JSON.stringify(path)}`);
  return path;
}

/** `notes/<id>.fnote` (with encryption, `name` is the HMAC name from `crypto/envelope.ts`). */
export function notePath(idOrName: string): string {
  return `${NOTES_DIR}/${idOrName}${NOTE_EXT}`;
}

export function historyDir(docIdOrName: string): string {
  return `${HISTORY_DIR}/${docIdOrName}`;
}

export function historyPath(docIdOrName: string, versionFile: string): string {
  return `${historyDir(docIdOrName)}/${versionFile}`;
}

/** `files/<aa>/<sha256>`: content addressed, written once. With encryption the name is an HMAC. */
export function attachmentPath(nameHex: string): string {
  if (!/^[0-9a-z]{16,64}$/.test(nameHex))
    throw new PathError(`Invalid attachment name: ${nameHex}`);
  return `${FILES_DIR}/${nameHex.slice(0, 2)}/${nameHex}`;
}

export function catalogPath(deviceId: string): string {
  if (!isDeviceId(deviceId)) throw new PathError(`Invalid device id: ${deviceId}`);
  return `${CATALOG_DIR}/${deviceId}.fcat`;
}

export function devicePath(deviceId: string): string {
  if (!isDeviceId(deviceId)) throw new PathError(`Invalid device id: ${deviceId}`);
  return `${DEVICES_DIR}/${deviceId}.json`;
}

export function tmpPath(name: string): string {
  return `${TMP_DIR}/${name}`;
}

// ---- The manifest ----

export const LIBRARY_FORMAT = "folevi-library";
export const LIBRARY_VERSION = 1;

export interface EncryptionHeader {
  alg: "A256GCM";
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  /** base64: 12-byte nonce, then the AES-GCM sealed 32-byte master key. */
  wrappedKey: string;
  /** base64 HMAC that confirms an unwrapped key is the library's. */
  keyCheck: string;
}

export interface LibraryManifest {
  format: typeof LIBRARY_FORMAT;
  /** Format version of the library as a whole (note files carry their own `v`). */
  v: number;
  libraryId: string;
  createdAt: number;
  /** Apps older than this must not write to the library (they may read). */
  minWriterVersion: number;
  encryption: EncryptionHeader | null;
  /** Set once the library was uploaded to an account (§6.1). */
  migratedTo?: string;
}

export function createManifest(
  libraryId: string,
  createdAt: number,
  encryption: EncryptionHeader | null = null,
): LibraryManifest {
  return {
    format: LIBRARY_FORMAT,
    v: LIBRARY_VERSION,
    libraryId,
    createdAt,
    minWriterVersion: 1,
    encryption,
  };
}

export function encodeManifest(m: LibraryManifest): Uint8Array {
  return utf8(`${JSON.stringify(m, null, 2)}\n`);
}

export function decodeManifest(bytes: Uint8Array): LibraryManifest {
  const m = JSON.parse(fromUtf8(bytes)) as Partial<LibraryManifest>;
  if (!m || m.format !== LIBRARY_FORMAT) throw new Error("Not a Folevi library.");
  if (
    typeof m.libraryId !== "string" ||
    typeof m.createdAt !== "number" ||
    typeof m.minWriterVersion !== "number"
  )
    throw new Error("The library file is missing fields.");
  return { encryption: null, v: 1, ...m } as LibraryManifest;
}

/** Whether this app (which understands `formatVersion`) may write to the library. */
export function canWrite(m: LibraryManifest, formatVersion: number): boolean {
  return formatVersion >= m.minWriterVersion;
}

// ---- Conflict copies ----

export type ConflictProvider = "dropbox" | "icloud" | "numbered" | "onedrive";

export interface ParsedNoteName {
  /** The note id, or the HMAC name in an encrypted library. */
  id: string;
  /** Set when this is a copy a cloud provider made; merge it into the canonical file, then delete it. */
  copy: null | { provider: ConflictProvider; label: string };
  /** An iCloud placeholder (`.<name>.icloud`): listed, not downloaded yet. */
  placeholder: boolean;
}

const ULID = "[0-9A-Z]{26}";
/** HMAC names (encrypted libraries): 26 lowercase Crockford characters, the same shape as a ULID. */
const HMAC_NAME = "[0-9a-z]{26}";
const DERIVED = ["daily-\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{16}", "inbox-[0-9a-f]{16}"];
const STRICT_SHAPES = [ULID, HMAC_NAME, ...DERIVED].map((s) => new RegExp(`^(${s})(?:-(.+))?$`));

/**
 * Parses a file name in `notes/`. Recognises:
 * - Dropbox: `<id> (Faisal's conflicted copy 2026-10-20).fnote`, `<id> (Case Conflict).fnote`
 * - iCloud on the Mac: `<id> 2.fnote`
 * - Google Drive and OneDrive: `<id>(1).fnote`, `<id> (1).fnote`
 * - OneDrive's machine suffix: `<id>-MACBOOK.fnote` (for ULID, HMAC and derived ids)
 * - iCloud placeholders: `.<name>.fnote.icloud`
 * Ids never contain spaces or parentheses, so the id is everything before the first one.
 */
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
    let provider: ConflictProvider | null = null;
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
      if (/^[A-Za-z0-9_-]{1,64}$/.test(m[2]))
        return { id: m[1]!, copy: { provider: "onedrive", label: m[2] }, placeholder };
    }
  }
  if (isValidId(stem)) return { id: stem, copy: null, placeholder };
  return null;
}

/** Whether a path is in `notes/` and is a note file, copy or placeholder. */
export function parseNotePath(path: string): ParsedNoteName | null {
  if (!path.startsWith(`${NOTES_DIR}/`)) return null;
  const rest = path.slice(NOTES_DIR.length + 1);
  if (rest.includes("/")) return null;
  return parseNoteFileName(rest);
}
