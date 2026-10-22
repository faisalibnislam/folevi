// The bridge the bundled app shell's host adds as `window.foleviShell` (docs/LOCAL_MODE_PLAN.md §4.1): the Mac
// app's preload (apps/desktop) today, the iPhone and iPad app's bridge.js later. It is set before any page
// script runs, so the page can read the mode synchronously on its first render. On the website, and in a
// shell build opened in a plain browser, it's absent (lib/shell/index.ts falls back).
//
// It will absorb lib/desktop.ts and lib/nativeApp.ts; until the hosts implement it those stay as they are.
// Types only: nothing here runs.

/** Which host the shell runs in ("android": apps/android, docs/ANDROID_PLAN.md). */
export type ShellPlatform = "mac" | "ios" | "android";

/** Where the person's notes live: on their devices (local mode) or in their Folevi account. */
export type Backend = "local" | "account";

/** The mode the host read from its settings before the page loaded; "unset" on the very first launch. */
export type ShellMode = "unset" | Backend;

/**
 * Where a local library is kept: a folder on this device (iCloud Drive, one the person chose, or this device
 * only), or a built-in connection ("dropbox", "gdrive": Dropbox and Google Drive through their APIs, WP9b).
 */
export type LibraryKind = "icloud" | "folder" | "device" | "dropbox" | "gdrive";

