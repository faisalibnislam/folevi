// Local-only functions: things a local library has that the server doesn't (docs/LOCAL_MODE_PLAN.md §2.3,
// §3.4). They're registered like the ported ones (lib/local/functions/notices.ts) under the "local" module,
// which the server never has, so call them only in local mode: `useQuery(localApi.noteStatus, mode ===
// "local" ? args : "skip")`. On a Convex client they'd fail as unknown functions.
import { makeFunctionReference } from "convex/server";

/** A "Changed on another device" notice on a note, as the editor shows it. */
export interface NoteNotice {
  id: string;
  /** The block it's about; null for the title or the whole note. */
  blockId: string | null;
  field: string | null;
  kind: "changed" | "deleted" | "restored";
  /** The version in history holding the other side, or null. */
  versionId: string | null;
  /** The device whose change went to history, by name ("Sam's MacBook Air"). */
  otherDevice: string | null;
  at: number;
}

export interface NoteStatus {
  /** The note's file hasn't arrived: still downloading, or another device hasn't sent it yet. */
  pending: "downloading" | "waiting" | null;
  notices: NoteNotice[];
}

export const localApi = {
  /** A note's placeholder state and its notices that aren't dismissed. Null for a note that isn't there. */
  noteStatus: makeFunctionReference<"query", { documentId: string }, NoteStatus | null>("local:noteStatus"),
  /** Puts a notice away (on every device: the dismissal is written to the note's file). */
  dismissNotice: makeFunctionReference<"mutation", { documentId: string; noticeId: string }, null>("local:dismissNotice"),
};
