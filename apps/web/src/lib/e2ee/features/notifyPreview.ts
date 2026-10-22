// Notification previews (docs/E2EE_DESIGN.md §7.7, WP8). With the switch off (and always for locked notes and
// Fully encrypted spaces) the server only ever has generic text. With it on, the acting device supplies the
// short preview: the router adds it to sealed block mentions and comments (WP7's sealer and sealed comment
// calls), reminders add theirs here. In the app, the bell's generic titles are filled in on the device from
// the note's opened title (`fillNotificationTitles`).
import type { InlineNode } from "@folevi/editor-schema";
import type { LocalBlock, LocalDocument } from "@/lib/local/store";
import type { E2eeSpace } from "../router/deps";

/** Previews are 140 characters at most (§4.6 mentionPreview, e2ee.reminders). */
export const PREVIEW_MAX = 140;

const clip = (s: string) => (s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) : s);

/** Whether the device may send preview text for a space's notes (never at Fully encrypted). */
export function previewsOn(space: Pick<E2eeSpace, "level" | "switches"> | null): boolean {
  return !!space && space.level === "selected" && space.switches.notificationPreviews === true;
}

export function plainText(nodes: unknown): string {
  return Array.isArray(nodes) ? (nodes as InlineNode[]).map((n) => String((n as { text?: unknown }).text ?? (n as { label?: unknown }).label ?? "")).join("") : "";
}

/** A reminder's preview: the to-do's text and the note's title. */
export function reminderPreview(block: Pick<LocalBlock, "text">, doc: Pick<LocalDocument, "title">): { title: string; note: string } {
  return { title: clip(plainText(block.text).trim() || "To-do"), note: clip(doc.title || "Untitled") };
}

/** A notification row as notifications.list returns it (the fields this reads). */
export interface NotificationLike {
  documentId?: string | null;
  title: string;
  sealedDocument?: boolean;
}

/**
 * The bell on an unlocked device: generic titles of sealed notes ("Tess mentioned you in a note") get the
 * note's real title, from the replica or an opened label. Only the device sees the result.
 */
export function fillNotificationTitles<T extends NotificationLike>(rows: readonly T[], titleOf: (documentId: string) => string | null): T[] {
  return rows.map((r) => {
    if (!r.sealedDocument || !r.documentId) return r;
    const title = titleOf(r.documentId);
    if (!title) return r;
    const filled = r.title.replace(/\b(in|on) a note$/, `$1 ${title}`).replace(/\bshared a note with you$/, `shared ${title} with you`);
    return filled === r.title ? r : { ...r, title: filled };
  });
}
