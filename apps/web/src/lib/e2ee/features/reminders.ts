// Reminder times for sealed to-dos (docs/E2EE_DESIGN.md §7.6, WP8). The server can't read a sealed to-do's
// `reminderAt`, so this device keeps one e2ee.reminders row per open to-do with a reminder, for the person it
// reminds (its assignee in a workspace, else this person), and removes it when the to-do is done, deleted or
// its reminder cleared. With notification previews on (and the note not locked) the row carries the to-do's
// text and the note's title; otherwise the push says only "A reminder is due".
//
// `put` is idempotent (the same time keeps its sent state), so every device of every member may send the
// same rows; each sends only what changed since its last pass.
import { api } from "@/lib/convex/api";
import type { LocalBlock, LocalDocument } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import type { E2eeSpace } from "../router/deps";
import type { InnerClient } from "../router/types";
import type { LockIndex } from "./locks";
import { previewsOn, reminderPreview } from "./notifyPreview";

/** Reminders this far in the past are left alone (they rang, or never will). */
const STALE_MS = 24 * 3_600_000;

export interface ReminderDeps {
  server: Pick<InnerClient, "mutation">;
  space: E2eeSpace;
  store: LocalReader;
  locks: LockIndex;
  profileId: string;
  isSealed(documentId: string): boolean;
  /** What this device sent last pass, by `<documentId>/<blockId>` (kept by the worker). */
  sent: Map<string, string>;
  now?(): number;
}

type Want = { documentId: string; blockId: string; profileId: string; remindAt: number; preview?: { title: string; note: string } };

/** One pass: the rows to put and the to-dos whose rows go. */
export async function syncReminders(d: ReminderDeps): Promise<{ put: number; removed: number }> {
  const now = d.now?.() ?? Date.now();
  const wanted = new Map<string, Want>();
  const gone = new Set<string>();
  const previews = previewsOn(d.space);
  for (const doc of (await d.store.list("documents")) as LocalDocument[]) {
    if (!d.isSealed(doc.id)) continue;
    const blocks = ((await d.store.list("blocks", doc.id)) as LocalBlock[]).filter((b) => b.type === "todo");
    let locked: boolean | null = null;
    for (const b of blocks) {
      const p = b.props as { reminderAt?: unknown; checked?: unknown; assigneeId?: unknown };
      const key = `${doc.id}/${b.id}`;
      const at = typeof p.reminderAt === "number" ? p.reminderAt : null;
      if (b.deletedAt !== null || doc.inTrash || doc.deletedAt !== null || p.checked === true || at === null) {
        if (d.sent.has(key) || at !== null) gone.add(key);
        continue;
      }
      if (at < now - STALE_MS) continue;
      const who = d.space.scope.kind === "workspace" && typeof p.assigneeId === "string" && p.assigneeId ? p.assigneeId : d.profileId;
      let preview: Want["preview"];
      if (previews) {
        locked ??= await d.locks.isLocked(d.store, doc.id);
        if (!locked) preview = reminderPreview(b, doc);
      }
      wanted.set(key, { documentId: doc.id, blockId: b.id, profileId: who, remindAt: at, ...(preview ? { preview } : {}) });
    }
  }
  let put = 0;
  let removed = 0;
  for (const [key, w] of wanted) {
    const sig = JSON.stringify([w.profileId, w.remindAt, w.preview ?? null]);
    if (d.sent.get(key) === sig) continue;
    try {
      await d.server.mutation(api.e2ee.reminders.put, w);
      d.sent.set(key, sig);
      put++;
    } catch {
      // A note this person can't change, or one being converted: tried again next pass.
    }
  }
  for (const key of gone) {
    if (d.sent.get(key) === "removed") continue;
    const [documentId, blockId] = key.split("/") as [string, string];
    try {
      await d.server.mutation(api.e2ee.reminders.remove, { documentId, blockId });
      d.sent.set(key, "removed");
      removed++;
    } catch {
      // Tried again next pass.
    }
  }
  return { put, removed };
}
