// Shared shapes for the built-in Dropbox and Google Drive connections (docs/LOCAL_MODE_PLAN.md WP9b).
//
// packages/cloud-folders is platform neutral: `fetch`-style requests, WebCrypto and plain data only. The native
// apps run it in their bridges (apps/ios/bridge for iPhone, iPad and Mac; apps/android/bridge), where every
// request goes through the app's own code, which adds the provider's token. Either way the tokens never reach
// the page.
//
// `LocalFs` below mirrors packages/local-store/src/io.ts (the bridge contract's file API). This package
// imports nothing (the bridges bundle it on their own), so the interface is repeated here; the contract tests run these classes under local-store's own NoteReplica, read-merge-write
// and EncryptedFs, which would fail on any drift.

export interface LocalFsEntry {
  path: string;
  size: number;
  mtimeMs: number;
  etag: string;
  downloaded: boolean;
  hasConflicts: boolean;
}

export type ReadResult = { bytes: Uint8Array; etag: string } | { notDownloaded: true };
export type WriteResult = { etag: string } | { mismatch: true; etag: string };

export interface LocalFs {
  list(dir: string): Promise<LocalFsEntry[]>;
  read(path: string): Promise<ReadResult>;
  write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<WriteResult>;
  remove(path: string, o?: { ifMatch?: string }): Promise<void>;
  conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]>;
  resolveConflicts(path: string, ids: string[]): Promise<void>;
}

export type LocalFsErrorCode = "not_found" | "unreadable" | "mismatch" | "invalid_path" | "io";

/** Same shape as local-store's LocalFsError: `isNotFound` there reads `code`. */
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

export type CloudProvider = "dropbox" | "googleDrive";

export const PROVIDER_NAMES: Record<CloudProvider, string> = {
  dropbox: "Dropbox",
  googleDrive: "Google Drive",
};

/**
 * Why a request to the provider failed, beyond a plain file error:
 * - "offline": no network (or the provider can't be reached). Nothing changed; try again later. Edits wait in
 *   the journal meanwhile.
 * - "reconnect": the sign-in was revoked or expired for good. The person must connect again.
 * - "busy": the provider kept answering "too many requests" or a server error after every retry.
 * - "quota": the person's Dropbox or Drive is full.
 * - "protocol": an answer Folevi doesn't understand.
 */
export type CloudErrorKind = "offline" | "reconnect" | "busy" | "quota" | "protocol";

/**
 * A provider failure. It is a LocalFsError with code "io", so local-store's flows treat it as "try again
 * later" (never as a missing or damaged file); `kind` says which.
 */
export class CloudError extends LocalFsError {
  override name = "CloudError";
  constructor(
    readonly kind: CloudErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super("io", message);
  }
}

export function isCloudError(error: unknown, kind?: CloudErrorKind): error is CloudError {
  return error instanceof CloudError && (kind === undefined || error.kind === kind);
}

/**
 * A provider's API with the person's sign-in added (oauth.ts AuthedHttp on the Mac; on Android the app's
 * Kotlin side adds the token, refreshing it once after a 401). A second refusal is CloudError "reconnect".
 */
export interface ApiHttp {
  send(url: string, init?: RequestInit): Promise<Response>;
}

/** The subset of `fetch` the providers use (Electron's `net.fetch`, Node's or a test's fake). */
export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same rules as local-store's isValidLibraryPath (the bridge rules in LOCAL_MODE_PLAN.md §4.1). */
export function isValidLibraryPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/") || path.endsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function checkPath(path: string): string {
  if (!isValidLibraryPath(path)) throw new LocalFsError("invalid_path", `Invalid library path: ${JSON.stringify(path)}`, path);
  return path;
}

export function checkDir(dir: string): string {
  return dir === "" ? dir : checkPath(dir);
}

export function underDir(path: string, dir: string): boolean {
  return dir === "" || path.startsWith(`${dir}/`);
}

export function notFound(path: string): LocalFsError {
  return new LocalFsError("not_found", `No such file: ${path}`, path);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A change the provider reported, for `shell.library.watch`. */
export type CloudChange = { path: string; kind: "changed" | "removed" };
