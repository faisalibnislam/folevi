// Attachments (LOCAL_MODE_PLAN.md §3.8): content addressed and written once at `files/<aa>/<sha256>`.
// Garbage collection is the risky part, so a file goes only when nothing references it, it has been
// unreferenced for 30 days, and every known device has seen past the moment it became unreferenced.
import { seenByAll, type DeviceRecord } from "./catalog";
import { hlcMs } from "./hlc";
import type { VersionFile } from "./history";
import { attachmentPath } from "./layout";
import { isStub, type NoteLike } from "./noteFile";
import { sha256Hex } from "./sha256";

export const ATTACHMENT_GC_DELAY_MS = 30 * 24 * 3_600_000;

/** The sha256 and library path of attachment bytes. */
export function attachmentAddress(bytes: Uint8Array): { sha256: string; path: string } {
  const sha256 = sha256Hex(bytes);
  return { sha256, path: attachmentPath(sha256) };
}

/** Every attachment a note references (live and trashed notes alike; stubs reference nothing). */
export function noteAttachmentRefs(file: NoteLike): Set<string> {
  const out = new Set<string>();
  if (isStub(file)) return out;
  for (const f of Object.values(file.files)) out.add(f.sha256);
  return out;
}

/** Attachments a retained history version references. */
export function versionAttachmentRefs(version: VersionFile): Set<string> {
  const out = new Set<string>();
  if (version.note) for (const f of Object.values(version.note.files)) out.add(f.sha256);
  return out;
}

export interface GcCandidate {
  sha256: string;
  /** The stamp at which this device saw the file become unreferenced (null while referenced). */
  unreferencedAt: string | null;
}

/**
 * Whether an attachment may be deleted: (a) nothing references it now, (b) it has been unreferenced for at
 * least 30 days, and (c) every known device has seen past the moment it became unreferenced.
 */
export function gcEligible(
  candidate: GcCandidate,
  referenced: ReadonlySet<string>,
  devices: readonly DeviceRecord[],
  now: number,
): boolean {
  if (referenced.has(candidate.sha256)) return false;
  if (!candidate.unreferencedAt) return false;
  if (now - hlcMs(candidate.unreferencedAt) < ATTACHMENT_GC_DELAY_MS) return false;
  if (devices.length === 0) return false;
  return seenByAll(devices, candidate.unreferencedAt);
}

/**
 * Updates the "unreferenced since" map after a scan: referenced files are cleared, newly unreferenced ones get
 * `stamp`, and ones already unreferenced keep their first stamp.
 */
export function trackUnreferenced(
  present: Iterable<string>,
  referenced: ReadonlySet<string>,
  previous: ReadonlyMap<string, string>,
  stamp: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const sha of present) {
    if (referenced.has(sha)) continue;
    out.set(sha, previous.get(sha) ?? stamp);
  }
  return out;
}

/** Referenced attachments missing from the folder; a device that has the bytes cached rewrites them. */
export function missingAttachments(
  referenced: ReadonlySet<string>,
  present: ReadonlySet<string>,
): string[] {
  return [...referenced].filter((sha) => !present.has(sha)).sort();
}
