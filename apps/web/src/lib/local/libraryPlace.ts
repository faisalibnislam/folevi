// Where a local library lives, in words, and what the first-launch screens (components/app/LibrarySetup.tsx)
// leave for LocalGate: whether the place chosen already held a library (join it, no welcome notes) or not
// (a new library, with them). Small and free of the local backend, so the website bundle doesn't pull it in.
import type { CloudProvider, LibraryKind, ShellLibrary } from "@/lib/shell/types";
import { deviceWords } from "@/lib/shell/words";

/** The kind's name as Settings and the setup screen say it. */
export const PLACE_NAMES: Record<LibraryKind, string> = {
  icloud: "iCloud Drive",
  dropbox: "Dropbox",
  gdrive: "Google Drive",
  folder: "A folder you chose",
  device: "This Mac only",
};

/** The kind's name for this device ("This iPhone only" in the iOS app). */
export function placeName(kind: LibraryKind): string {
  return kind === "device" ? `${deviceWords().Here} only` : PLACE_NAMES[kind];
}

/** The built-in connection behind a kind, if it is one. */
export function providerOf(kind: LibraryKind): CloudProvider | null {
  return kind === "dropbox" ? "dropbox" : kind === "gdrive" ? "googleDrive" : null;
}

export function kindOf(provider: CloudProvider): LibraryKind {
  return provider === "dropbox" ? "dropbox" : "gdrive";
}

export function providerName(provider: CloudProvider): string {
  return provider === "dropbox" ? "Dropbox" : "Google Drive";
}

/** What the placeholder of a note still on its way says ("Downloading from iCloud…"). */
export function downloadingFrom(kind: LibraryKind | null | undefined): string {
  if (kind === "icloud") return "Downloading from iCloud…";
  if (kind === "dropbox") return "Downloading from Dropbox…";
  if (kind === "gdrive") return "Downloading from Google Drive…";
  return "Downloading…";
}

/**
 * True when the library at the place just set up already holds notes or other devices: someone is joining a
 * library made elsewhere. Called right after `library.setup`, before this device writes anything there. An
 * encrypted library that's still locked can't be listed, and counts as one that exists.
 */
export async function holdsLibrary(library: Pick<ShellLibrary, "list" | "info">): Promise<boolean> {
  try {
    const info = await library.info();
    if (info.encrypted) return true;
  } catch {
    // Listing below decides.
  }
  try {
    const [notes, devices] = await Promise.all([library.list("notes"), library.list("devices")]);
    return notes.some((e) => e.path.endsWith(".fnote")) || devices.length > 0;
  } catch (e) {
    return (e as { code?: unknown } | null)?.code === "locked";
  }
}

export type SetupIntent = "join" | "new";

const INTENT_KEY = "folevi:local-setup-intent";

/** What LibrarySetup found, for LocalGate after the app reloads into local mode. */
export function rememberSetupIntent(intent: SetupIntent): void {
  try {
    localStorage.setItem(INTENT_KEY, intent);
  } catch {
    // Without storage LocalGate looks at the folder itself.
  }
}

export function setupIntent(): SetupIntent | null {
  try {
    const v = localStorage.getItem(INTENT_KEY);
    return v === "join" || v === "new" ? v : null;
  } catch {
    return null;
  }
}

export function clearSetupIntent(): void {
  try {
    localStorage.removeItem(INTENT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** A library error's code and reason from the host (`{ code, message, path }` objects over the bridge). */
export function hostError(e: unknown): { code: string; reason: string | null; message: string } {
  const o = (e ?? {}) as { code?: unknown; path?: unknown; message?: unknown };
  return {
    code: typeof o.code === "string" ? o.code : "",
    reason: typeof o.path === "string" ? o.path : null,
    message: typeof o.message === "string" ? o.message.replace(/^FakeShell: /, "") : String(e),
  };
}

/** Plain words for a place that can't be used, with what to do about it. */
export function placeProblem(kind: LibraryKind, e: unknown): string {
  const { code, reason, message } = hostError(e);
  const w = deviceWords();
  if (w.ios && kind === "icloud" && reason === "drive_off") return `iCloud Drive is turned off for Folevi. In the Settings app, tap your name, then iCloud, then turn on iCloud Drive and Folevi. Then try again.`;
  if (w.ios && kind === "icloud" && reason === "signed_out") return `${w.Here} isn't signed in to iCloud, or iCloud Drive is off. Sign in in the Settings app and turn on iCloud Drive, then try again.`;
  if (w.ios && reason === "not_writable") return "Folevi can't write to that place. Choose another folder in the Files app.";
  if (w.ios && reason === "unsupported") return `That place isn't available on ${w.here} yet.`;
  if (kind === "icloud" && reason === "drive_off") return "iCloud Drive is turned off on this Mac. Turn it on in System Settings, under your name, then iCloud, then iCloud Drive. Then try again.";
  if (kind === "icloud" && reason === "signed_out") return "This Mac isn't signed in to iCloud. Sign in in System Settings, turn on iCloud Drive, then try again.";
  if (reason === "not_writable") return "Folevi can't write to that place. Choose another folder, or check its permissions in Finder.";
  if (code === "target_has_library") return "That place already holds a different Folevi library. Choose an empty folder.";
  if (code === "not_downloaded") return "Some files are still downloading. Folevi finishes moving the library once they arrive.";
  if (code === "one_connection") return message;
  return message || "That didn't work. Try again.";
}