export interface LibraryInfo {
  kind: LibraryKind;
  /** For people to read ("iCloud Drive › Folevi", "~/Dropbox/Notes"); never parsed. */
  displayPath: string;
  /** False when the place can't be used now (iCloud signed out, the folder gone). */
  available: boolean;
  encrypted: boolean;
  /** Encrypted and waiting for the passphrase. */
  locked: boolean;
  /**
   * False until `setup` has chosen a place (the other fields then describe nothing yet). Hosts that predate it
   * leave it out: absent means set up.
   */
  configured?: boolean;
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

/** Built-in sync through a provider's API (WP9b, the Mac first). Local mode only. */
export type CloudProvider = "dropbox" | "googleDrive";

export interface CloudStatus {
  /** The connections this build offers (a build without a provider's client id hides it). */
  available: CloudProvider[];
  provider: CloudProvider | null;
  /** "reconnect": the provider refused the sign-in (revoked or expired); show "Reconnect Dropbox". */
  state: "none" | "connecting" | "connected" | "offline" | "reconnect";
  /** The account's email, when the provider says. */
  account: string | null;
}

/** "Sync with Dropbox" and "Sync with Google Drive": status and sign-in only; the tokens stay native. */
export interface ShellCloud {
  status(): Promise<CloudStatus>;
  /** Opens the provider's sign-in in the browser; resolves once connected. Also reconnects. */
  connect(provider: CloudProvider): Promise<CloudStatus>;
  /** Stops a sign-in waiting for the browser. */
  cancel(): Promise<void>;
  /** Revokes and deletes the tokens and stops syncing; the library's copy on this device stays. */
  signOut(): Promise<CloudStatus>;
  /** The status now and on every change. Returns the unsubscribe function. */
  onStatus(cb: (status: CloudStatus) => void): () => void;
}

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
  /** Built-in Dropbox and Google Drive connections (absent on hosts without them). */
  cloud?: ShellCloud;
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

/** Where a local Foli AI request goes: Apple's model on this device, or one of the person's own keys. */
export type AiProviderId = "on-device" | "openai" | "anthropic" | "google";

/** The providers reached with the person's own key (each key is a SecretName, `ai.<provider>`). */
export type AiKeyProvider = Exclude<AiProviderId, "on-device">;

/**
 * Why Apple's on-device model can or can't run here (FoundationModels `SystemLanguageModel.default.availability`):
 * "available"; "notSupported" (this Mac can't run Apple Intelligence, or macOS is older than 26); "notEnabled"
 * (Apple Intelligence is off in System Settings); "notReady" (the model is still downloading); "unknown" (the
 * helper couldn't be reached, or this build has no on-device support).
 */
export type OnDeviceStatus = "available" | "notSupported" | "notEnabled" | "notReady" | "unknown";

/** What Foli AI can do on this device in local mode (Apple's models, or the person's own keys). */
export interface AiCaps {
  onDevice: boolean;
  /** Why `onDevice` is what it is (hosts that predate it leave it out). */
  onDeviceStatus?: OnDeviceStatus;
  /** Approximate context window of the on-device model, in tokens (input and output together). */
  onDeviceContext?: number;
  /** Which of the person's keys are stored (never the keys themselves). */
  keys: Partial<Record<SecretName, boolean>>;
}

export interface AiRequest {
  provider: AiProviderId;
  /** The provider's model id (ignored on the device). */
  model?: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  /** The answer is JSON (the provider's JSON mode where it has one; on the device, asked for in the prompt). */
  json?: boolean;
  /** A JSON schema the answer must follow, for structured features. */
  schema?: unknown;
}

export interface AiResult {
  text: string;
  stopReason: "end" | "length" | "cancelled" | "error";
  /** For people to read: the provider's reason, never the key. */
  error?: string;
  /** "auth": the key was refused; "rate": the provider asked to slow down; "context": the request was too long. */
  errorCode?: "auth" | "rate" | "context" | "network" | "unavailable" | "invalid";
}

export interface ShellAi {
  capabilities(): Promise<AiCaps>;
  /** Streams the answer: `onChunk` gets each new piece of text as it arrives; `done` has the whole text. */
  generate(req: AiRequest, onChunk: (text: string) => void): { done: Promise<AiResult>; cancel(): void };
  /** Checks a stored key with one tiny request (Settings > AI, "Test"). Hosts without it leave it out. */
  testKey?(provider: AiKeyProvider): Promise<{ ok: true } | { ok: false; error: string }>;
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

/**
 * OS notifications at a time (local reminders, WP14): the host keeps them across restarts. `schedule` with an
 * id already scheduled replaces it; one whose time has passed shows at once, and each id and time shows once.
 * Clicking one brings Folevi forward at `path`.
 */
export interface ShellNotify {
  schedule(n: { id: string; at: number; title: string; body: string; path: string }): Promise<void>;
  cancel(id: string): Promise<void>;
}

/** A subscribed calendar's text as the host fetched it (convex/lib/icsFetch.ts Download, same words). */
export type CalendarDownload =
  | { kind: "ok"; text: string; etag: string | null; lastModified: string | null }
  | { kind: "notModified" }
  | { kind: "error"; message: string };

export interface ShellHttp {
  /** Bookmark previews: the HTML of a page on a host that isn't Folevi's, or null. */
  preview(url: string): Promise<string | null>;
  /**
   * A subscribed calendar (local mode): fetched by the host, straight from the calendar's own site and never
   * through Folevi. Only public addresses that aren't Folevi's (https only on the Mac), every redirect checked again,
   * 10 seconds and 5 MB at most, no cookies. Conditional when an ETag or Last-Modified from last time is given.
   */
  calendar(url: string, previous?: { etag?: string | null; lastModified?: string | null }): Promise<CalendarDownload>;
}

/**
 * This device's end-to-end encryption keys, kept by the host (docs/E2EE_DESIGN.md §6.2): on the Mac in the
 * main process, private halves sealed with safeStorage. The page never sees a private key; it gets the public
 * halves, what a sealed box addressed to this device holds (the account master key, which it imports as
 * non-extractable keys and zeroes), and signatures. The Mac adds the same object as `foleviDesktop.e2ee` on
 * the website. Failures reject with `{ code: "unavailable" | "invalid_argument" | "cancelled" | "failed" }`.
 */
export interface ShellE2ee {
  /** Made on the first call and kept. */
  deviceKeys(): Promise<{ deviceId: string; x25519Pub: Uint8Array; ed25519Pub: Uint8Array }>;
  /** FLS1 open with the device X25519 key; asks for Touch ID first when the person turned that on. */
  open(sealedBox: Uint8Array, context: string): Promise<Uint8Array>;
  /** FST1 signature (base64url) with the device Ed25519 key over a statement's canonical JSON body. */
  sign(kind: string, body: string): Promise<string>;
  /** Forgets the device keys (sign-out with "Forget this device", or the device was removed). */
  reset(): Promise<void>;
  /** "Ask for Touch ID to unlock encrypted notes" (Settings > Desktop app). Hosts without it leave it out. */
  settings?(): Promise<{ touchId: boolean; available: boolean }>;
  /** Turning it on or off asks for Touch ID too. */
  setTouchId?(on: boolean): Promise<{ touchId: boolean; available: boolean }>;
}

export interface FoleviShell {
  platform: ShellPlatform;
  /** The app's version, for minShellVersion checks. */
  shellVersion: string;
  /** The device's own name (the Mac's name in System Settings), for the library's device list. */
  deviceName?: string;
  /** On iOS: "iPhone" or "iPad", for words like "this iPhone" (lib/shell/words.ts). */
  deviceFamily?: "iPhone" | "iPad";
  initialMode: ShellMode;
  setMode(m: Backend): Promise<void>;
  library: ShellLibrary;
  secrets: ShellSecrets;
  auth: ShellAuth;
  ai: ShellAi;
  lock: ShellLock;
  notify: ShellNotify;
  files: { save(name: string, bytes: Uint8Array): Promise<boolean> };
  /** Fetches from hosts that aren't Folevi's: bookmark previews, subscribed calendars. */
  http: ShellHttp;
  /** End-to-end encryption device keys (absent on hosts that predate it). */
  e2ee?: ShellE2ee;
}

declare global {
  interface Window {
    foleviShell?: FoleviShell;
  }
}
