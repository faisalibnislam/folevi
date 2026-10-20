// The file layer (LOCAL_MODE_PLAN.md §3.6, §4.1). `LocalFs` is the bridge contract's library file API;
// natives implement it (atomic writes, etags, conflict versions, transparent encryption). Writes are always
// read-merge-write, and a file that can't be read and merged is never overwritten.

export interface LocalFsEntry {
  path: string;
  size: number;
  mtimeMs: number;
  /** Changes whenever the content does (mtime+size+inode, or the NSFileVersion). */
  etag: string;
  /** False for cloud placeholders (iCloud dataless files, `.name.icloud`). */
  downloaded: boolean;
  /** iOS: NSFileVersion has unresolved conflict versions for this file. */
  hasConflicts: boolean;
}

export type ReadResult = { bytes: Uint8Array; etag: string } | { notDownloaded: true };
export type WriteResult = { etag: string } | { mismatch: true; etag: string };

/**
 * The library's files, as `shell.library` exposes them (§4.1). Paths are relative to the library root and use
 * forward slashes (see `isValidLibraryPath`).
 *
 * - `list(dir)`: every file under `dir`, recursively ("" lists the whole library).
 * - `read(path)`: the bytes and etag, or `{ notDownloaded: true }` for a placeholder. A missing file rejects
 *   with `LocalFsError` code "not_found"; a file that can't be decrypted or read rejects with "unreadable".
 * - `write(path, bytes, { ifMatch })`: atomic replace. `ifMatch: undefined` writes unconditionally; `null` creates
 *   only if the file doesn't exist; a string writes only if the current etag matches. Otherwise it resolves
 *   `{ mismatch: true, etag }` with the current etag ("" when missing).
 * - `remove(path, { ifMatch })`: removing a missing file is a no-op; a mismatched etag rejects with "mismatch".
 * - `conflictVersions(path)` / `resolveConflicts(path, ids)`: NSFileVersion-style conflict versions (empty
 *   elsewhere), resolved only after they have been merged into a successful write.
 */
export interface LocalFs {
  list(dir: string): Promise<LocalFsEntry[]>;
  read(path: string): Promise<ReadResult>;
  write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult>;
  remove(path: string, o?: { ifMatch?: string }): Promise<void>;
  conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]>;
  resolveConflicts(path: string, ids: string[]): Promise<void>;
}

export type LocalFsErrorCode = "not_found" | "unreadable" | "mismatch" | "invalid_path" | "io";

export class LocalFsError extends Error {
  override name = "LocalFsError";
  constructor(
    readonly code: LocalFsErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof LocalFsError
    ? error.code === "not_found"
    : (error as { code?: unknown } | null)?.code === "not_found";
}

/** How to turn a file into a value and back, and how two values merge. */
export interface Codec<T> {
  /** Throws on anything short, damaged, newer or invalid. */
  decode(bytes: Uint8Array): T;
  encode(value: T): Uint8Array;
  merge(local: T, current: T): T;
}

export type ReadMergeWriteResult<T> =
  | { status: "written"; value: T; etag: string; attempts: number }
  | { status: "unchanged"; value: T; etag: string; attempts: number }
  /** The current file couldn't be read or parsed: nothing was written. Retry later, then show it in Library health. */
  | { status: "unreadable"; error: unknown; etag: string | null }
  | { status: "notDownloaded" }
  /** Another writer kept winning the race; nothing was lost, try again later. */
  | { status: "busy"; value: T; attempts: number };

export interface ReadMergeWriteOptions<T> {
  maxAttempts?: number;
  /** Waits before attempt `n` (n ≥ 2). Defaults to no wait. */
  backoff?: (attempt: number) => Promise<void>;
  /** Runs with the merged value before it is committed (also when the file already equals it). */
  beforeCommit?: (merged: T) => Promise<void>;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Read the current file, merge `local` into it, write it back only if the etag still matches; on a mismatch,
 * read and merge again. Never writes over a file that couldn't be read and decoded.
 */
export async function readMergeWrite<T>(
  fs: LocalFs,
  path: string,
  codec: Codec<T>,
  local: T,
  options: ReadMergeWriteOptions<T> = {},
): Promise<ReadMergeWriteResult<T>> {
  const maxAttempts = options.maxAttempts ?? 5;
  let value = local;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await options.backoff?.(attempt);
    let current: { bytes: Uint8Array; etag: string } | null = null;
    try {
      const r = await fs.read(path);
      if ("notDownloaded" in r) return { status: "notDownloaded" };
      current = r;
    } catch (error) {
      if (!isNotFound(error)) return { status: "unreadable", error, etag: null };
    }
    let merged = local;
    if (current) {
      let decoded: T;
      try {
        decoded = codec.decode(current.bytes);
      } catch (error) {
        return { status: "unreadable", error, etag: current.etag };
      }
      merged = codec.merge(local, decoded);
    }
    value = merged;
    await options.beforeCommit?.(merged);
    const bytes = codec.encode(merged);
    if (current && sameBytes(bytes, current.bytes))
      return { status: "unchanged", value: merged, etag: current.etag, attempts: attempt };
    const w = await fs.write(path, bytes, { ifMatch: current ? current.etag : null });
    if ("etag" in w && !("mismatch" in w))
      return { status: "written", value: merged, etag: w.etag, attempts: attempt };
  }
  return { status: "busy", value, attempts: maxAttempts };
}

/** Writes an immutable file (history, attachments) once. An existing file is left alone. */
export async function writeOnce(
  fs: LocalFs,
  path: string,
  bytes: Uint8Array,
): Promise<"written" | "exists"> {
  const w = await fs.write(path, bytes, { ifMatch: null });
  return "mismatch" in w ? "exists" : "written";
}

/** Reads a file, or null when it is missing. Placeholders and unreadable files are reported, not thrown. */
export async function readIfPresent(
  fs: LocalFs,
  path: string,
): Promise<
  { bytes: Uint8Array; etag: string } | { notDownloaded: true } | { unreadable: unknown } | null
> {
  try {
    return await fs.read(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    return { unreadable: error };
  }
}
