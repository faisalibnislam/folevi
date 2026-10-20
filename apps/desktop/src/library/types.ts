// The library's file API as the main process implements it (docs/LOCAL_MODE_PLAN.md §3.6, §4.1). These types
// mirror packages/local-store/src/io.ts (`LocalFs`) and apps/web/src/lib/shell/types.ts: the desktop app
// compiles on its own (plain tsc, no workspace packages at run time), so they're restated here, and the
// tests check the Node implementation against local-store's own contract and helpers.

export type LibraryKind = "icloud" | "folder" | "device";

export interface LibraryInfo {
  kind: LibraryKind;
  /** For people to read ("iCloud Drive › Folevi", "~/Dropbox/Notes"); never parsed. */
  displayPath: string;
  /** False when the place can't be used now (iCloud Drive off, the folder gone). */
  available: boolean;
  encrypted: boolean;
  /** Encrypted and waiting for the passphrase. */
  locked: boolean;
  /** False until `setup` has chosen a place (then the other fields describe nothing yet). */
  configured: boolean;
}

export interface LocalFsEntry {
  path: string;
  size: number;
  mtimeMs: number;
  /** mtime (ns) + size + inode: changes whenever the content does. */
  etag: string;
  /** False for cloud placeholders (iCloud dataless files, `.name.icloud`, File Provider files not on this Mac). */
  downloaded: boolean;
  /** NSFileVersion has unresolved conflict versions for this file (iCloud Drive and File Provider folders). */
  hasConflicts: boolean;
}

export type ReadResult = { bytes: Uint8Array; etag: string } | { notDownloaded: true };
export type WriteResult = { etag: string } | { mismatch: true; etag: string };

/** The bridge contract's file part (local-store's `LocalFs`). */
export interface LocalFs {
  list(dir: string): Promise<LocalFsEntry[]>;
  read(path: string): Promise<ReadResult>;
  write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult>;
  remove(path: string, o?: { ifMatch?: string }): Promise<void>;
  conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]>;
  resolveConflicts(path: string, ids: string[]): Promise<void>;
}

/** What the Mac adds to `LocalFs`: placeholders can be asked for. */
export interface LibraryFs extends LocalFs {
  startDownload(paths: string[]): Promise<void>;
}

export type LibraryErrorCode =
  // local-store's LocalFsErrorCode
  | "not_found"
  | "unreadable"
  | "mismatch"
  | "invalid_path"
  | "io"
  // the Mac's library service
  | "not_set_up"
  | "locked"
  | "unavailable"
  | "busy"
  | "invalid_argument"
  | "not_downloaded"
  | "target_has_library"
  | "wrong_passphrase";

/**
 * Errors with a code the page can act on. Over IPC they travel as plain `{ name, code, message, path }`
 * objects (contextBridge drops custom properties from Error objects), which local-store's `isNotFound`
 * already understands.
 */
export class LibraryError extends Error {
  override name = "LocalFsError";
  constructor(
    readonly code: LibraryErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

export function errorCode(error: unknown): LibraryErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? (code as LibraryErrorCode) : null;
}

/** A change the watcher reports to the page (shell.library.watch). */
export type LibraryChange = { path: string; kind: "changed" | "removed" | "downloaded" | "uploaded" };
