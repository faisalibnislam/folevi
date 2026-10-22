// Where a local library lives on the Mac (docs/LOCAL_MODE_PLAN.md §3.1, owner decisions):
// - "This device only": ~/Documents/Folevi Library.
// - "Sync with iCloud": Folevi's own iCloud container, iCloud.com.folevi, its Documents folder
//   (~/Library/Mobile Documents/iCloud~com~folevi/Documents, "Folevi" in iCloud Drive), the same files the
//   iPhone and iPad app keeps its library in (apps/ios Native/Shell/LibraryService.swift). The container's folder
//   is there once any of the person's devices has used it (the iOS app makes it); the Mac app isn't sandboxed, so
//   it reads and writes it like any iCloud Drive folder (coordinated, through folevi-files). Until it's there,
//   an ordinary iCloud Drive folder, ~/Library/Mobile Documents/com~apple~CloudDocs/Folevi, as before;
//   Settings > Library's "Move library" > Sync with iCloud moves such a library into the container.
// - "Choose a folder": any folder (Dropbox, Google Drive, OneDrive, a USB disk), remembered in library.json.
// Folders in iCloud Drive and in ~/Library/CloudStorage (File Provider apps) get coordinated I/O through
// folevi-files; everything else is a plain folder.
import { constants } from "node:fs";
import { access, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { TMP_DIR } from "./paths";
import type { LibraryKind } from "./types";

export const DEVICE_FOLDER = "Folevi Library";
export const ICLOUD_FOLDER = "Folevi";
/** The iCloud container iCloud.com.folevi as it appears in ~/Library/Mobile Documents. */
export const ICLOUD_CONTAINER = "iCloud~com~folevi";

/** The container's Documents folder: the library "Sync with iCloud" shares with the iPhone and iPad. */
export function iCloudContainerDocuments(home: string): string {
  return join(home, "Library", "Mobile Documents", ICLOUD_CONTAINER, "Documents");
}

export function iCloudDriveRoot(home: string): string {
  return join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
}

/** Where "This device only" and "Sync with iCloud" keep the library. ("folder" has no default.) */
export function defaultLocation(kind: Exclude<LibraryKind, "folder">, home: string): string {
  return kind === "device" ? join(home, "Documents", DEVICE_FOLDER) : join(iCloudDriveRoot(home), ICLOUD_FOLDER);
}

export type Provider = "icloud" | "fileprovider" | "plain";

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);

/** Which kind of folder a (real) path is in: iCloud Drive, a File Provider app's folder, or neither. */
export function providerFor(path: string, home: string): Provider {
  if (inside(path, join(home, "Library", "Mobile Documents"))) return "icloud";
  if (inside(path, join(home, "Library", "CloudStorage"))) return "fileprovider";
  return "plain";
}

/** The provider for a folder that may not exist yet (its nearest existing parent decides, links resolved). */
export async function providerOf(path: string, home: string): Promise<Provider> {
  let p = path;
  for (;;) {
    try {
      return providerFor(await realpath(p), await realpath(home).catch(() => home));
    } catch {
      const up = join(p, "..");
      if (up === p) return providerFor(path, home);
      p = up;
    }
  }
}

const CLOUD_NAMES: [RegExp, string][] = [
  [/^Dropbox(-.*)?$/, "Dropbox"],
  [/^GoogleDrive-.+$/, "Google Drive"],
  [/^OneDrive(-.*)?$/, "OneDrive"],
  [/^Box(-.*)?$/, "Box"],
];

/** For people to read: "iCloud Drive › Folevi", "Dropbox › Notes", "~/Documents/Folevi Library". */
export function displayPath(path: string, home: string): string {
  const drive = iCloudDriveRoot(home);
  if (inside(path, drive)) return ["iCloud Drive", ...relative(drive, path).split(sep).filter(Boolean)].join(" › ");
  const container = iCloudContainerDocuments(home);
  if (inside(path, container)) return ["iCloud Drive", ICLOUD_FOLDER, ...relative(container, path).split(sep).filter(Boolean)].join(" › ");
  const cloud = join(home, "Library", "CloudStorage");
  if (inside(path, cloud)) {
    const [first, ...rest] = relative(cloud, path).split(sep).filter(Boolean);
    const name = CLOUD_NAMES.find(([re]) => re.test(first ?? ""))?.[1] ?? first ?? "Cloud storage";
    return [name, ...rest].join(" › ");
  }
  if (inside(path, home)) return `~/${relative(home, path)}`.replace(/\/$/, "");
  return path;
}

/** Where "Sync with iCloud" goes: the container when it's on this Mac, else the iCloud Drive folder. */
export async function iCloudLocation(home: string): Promise<string> {
  return (await isFolder(join(home, "Library", "Mobile Documents", ICLOUD_CONTAINER))) ? iCloudContainerDocuments(home) : defaultLocation("icloud", home);
}

/** Whether Folevi can write in a folder: it exists (or can be made) and a probe file goes in and out. */
export async function probeWritable(dir: string): Promise<boolean> {
  try {
    await mkdir(join(dir, TMP_DIR), { recursive: true });
    const probe = join(dir, TMP_DIR, `probe-${process.pid}-${Date.now()}`);
    const fh = await open(probe, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    await fh.close();
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

export async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export type ICloudState = { available: true } | { available: false; reason: "drive_off" | "signed_out" | "not_writable" };

/**
 * Whether "Sync with iCloud" can be used: iCloud Drive's folder exists (it's only there while iCloud Drive is
 * on), this Mac is signed in (asked of folevi-files when it's available), and the Folevi folder is writable.
 */
export async function checkICloud(home: string, o: { signedIn?: () => Promise<boolean | null>; probe?: boolean } = {}): Promise<ICloudState> {
  const drive = iCloudDriveRoot(home);
  if (!(await isFolder(drive))) return { available: false, reason: "drive_off" };
  const signedIn = o.signedIn ? await o.signedIn().catch(() => null) : null;
  if (signedIn === false) return { available: false, reason: "signed_out" };
  try {
    await access(drive, constants.W_OK);
  } catch {
    return { available: false, reason: "not_writable" };
  }
  if (o.probe !== false && !(await probeWritable(await iCloudLocation(home)))) return { available: false, reason: "not_writable" };
  return { available: true };
}
