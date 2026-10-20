// Keeping a device's replica of the notes and the library folder in step (LOCAL_MODE_PLAN.md §3.6, §3.7):
// ingest changed files (and the copies providers make), flush with read-merge-write, write a history version
// for every concurrent change that lost, and re-assert local state until the file holds it (anti-entropy).
import { observeNote } from "./edits";
import type { HybridClock } from "./hlc";
import { conflictVersion, encodeVersionFile } from "./history";
import { readMergeWrite, writeOnce, type Codec, type LocalFs } from "./io";
import { historyPath, NOTES_DIR, notePath, parseNotePath } from "./layout";
import { mergeNoteFiles, type Loss } from "./merge";
import { decodeNoteFile, encodeNoteFile, noteSum, type NoteLike } from "./noteFile";

/** The codec for note files: canonical JSON with `sum`; decoding rejects anything short or damaged. */
export const noteCodec: Codec<NoteLike> = {
  decode: decodeNoteFile,
  encode: encodeNoteFile,
  merge: (local, current) => mergeNoteFiles(local, current).file,
};

/** Writes the history version for each loss (immutable files; an existing one is left alone). */
export async function writeLosses(fs: LocalFs, losses: readonly Loss[]): Promise<void> {
  for (const loss of losses) {
    const { name, file } = conflictVersion(loss);
    await writeOnce(fs, historyPath(loss.docId, name), encodeVersionFile(file));
  }
}

export type HealthIssue = {
  path: string;
  problem: "unreadable" | "downloading" | "busy";
  detail?: string;
};

export interface SyncReport {
  ingested: string[];
  written: string[];
  copiesMerged: string[];
  losses: Loss[];
  health: HealthIssue[];
}

export interface NoteReplicaOptions {
  /** Called for every loss as it is found (after its history file is written). */
  onLoss?: (loss: Loss) => void;
}

/**
 * A device's notes. `notes` is the replica (what the device shows); `sync()` exchanges it with the folder.
 * Hosts persist `notes` and `fileStates` (IndexedDB) and call `sync()` on changes, a timer, focus and wake.
 */
export class NoteReplica {
  readonly notes = new Map<string, NoteLike>();
  /** Path → etag last ingested. */
  readonly fileStates = new Map<string, string>();
  /** The checksum of what each note file held when last read or written. */
  private readonly fileContent = new Map<string, string>();
  /** Copies merged into the replica, deleted once the canonical file holds them: path → etag. */
  private readonly mergedCopies = new Map<string, { id: string; etag: string }>();
  /** Conflict versions merged into the replica, resolved once the file holds them. */
  private readonly mergedVersions = new Map<string, Set<string>>();
  private readonly allLosses = new Map<string, Loss>();

  constructor(
    readonly fs: LocalFs,
    readonly clock: HybridClock,
    private readonly options: NoteReplicaOptions = {},
  ) {}

  /** Every loss this replica has recorded, by notice id. */
  get losses(): Loss[] {
    return [...this.allLosses.values()];
  }

  /** Applies a local edit to the replica. */
  edit(id: string, fn: (note: NoteLike | undefined) => NoteLike): NoteLike {
    const next = fn(this.notes.get(id));
    if (next.id !== id) throw new Error("An edit can't change the note id.");
    this.notes.set(id, next);
    return next;
  }

  private async absorb(id: string, incoming: NoteLike, report: SyncReport): Promise<void> {
    observeNote(this.clock, incoming);
    const current = this.notes.get(id);
    if (!current) {
      this.notes.set(id, incoming);
      return;
    }
    const r = mergeNoteFiles(current, incoming);
    await this.recordLosses(r.losses, report);
    this.notes.set(id, r.file);
  }

  private async recordLosses(losses: readonly Loss[], report: SyncReport): Promise<void> {
    const fresh = losses.filter((l) => !this.allLosses.has(l.noticeId));
    if (!fresh.length) return;
    // History first: the loser must be safe before any note without it is written.
    await writeLosses(this.fs, fresh);
    for (const l of fresh) {
      this.allLosses.set(l.noticeId, l);
      report.losses.push(l);
      this.options.onLoss?.(l);
    }
  }

