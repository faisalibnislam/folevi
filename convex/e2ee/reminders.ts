// Reminders for to-dos in sealed notes (docs/E2EE_DESIGN.md §7.6). WP5.
//
// tasks.processReminders reads the server's task projection, which sealed notes don't have. Instead the
// device (apps/web features/reminders.ts) keeps one `e2eeReminders` row per open to-do with a reminder, for
// each person it reminds, and this module's cron sends them:
//
//   put:     a reminder time for one to-do and one person (the person who set it, or an assignee);
//   remove:  the to-do was done, deleted or its reminder cleared;
//   process: every minute: sends the ones due, in the bell, by push, and by email (the person's choices).
//
// The times are visible to the server (§3.2). The text is generic ("A reminder is due") unless the space
// has notification previews on, when the device supplies the to-do's text and the note's title.
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, membership, requireProfile } from "../lib/auth";
import { fail } from "../lib/errors";
import { insertScoped, scopeOfRow } from "../lib/scope";
import { appUrl } from "../lib/notify";
import { schedulePush } from "../lib/push";
import { isLocked, isSealed, spaceE2ee, switchesOf } from "../lib/e2ee/state";

export const REMINDER_COPY = {
  title: "A reminder is due",
  body: "Open Folevi to see it.",
  emailTask: "A reminder is due",
  emailNote: "a note",
} as const;

const PREVIEW_CHARS = 140;
const BATCH = 100;
/** Reminders more than a day late are marked sent without a message (the device was away a long time). */
const STALE_MS = 24 * 60 * 60_000;
/** Reminders at most this far ahead. */
const MAX_AHEAD_MS = 5 * 365 * 86_400_000;
const MAX_PER_DOCUMENT = 500;

/** Whether the server may show this note's text in a notification: previews on, and the note isn't locked. */
async function previewsAllowed(ctx: MutationCtx, doc: Doc<"documents">): Promise<boolean> {
  if (await isLocked(ctx, doc)) return false;
  return switchesOf(await spaceE2ee(ctx, scopeOfRow(doc))).notificationPreviews;
}

/** Sets (or moves) the reminder of one to-do in a sealed note for one person. */
export const put = mutation({
  args: {
    documentId: v.string(),
    blockId: v.string(),
    profileId: v.string(),
    remindAt: v.number(),
    preview: v.optional(v.object({ title: v.string(), note: v.string() })),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || doc.deletedAt !== undefined) fail("not_found", "Note not found.");
    if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can't change this note.");
    if (!isSealed(doc)) fail("invalid_argument", "Reminders in notes that aren't encrypted are kept with the to-do.");
    if (!args.blockId || args.blockId.length > 64) fail("invalid_argument", "That to-do isn't valid.");
    if (!Number.isFinite(args.remindAt) || args.remindAt > Date.now() + MAX_AHEAD_MS) fail("invalid_argument", "Choose a reminder time within five years.");
    // Yourself, or in a workspace one of its members who can open the note (an assignee).
    const whoId = ctx.db.normalizeId("profiles", args.profileId);
    if (!whoId) fail("invalid_argument", "That person can't be reminded here.");
    if (whoId !== profile._id) {
      const scope = scopeOfRow(doc);
      if (scope.kind !== "workspace" || !(await membership(ctx, whoId, scope.workspaceId))) fail("invalid_argument", "That person can't be reminded here.");
      const who = await ctx.db.get(whoId);
      if (!who || !accessAtLeast(await documentAccess(ctx, who, doc), "read")) fail("invalid_argument", "That person can't open this note.");
    }
    const preview =
      args.preview && (await previewsAllowed(ctx, doc)) ? { title: args.preview.title.slice(0, PREVIEW_CHARS), note: args.preview.note.slice(0, PREVIEW_CHARS) } : undefined;
    const rows = await ctx.db
      .query("e2eeReminders")
      .withIndex("by_document_block", (q) => q.eq("documentId", doc._id).eq("blockId", args.blockId))
      .take(50);
    const now = Date.now();
    const mine = rows.find((r) => r.profileId === whoId);
    if (mine) {
      // A new time rings again; the same time keeps its sent state.
      const moved = mine.remindAt !== args.remindAt;
      await ctx.db.patch(mine._id, { remindAt: args.remindAt, preview, updatedAt: now, ...(moved ? { sentAt: undefined } : {}) });
      return { updated: true };
    }
    const count = await ctx.db
      .query("e2eeReminders")
      .withIndex("by_document_block", (q) => q.eq("documentId", doc._id))
      .take(MAX_PER_DOCUMENT + 1);
    if (count.length >= MAX_PER_DOCUMENT) fail("limit_exceeded", "This note has too many reminders.");
    await insertScoped(ctx, "e2eeReminders", scopeOfRow(doc), { profileId: whoId, documentId: doc._id, blockId: args.blockId, remindAt: args.remindAt, ...(preview ? { preview } : {}), updatedAt: now });
    return { updated: false };
  },
});

