// Per-device files (LOCAL_MODE_PLAN.md §3.1, §3.5): `index/catalog/<deviceId>.fcat` lets a new device show
// the whole library before note files arrive, and `devices/<deviceId>.json` says what each device has seen.
// Each has one writer, so they are plain JSON, replaced whole.
import { canonicalJson } from "@folevi/editor-schema";
import { fromUtf8, utf8 } from "./bytes";
import { isDeviceId, isHlc } from "./hlc";
import { isStub, latestStamp, type NoteLike } from "./noteFile";
import { isVersionVector, type VersionVector } from "./vv";

export const CATALOG_FORMAT = "folevi-catalog";
export const DEVICE_FORMAT = "folevi-device";

export interface CatalogEntry {
  /** The newest stamp of the note this entry describes. */
  c: string;
  title: string;
  icon: string | null;
  kind: string;
  folderId: string | null;
  parentDocumentId: string | null;
  /** Wall time of `c`. */
  updatedAt: number;
  trashed: boolean;
  /** Permanently deleted. */
  deleted?: boolean;
}

export interface CatalogFile {
  format: typeof CATALOG_FORMAT;
  v: 1;
  deviceId: string;
  writtenAt: number;
  notes: Record<string, CatalogEntry>;
}

/** The catalog entry a note file implies. */
export function catalogEntryFromNote(
  file: NoteLike,
  hlcMs: (c: string) => number,
): CatalogEntry | null {
  const c = latestStamp(file);
  if (!c) return null;
  if (isStub(file))
    return {
      c,
      title: "",
      icon: null,
      kind: "document",
      folderId: null,
      parentDocumentId: null,
      updatedAt: hlcMs(c),
      trashed: true,
      deleted: true,
    };
  const d = file.doc;
  return {
    c,
    title: d.title?.v ?? "",
    icon: d.icon?.v ?? null,
    kind: d.kind?.v ?? "document",
    folderId: d.folderId?.v ?? null,
    parentDocumentId: d.parentDocumentId?.v ?? null,
    updatedAt: hlcMs(c),
    trashed: d.trashedAt?.v != null,
  };
}

/** This device's catalog, from its replica. */
export function buildCatalog(
  deviceId: string,
  notes: Iterable<NoteLike>,
  writtenAt: number,
  hlcMs: (c: string) => number,
): CatalogFile {
  const entries: Record<string, CatalogEntry> = {};
  for (const n of [...notes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const e = catalogEntryFromNote(n, hlcMs);
    if (e) entries[n.id] = e;
  }
  return { format: CATALOG_FORMAT, v: 1, deviceId, writtenAt, notes: entries };
}

/**
 * What to show per note: the entry with the highest `c` across every device's catalog, unless the note file is
 * present with a `c` at least as new (the file always wins then). Permanently deleted notes are left out.
 */
export function resolveCatalog(
  catalogs: readonly CatalogFile[],
  noteFiles: ReadonlyMap<string, NoteLike> = new Map(),
  hlcMs: (c: string) => number = () => 0,
): Map<string, CatalogEntry & { source: "note" | "catalog" }> {
  const best = new Map<string, CatalogEntry & { source: "note" | "catalog" }>();
  for (const cat of catalogs) {
    for (const [id, e] of Object.entries(cat.notes)) {
      const cur = best.get(id);
      if (
        !cur ||
        e.c > cur.c ||
        (e.c === cur.c && canonicalJson(e) > canonicalJson({ ...cur, source: undefined }))
      )
        best.set(id, { ...e, source: "catalog" });
    }
  }
  for (const [id, file] of noteFiles) {
    const e = catalogEntryFromNote(file, hlcMs);
    if (!e) continue;
    const cur = best.get(id);
    if (!cur || e.c >= cur.c) best.set(id, { ...e, source: "note" });
  }
  for (const [id, e] of [...best]) if (e.deleted) best.delete(id);
  return best;
}

export function encodeCatalog(c: CatalogFile): Uint8Array {
  return utf8(canonicalJson(c));
}

export function decodeCatalog(bytes: Uint8Array): CatalogFile {
  const v = JSON.parse(fromUtf8(bytes)) as Partial<CatalogFile>;
  if (!v || v.format !== CATALOG_FORMAT || !isDeviceId(v.deviceId) || typeof v.notes !== "object")
    throw new Error("Not a Folevi catalog.");
  for (const e of Object.values(v.notes!))
    if (!isHlc(e.c)) throw new Error("Invalid catalog entry.");
  return v as CatalogFile;
}

/** `devices/<deviceId>.json`. */
export interface DeviceRecord {
  format: typeof DEVICE_FORMAT;
  v: 1;
  deviceId: string;
  name: string;
  platform: "mac" | "ios" | "android" | "web";
  appVersion: string;
  /** The newest note format this device understands. */
  formatVersion: number;
  lastSeen: number;
  /** Per writing device, the newest stamp this device has incorporated library-wide. */
  heads: VersionVector;
}

export function encodeDevice(d: DeviceRecord): Uint8Array {
  return utf8(canonicalJson(d));
}

export function decodeDevice(bytes: Uint8Array): DeviceRecord {
  const v = JSON.parse(fromUtf8(bytes)) as Partial<DeviceRecord>;
  if (
    !v ||
    v.format !== DEVICE_FORMAT ||
    !isDeviceId(v.deviceId) ||
    !isVersionVector(v.heads) ||
    typeof v.lastSeen !== "number"
  )
    throw new Error("Not a Folevi device record.");
  return v as DeviceRecord;
}

/** True when every device has incorporated `stamp` (its writer's head is at or past it). */
export function seenByAll(devices: readonly DeviceRecord[], stamp: string): boolean {
  const writer = stamp.slice(stamp.lastIndexOf("-") + 1);
  return devices.every((d) => (d.heads[writer] ?? "") >= stamp);
}