  /** Reads changed note files and copies into the replica. */
  async ingest(report: SyncReport = emptyReport()): Promise<SyncReport> {
    const entries = await this.fs.list(NOTES_DIR);
    for (const entry of entries) {
      const parsed = parseNotePath(entry.path);
      if (!parsed) continue;
      if (!entry.downloaded || parsed.placeholder) {
        report.health.push({ path: entry.path, problem: "downloading" });
        continue;
      }
      const changed = this.fileStates.get(entry.path) !== entry.etag;
      if (changed) {
        let file: NoteLike;
        try {
          const r = await this.fs.read(entry.path);
          if ("notDownloaded" in r) {
            report.health.push({ path: entry.path, problem: "downloading" });
            continue;
          }
          file = decodeNoteFile(r.bytes);
          // Trust the id inside the file over the name (a provider may have renamed it).
          await this.absorb(file.id, file, report);
          this.fileStates.set(entry.path, r.etag);
          if (parsed.copy || file.id !== parsed.id)
            this.mergedCopies.set(entry.path, { id: file.id, etag: r.etag });
          else this.fileContent.set(file.id, noteSum(file));
          report.ingested.push(entry.path);
        } catch (error) {
          report.health.push({
            path: entry.path,
            problem: "unreadable",
            detail: (error as Error).message,
          });
          continue;
        }
      }
      if (entry.hasConflicts && !parsed.copy) {
        let versions: { id: string; bytes: Uint8Array }[] = [];
        try {
          versions = await this.fs.conflictVersions(entry.path);
        } catch (error) {
          report.health.push({
            path: entry.path,
            problem: "unreadable",
            detail: (error as Error).message,
          });
        }
        for (const v of versions) {
          const seen = this.mergedVersions.get(entry.path) ?? new Set<string>();
          if (seen.has(v.id)) continue;
          try {
            const file = decodeNoteFile(v.bytes);
            await this.absorb(file.id, file, report);
            seen.add(v.id);
            this.mergedVersions.set(entry.path, seen);
          } catch (error) {
            report.health.push({
              path: `${entry.path}#${v.id}`,
              problem: "unreadable",
              detail: (error as Error).message,
            });
          }
        }
      }
    }
    return report;
  }

  /** Whether a note's file may lack something the replica has. */
  needsFlush(id: string): boolean {
    const note = this.notes.get(id);
    if (!note) return false;
    if (this.fileContent.get(id) !== noteSum(note)) return true;
    for (const copy of this.mergedCopies.values()) if (copy.id === id) return true;
    return this.mergedVersions.has(notePath(id));
  }

  /** Writes one note with read-merge-write; copies merged into it are cleaned up only after a successful write. */
  async flush(id: string, report: SyncReport = emptyReport()): Promise<SyncReport> {
    const local = this.notes.get(id);
    if (!local) return report;
    const path = notePath(id);
    const losses: Loss[] = [];
    const codec: Codec<NoteLike> = {
      ...noteCodec,
      merge: (a, b) => {
        const r = mergeNoteFiles(a, b);
        losses.push(...r.losses);
        return r.file;
      },
    };
    const result = await readMergeWrite(this.fs, path, codec, local, {
      beforeCommit: async () => {
        await this.recordLosses(losses, report);
      },
    });
    if (result.status === "unreadable") {
      report.health.push({ path, problem: "unreadable", detail: (result.error as Error)?.message });
      return report;
    }
    if (result.status === "notDownloaded") {
      report.health.push({ path, problem: "downloading" });
      return report;
    }
    if (result.status === "busy") {
      report.health.push({ path, problem: "busy" });
      return report;
    }
    observeNote(this.clock, result.value);
    this.notes.set(id, result.value);
    this.fileStates.set(path, result.etag);
    this.fileContent.set(id, noteSum(result.value));
    if (result.status === "written") report.written.push(path);
    for (const [copyPath, copy] of [...this.mergedCopies]) {
      if (copy.id !== id) continue;
      try {
        await this.fs.remove(copyPath, { ifMatch: copy.etag });
        report.copiesMerged.push(copyPath);
      } catch {
        // It changed since we merged it: it will be ingested again.
      }
      this.mergedCopies.delete(copyPath);
      this.fileStates.delete(copyPath);
    }
    const versions = this.mergedVersions.get(path);
    if (versions?.size) {
      await this.fs.resolveConflicts(path, [...versions]).catch(() => undefined);
      this.mergedVersions.delete(path);
    }
    return report;
  }

  /** Ingest, then flush every note whose file may lack something the replica has. */
  async sync(): Promise<SyncReport> {
    const report = await this.ingest();
    for (const id of [...this.notes.keys()].sort())
      if (this.needsFlush(id)) await this.flush(id, report);
    return report;
  }
}

function emptyReport(): SyncReport {
  return { ingested: [], written: [], copiesMerged: [], losses: [], health: [] };
}