/** Removes every reminder of one to-do (done, deleted, or its reminder cleared). */
export const remove = mutation({
  args: { documentId: v.string(), blockId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) return { removed: 0 };
    if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can't change this note.");
    const rows = await ctx.db
      .query("e2eeReminders")
      .withIndex("by_document_block", (q) => q.eq("documentId", doc._id).eq("blockId", args.blockId))
      .take(50);
    for (const r of rows) await ctx.db.delete(r._id);
    return { removed: rows.length };
  },
});

/** Every minute: sends the reminders that are due (cron `e2ee reminders`). */
export const process = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("e2eeReminders")
      .withIndex("by_remind", (q) => q.eq("sentAt", undefined).lte("remindAt", now))
      .take(BATCH);
    let sent = 0;
    for (const r of due) {
      await ctx.db.patch(r._id, { sentAt: now });
      if (r.remindAt < now - STALE_MS) continue;
      const doc = await ctx.db.get(r.documentId);
      const person = await ctx.db.get(r.profileId);
      if (!doc || doc.inTrash || doc.deletedAt !== undefined || !person || person.status !== "active") continue;
      if (!accessAtLeast(await documentAccess(ctx, person, doc), "read")) continue;
      // The preview was checked when it was stored; checked again in case previews were turned off since.
      const preview = r.preview && (await previewsAllowed(ctx, doc)) ? r.preview : undefined;
      const title = preview ? `Reminder: ${preview.title || "To-do"}` : REMINDER_COPY.title;
      const body = preview ? (preview.note ? `In ${preview.note}` : undefined) : REMINDER_COPY.body;
      const path = `/d/${doc.publicId}#block-${r.blockId}`;
      if (person.notificationPrefs.inApp?.reminders !== false) {
        await ctx.db.insert("notifications", {
          profileId: person._id,
          workspaceId: doc.workspaceId,
          kind: "system",
          documentId: doc._id,
          blockId: r.blockId,
          title: title.slice(0, 200),
          createdAt: now,
          sealedDocument: true,
        });
        await schedulePush(ctx, { profileId: person._id, kind: "reminder", title: title.slice(0, 120), body, path, tag: `reminder:${r._id}`, noteId: doc.publicId, taskId: r.blockId });
      }
      if (person.notificationPrefs.reminders !== false) {
        await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
          key: "task_reminder",
          profileId: person._id,
          idempotencyKey: `e2ee-reminder:${r._id}:${r.remindAt}`,
          dataVariables: {
            taskTitle: (preview?.title || REMINDER_COPY.emailTask).slice(0, 200),
            documentTitle: (preview?.note || REMINDER_COPY.emailNote).slice(0, 120),
            due: "",
            taskUrl: `${appUrl()}${path}`,
            preferencesUrl: `${appUrl()}/settings/notifications`,
          },
        });
      }
      sent++;
    }
    if (due.length === BATCH) await ctx.scheduler.runAfter(0, internal.e2ee.reminders.process, {});
    return { due: due.length, sent };
  },
});
