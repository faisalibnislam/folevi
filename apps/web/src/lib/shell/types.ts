// The bridge the bundled app shell's host adds as `window.foleviShell` (docs/LOCAL_MODE_PLAN.md §4.1): the Mac
// app's preload (apps/desktop) today, the iPhone and iPad app's bridge.js later. It is set before any page
// script runs, so the page can read the mode synchronously on its first render. On the website, and in a
// shell build opened in a plain browser, it's absent (lib/shell/index.ts falls back).
//
// It will absorb lib/desktop.ts and lib/nativeApp.ts; until the hosts implement it those stay as they are.
// Types only: nothing here runs.

/** Which host the shell runs in. */
export type ShellPlatform = "mac" | "ios";

/** Where the person's notes live: on their devices (local mode) or in their Folevi account. */
export type Backend = "local" | "account";

/** The mode the host read from its settings before the page loaded; "unset" on the very first launch. */
export type ShellMode = "unset" | Backend;

/** Where a local library is kept. */
export type LibraryKind = "icloud" | "folder" | "device";

export interface LibraryInfo {
  kind: LibraryKind;
  /** For people to read ("iCloud Drive › Folevi", "~/Dropbox/Notes"); never parsed. */
  displayPath: string;
  /** False when the place can't be used now (iCloud signed out, the folder gone). */
  available: boolean;
  encrypted: boolean;
  /** Encrypted and waiting for the passphrase. */
  locked: boolean;
}

export interface LibraryEntry {
  /** Relative to the library, forward slashes. */
  path: string;
  size: number;
  mtimeMs: number;
  etag: string;
  /** False for a cloud placeholder that isn't on this device yet. */
  downloaded: boolean;
  /** The file provider holds conflicting versions of it. */
  hasConflicts: boolean;
}

export type LibraryChange = { path: string; kind: "changed" | "removed" | "downloaded" | "uploaded" };

/**
 * The library's files. Every path is relative to the library and uses forward slashes; the host refuses
 * `..`, a leading slash and control characters. Bytes cross as Uint8Array (base64 in chunks on iOS).
 */
export interface ShellLibrary {
  /** The folder kind opens the picker; null when the person cancels. */
  setup(o: { kind: LibraryKind }): Promise<LibraryInfo | null>;
  info(): Promise<LibraryInfo>;
  list(dir: string): Promise<LibraryEntry[]>;
  read(path: string): Promise<{ bytes: Uint8Array; etag: string } | { notDownloaded: true }>;
  /** `ifMatch: null` means "only if it doesn't exist yet". */
  write(path: string, bytes: Uint8Array, o: { ifMatch?: string | null }): Promise<{ etag: string } | { mismatch: true; etag: string }>;
  remove(path: string, o?: { ifMatch?: string }): Promise<void>;
  conflictVersions(path: string): Promise<{ id: string; bytes: Uint8Array }[]>;
  resolveConflicts(path: string, ids: string[]): Promise<void>;
  startDownload(paths: string[]): Promise<void>;
  /** Returns the unsubscribe function. */
  watch(cb: (changes: LibraryChange[]) => void): () => void;
  journal: { append(r: Uint8Array): Promise<void>; readAll(): Promise<Uint8Array[]>; truncate(n: number): Promise<void> };
  unlock(passphrase: string): Promise<boolean>;
  setPassphrase(p: string | null): Promise<void>;
  changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean>;
  /** app://folevi/_files/<sha> on the Mac, folevi-file://lib/<sha> on iOS. */
  fileUrl(sha256: string, mime: string): string;
  move(to: { kind: LibraryKind }): Promise<LibraryInfo>;
}

/** Secrets the page may store but never read back (the Keychain, or safeStorage on the Mac). */
export type SecretName = "ai.openai" | "ai.anthropic" | "ai.google";

export interface ShellSecrets {
  has(name: SecretName): Promise<boolean>;
  set(name: SecretName, value: string): Promise<void>;
  delete(name: SecretName): Promise<void>;
}

/** Signed-in mode: the bearer token lives in native code and never reaches the page (§1). */
export interface ShellAuth {
  signIn(): Promise<boolean>;
  signOut(): Promise<void>;
  /** Only `/api/auth/*` on the service; native adds the bearer (and `Origin` on POSTs). */
  fetch(path: string, init: RequestInit): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /** A short-lived Convex JWT, or null when signed out. */
  convexToken(): Promise<string | null>;
}

/** What Foli AI can do on this device in local mode (Apple's models, or the person's own keys). */
export interface AiCaps {
  onDevice: boolean;
  /** Approximate context window of the on-device model, in tokens. */
  onDeviceContext?: number;
  keys: Partial<Record<SecretName, boolean>>;
}

export interface AiRequest {
  provider: "on-device" | "openai" | "anthropic" | "google";
  model?: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  /** A JSON schema the answer must follow, for structured features. */
  schema?: unknown;
}

export interface AiResult {
  text: string;
  stopReason: "end" | "length" | "cancelled" | "error";
  error?: string;
}

export interface ShellAi {
  capabilities(): Promise<AiCaps>;
  generate(req: AiRequest, onChunk: (text: string) => void): { done: Promise<AiResult>; cancel(): void };
}

/** The Face ID or Touch ID lock. */
export interface ShellLockSettings {
  lock: boolean;
  /** Seconds in the background before it asks again. */
  lockAfter: number;
  method: "faceID" | "touchID" | "opticID" | "passcode" | "none";
}

export interface ShellLock {
  getSettings(): Promise<ShellLockSettings>;
  setSettings(patch: Partial<Pick<ShellLockSettings, "lock" | "lockAfter">>): Promise<ShellLockSettings>;
}

export interface ShellNotify {
  schedule(n: { id: string; at: number; title: string; body: string; path: string }): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface FoleviShell {
  platform: ShellPlatform;
  /** The app's version, for minShellVersion checks. */
  shellVersion: string;
  initialMode: ShellMode;
  setMode(m: Backend): Promise<void>;
  library: ShellLibrary;
  secrets: ShellSecrets;
  auth: ShellAuth;
  ai: ShellAi;
  lock: ShellLock;
  notify: ShellNotify;
  files: { save(name: string, bytes: Uint8Array): Promise<boolean> };
  /** Bookmark previews: the HTML of a page on a host that isn't Folevi's, or null. */
  http: { preview(url: string): Promise<string | null> };
}

declare global {
  interface Window {
    foleviShell?: FoleviShell;
  }
}
