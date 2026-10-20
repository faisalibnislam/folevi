// Version history files (LOCAL_MODE_PLAN.md §3.8): `history/<docId>/<hlc>-<dev>-<reason>.fver`, immutable,
// gzip (fflate) of canonical JSON.
import { canonicalJson } from "@folevi/editor-schema";
import { gunzipSync, gzipSync } from "fflate";
import { fromUtf8, utf8 } from "./bytes";
import { hlcDevice, hlcMs, isDeviceId, isHlc } from "./hlc";
import type { NoteFile } from "./noteFile";
import { sha256Hex } from "./sha256";

export const VERSION_FORMAT = "folevi-version";
export const VERSION_SCHEMA = 1;

export type VersionReason = "auto" | "named" | "conflict" | "before-restore" | "imported";
export const VERSION_REASONS: readonly VersionReason[] = [
  "auto",
  "named",
  "conflict",
  "before-restore",
  "imported",
];

export interface VersionFile {
  format: typeof VERSION_FORMAT;
  v: typeof VERSION_SCHEMA;
  docId: string;
  reason: VersionReason;
  /** The version's clock (for a conflict, the losing stamp). */
  c: string;
  /** The device the version came from (for a conflict, the device whose edit lost). */
  by: string;
  /** A whole-note snapshot (auto, named, before-restore, imported). */
  note?: NoteFile;
  /**
   * For a conflict: what lost. `target` is a block id or `doc.<field>`. Only the loser is stored (the winner
   * depends on which states met), so every device writes the same bytes under the same name.
   */
  conflict?: { target: string; state: unknown };
}

export class VersionFileError extends Error {
  override name = "VersionFileError";
}

export interface VersionName {
  c: string;
  by: string;
  reason: VersionReason;
  /** Disambiguates conflict files that share a stamp. */
  tag?: string;
}

/**
 * `<hlc>-<dev>-<reason>.fver`, with `-<tag>` after the reason for conflicts. Device ids contain no dashes, so the
 * name splits unambiguously.
 */
export function versionFileName(v: VersionName): string {
  if (!isHlc(v.c) || !isDeviceId(v.by) || !VERSION_REASONS.includes(v.reason))
    throw new VersionFileError("Invalid version name parts.");
  return `${v.c}-${v.by}-${v.reason}${v.tag ? `-${v.tag}` : ""}.fver`;
}

export function parseVersionFileName(name: string): VersionName | null {
  const m =
    /^([0-9a-z]{9}-[0-9a-z]{4}-[A-Za-z0-9_]{1,64})-([A-Za-z0-9_]{1,64})-(auto|named|conflict|before-restore|imported)(?:-([0-9a-f]{12}))?\.fver$/.exec(
      name,
    );
  if (!m) return null;
  const out: VersionName = { c: m[1]!, by: m[2]!, reason: m[3] as VersionReason };
  if (m[4]) out.tag = m[4];
  return out;
}

/**
 * The history file for a concurrent change that lost. Derived from the target (block id or `doc.<field>`) and the
 * losing stamp only, so two devices that merge the same pair write the same file.
 */
export function conflictVersionName(target: string, loserC: string): string {
  return versionFileName({
    c: loserC,
    by: hlcDevice(loserC),
    reason: "conflict",
    tag: sha256Hex(`${target}\n${loserC}`).slice(0, 12),
  });
}

/** gzip of canonical JSON, with a zero mtime so the same version always gives the same bytes. */
export function encodeVersionFile(file: VersionFile): Uint8Array {
  return gzipSync(utf8(canonicalJson(file)), { level: 6, mtime: 0 });
}

export function decodeVersionFile(bytes: Uint8Array): VersionFile {
  let text: string;
  try {
    text = fromUtf8(gunzipSync(bytes));
  } catch {
    throw new VersionFileError("The version file isn't complete gzip (it may still be arriving).");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VersionFileError("The version file isn't valid JSON.");
  }
  const v = value as Partial<VersionFile>;
  if (!v || v.format !== VERSION_FORMAT) throw new VersionFileError("Not a Folevi version file.");
  if (typeof v.v !== "number" || v.v > VERSION_SCHEMA)
    throw new VersionFileError("Written by a newer Folevi.");
  if (
    typeof v.docId !== "string" ||
    !isHlc(v.c) ||
    !isDeviceId(v.by) ||
    !VERSION_REASONS.includes(v.reason as VersionReason)
  ) {
    throw new VersionFileError("The version file is missing fields.");
  }
  return v as VersionFile;
}

/** A whole-note snapshot version (auto on idle, named, before a restore, imported). */
export function snapshotVersion(
  note: NoteFile,
  reason: Exclude<VersionReason, "conflict">,
  c: string,
  deviceId: string,
): { name: string; file: VersionFile } {
  const snapshot = { ...note, notices: {} };
  delete snapshot.sum;
  const file: VersionFile = {
    format: VERSION_FORMAT,
    v: VERSION_SCHEMA,
    docId: note.id,
    reason,
    c,
    by: deviceId,
    note: snapshot,
  };
  return { name: versionFileName({ c, by: deviceId, reason }), file };
}

/** The conflict version for a loss, by its deterministic name. */
export function conflictVersion(loss: {
  docId: string;
  kind: "block" | "field";
  blockId?: string;
  field?: string;
  state: unknown;
  c: string;
  from: string;
}): {
  name: string;
  file: VersionFile;
} {
  const target = loss.kind === "block" ? loss.blockId! : `doc.${loss.field}`;
  const name = conflictVersionName(target, loss.c);
  // Only what the losing stamp determines: the content group of a block (position, collapsed and the merged
  // vector depend on which states met), or the register's value.
  let state: unknown;
  if (loss.kind === "block") {
    const b = loss.state as {
      type: string;
      schemaVersion: number;
      text: unknown[];
      props: Record<string, unknown>;
      deleted: unknown;
      by: string;
    };
    state = {
      type: b.type,
      schemaVersion: b.schemaVersion,
      text: b.text,
      props: b.props,
      deleted: b.deleted,
      by: b.by,
      c: loss.c,
    };
  } else {
    state = { v: (loss.state as { v: unknown }).v, c: loss.c };
  }
  return {
    name,
    file: {
      format: VERSION_FORMAT,
      v: VERSION_SCHEMA,
      docId: loss.docId,
      reason: "conflict",
      c: loss.c,
      by: loss.from,
      conflict: { target, state },
    },
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Which auto versions to delete. Only the device that made an auto version thins it: hourly for a day, daily for a
 * month, weekly after that, keeping the newest in each slot. Named and conflict versions, and any version with a
 * name in `versionNames`, are kept.
 */
export function thinVersions(
  names: readonly string[],
  deviceId: string,
  now: number,
  named: ReadonlySet<string> = new Set(),
): string[] {
  const slots = new Map<string, { name: string; c: string }>();
  const remove: string[] = [];
  for (const name of names) {
    const parsed = parseVersionFileName(name);
    if (!parsed || parsed.reason !== "auto" || parsed.by !== deviceId || named.has(name)) continue;
    const ms = hlcMs(parsed.c);
    const age = now - ms;
    const slot =
      age < DAY
        ? `h${Math.floor(ms / HOUR)}`
        : age < 30 * DAY
          ? `d${Math.floor(ms / DAY)}`
          : `w${Math.floor(ms / WEEK)}`;
    const current = slots.get(slot);
    if (!current) slots.set(slot, { name, c: parsed.c });
    else if (parsed.c > current.c) {
      remove.push(current.name);
      slots.set(slot, { name, c: parsed.c });
    } else remove.push(name);
  }
  return remove.sort();
}
