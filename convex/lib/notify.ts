import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { accessAtLeast, documentAccess } from "./auth";
import { schedulePush } from "./push";
import { scopeOfRow } from "./scope";
import { isLocked, isSealed, spaceE2ee, switchesOf } from "./e2ee/state";

/** The web app's address for links in emails and redirects (no trailing slash). */
export const appUrl = () => (process.env.FOLEVI_APP_URL ?? "https://app.folevi.com").replace(/\/$/, "");

type Kind = Doc<"notifications">["kind"];
type Prefs = Doc<"profiles">["notificationPrefs"];

/** Email templates for per-event product notifications. */
export type NotificationEmailKey = "mention_notification" | "comment_notification" | "share_notification";

/** What a notification is about, as the person chooses it in Settings → Notifications. */
export type Topic = "comments" | "replies" | "mentions" | "shares" | "access";

export function topicOf(kind: Kind): Topic | null {
  switch (kind) {
    case "comment":
      return "comments";
    case "reply":
      return "replies";
    case "mention":
      return "mentions";
    case "share":
    case "invite":
      return "shares";
    case "share_change":
      return "access";
    case "system":
      return null;
  }
}

/** Whether `kind` shows in the bell for someone with `prefs` (everything does unless turned off). */
export function wantsInApp(prefs: Prefs, kind: Kind): boolean {
  const topic = topicOf(kind);
  return topic ? (prefs.inApp?.[topic] ?? true) : true;
}

/** The email choice for a topic. Replies and access changes follow comments and shares until set on their own. */
export function wantsEmail(prefs: Prefs, topic: Topic): boolean {
  switch (topic) {
    case "comments":
      return prefs.comments;
    case "replies":
      return prefs.replies ?? prefs.comments;
    case "mentions":
      return prefs.mentions;
    case "shares":
      return prefs.shares;
    case "access":
      return prefs.access ?? prefs.shares;
  }
}

/**
 * Whether an immediate email for `key` is wanted by someone with `prefs`.
 * People who chose the daily digest get comments, replies and mentions in that digest instead of
 * one email per event (never both). Replies use the comment email with their own preference.
 */
export function wantsImmediateEmail(prefs: Prefs, key: NotificationEmailKey | "access_changed", topic?: Topic): boolean {
  switch (key) {
    case "mention_notification":
      return prefs.mentions && prefs.digest !== "daily";
    case "comment_notification":
      return wantsEmail(prefs, topic === "replies" ? "replies" : "comments") && prefs.digest !== "daily";
    case "share_notification":
      return prefs.shares;
    case "access_changed":
      return wantsEmail(prefs, "access");
  }
}

/** Whether a notification of `kind` belongs in the daily digest for someone with `prefs`. */
export function includedInDigest(prefs: Prefs, kind: Kind): boolean {
  if (prefs.digest !== "daily") return false;
  if (kind === "mention") return prefs.mentions;
  if (kind === "comment") return prefs.comments;
  if (kind === "reply") return wantsEmail(prefs, "replies");
  return false;
}

/** Someone's choice for one note: follow (hear about every comment), mute (no comment or reply notifications), or neither. */
export async function noteMode(ctx: QueryCtx, profileId: Id<"profiles">, documentId: Id<"documents">): Promise<"follow" | "mute" | null> {
  const row = await ctx.db
    .query("noteSubscriptions")
    .withIndex("by_profile_document", (q) => q.eq("profileId", profileId).eq("documentId", documentId))
    .unique();
  return row?.mode ?? null;
}

// ---------------------------------------------------------------- end-to-end encrypted notes (§7.7)

/** What a notification about an encrypted note may say: generic, or the preview the acting device sent. */
export interface SealedPreview {
  /** The note's title. */
  title: string;
  /** The line mentioned in, or the comment's first words. */
  excerpt?: string;
}

/** How emails name an encrypted note when no preview may be shown. */
export const SEALED_NOTE_NAME = "an encrypted note";
const PREVIEW_CHARS = 140;

/**
 * The title and body of a notification about an encrypted note (docs/E2EE_DESIGN.md §7.7): generic unless
 * the space has notification previews on and the device supplied the text.
 */
export function sealedNotificationText(kind: Kind, actorName: string, preview?: SealedPreview): { title: string; excerpt?: string } {
  const who = actorName.slice(0, 80) || "Someone";
  const title = preview?.title.trim().slice(0, PREVIEW_CHARS);
  const excerpt = preview?.excerpt?.trim().slice(0, PREVIEW_CHARS) || undefined;
  switch (kind) {
    case "mention":
      return title ? { title: `${who} mentioned you in ${title}`, excerpt } : { title: `${who} mentioned you in a note` };
    case "comment":
      return title ? { title: `${who} commented on ${title}`, excerpt } : { title: `${who} commented on a note` };
    case "reply":
      return title ? { title: `${who} replied to your comment on ${title}`, excerpt } : { title: `${who} replied to your comment` };
    case "share":
      return title ? { title: `${who} shared ${title} with you` } : { title: `${who} shared a note with you` };
    case "share_change":
      return { title: `${who} changed your access to a note` };
    case "invite":
    case "system":
      return title ? { title: title } : { title: "Something changed in an encrypted note" };
  }
}

/** Whether the server may show a sealed note's preview: the space allows previews and the note isn't locked. */
export async function sealedPreviewAllowed(ctx: QueryCtx, doc: Doc<"documents">): Promise<boolean> {
  if (await isLocked(ctx, doc)) return false;
  return switchesOf(await spaceE2ee(ctx, scopeOfRow(doc))).notificationPreviews;
}

/** Repeated events from the same person in the same place within this window fold into one notification. */
export const BURST_WINDOW_MS = 10 * 60_000;

/**
 * Creates an in-app notification and (subject to the recipient's Folevi preferences, enforced again in
 * email.sendTemplate) an immediate email. Recipients must be able to read the document; otherwise the
 * notification is dropped so titles never leak outside authorization boundaries.
 *
 * - Nobody is notified about their own actions, or about a page in the Trash.
 * - A muted note sends no comment or reply notifications (direct @mentions still arrive).
 * - A burst (same person, same kind, same thread or note, still unread, within BURST_WINDOW_MS) updates
 *   the earlier notification instead of adding another, and sends no further email.
 * - A kind turned off for the bell is still recorded (hidden, `silent`) when email or the digest wants it.
 *
 * `excerpt` is shown in-app only. Emails never carry note or comment text. They carry who, where and a link.
 */
export async function notify(
  ctx: MutationCtx,
  input: {
    recipientId: Id<"profiles">;
    actor: Doc<"profiles">;
    kind: Kind;
    doc?: Doc<"documents">;
    threadId?: Id<"commentThreads">;
    blockId?: string;
    commentId?: string;
    title: string;
    excerpt?: string;
    email?: { key: NotificationEmailKey; role?: string };
    /** An encrypted note: the text the acting device supplied (used only with notification previews on). */
    preview?: SealedPreview;
  },
): Promise<void> {
  if (input.recipientId === input.actor._id) return;
  // An encrypted note: the server has no title or text to show, only what the device supplied (§7.7).
  const sealed = Boolean(input.doc && isSealed(input.doc));
  let sealedTitle: string | undefined;
  if (sealed) {
    const preview = input.preview && (await sealedPreviewAllowed(ctx, input.doc!)) ? input.preview : undefined;
    const text = sealedNotificationText(input.kind, input.actor.displayName, preview);
    input = { ...input, title: text.title, excerpt: text.excerpt };
    sealedTitle = preview?.title.trim().slice(0, 120) || undefined;
  }
  const recipient = await ctx.db.get(input.recipientId);
  if (!recipient || recipient.status !== "active") return;
  if (input.doc) {
    if (input.doc.inTrash) return;
    if (!accessAtLeast(await documentAccess(ctx, recipient, input.doc), "read")) return;
    if ((input.kind === "comment" || input.kind === "reply") && (await noteMode(ctx, recipient._id, input.doc._id)) === "mute") return;
  }
  const prefs = recipient.notificationPrefs;
  const topic = topicOf(input.kind) ?? undefined;
  const inApp = wantsInApp(prefs, input.kind);
  const emailNow = Boolean(input.email && input.doc && wantsImmediateEmail(prefs, input.email.key, topic));
  if (!inApp && !emailNow && !includedInDigest(prefs, input.kind)) return;
  const now = Date.now();

  const recent = await ctx.db
    .query("notifications")
    .withIndex("by_profile_created", (q) => q.eq("profileId", recipient._id).gt("createdAt", now - BURST_WINDOW_MS))
    .order("desc")
    .take(25);
  const burst = recent.find(
    (n) =>
      n.kind === input.kind &&
      n.actorId === input.actor._id &&
      n.documentId === input.doc?._id &&
      n.threadId === input.threadId &&
      (n.silent ? !inApp : inApp && !n.readAt),
  );
  if (burst) {
    await ctx.db.patch(burst._id, {
      title: input.title.slice(0, 200),
      body: input.excerpt?.slice(0, 140),
      blockId: input.blockId ?? burst.blockId,
      commentId: input.commentId ?? burst.commentId,
      count: (burst.count ?? 1) + 1,
      createdAt: now,
      ...(sealed ? { sealedDocument: true } : {}),
    });
    return;
  }

  const notificationId = await ctx.db.insert("notifications", {
    profileId: input.recipientId,
    workspaceId: input.doc?.workspaceId,
    kind: input.kind,
    actorId: input.actor._id,
    documentId: input.doc?._id,
    threadId: input.threadId,
    blockId: input.blockId,
    commentId: input.commentId,
    title: input.title.slice(0, 200),
    body: input.excerpt?.slice(0, 140),
    createdAt: now,
    ...(inApp ? {} : { silent: true, readAt: now }),
    ...(sealed ? { sealedDocument: true } : {}),
  });
  // Mentions also reach the person's browsers and iPhones and iPads that asked for push (only who and
  // where, never note text).
  if (inApp && input.kind === "mention" && input.doc) {
    await schedulePush(ctx, {
      profileId: input.recipientId,
      kind: "mention",
      title: input.title.slice(0, 120),
      path: `/d/${input.doc.publicId}${input.blockId ? `#block-${input.blockId}` : ""}`,
      tag: `mention:${notificationId}`,
      noteId: input.doc.publicId,
    });
  }
  if (!input.email || !input.doc || !emailNow) return;
  const vars: Record<string, string | number> = {
    actorName: input.actor.displayName.slice(0, 80),
    documentTitle: sealed ? (sealedTitle ?? SEALED_NOTE_NAME) : (input.doc.title || "Untitled").slice(0, 120),
    documentUrl: `${appUrl()}/d/${input.doc.publicId}`,
    preferencesUrl: `${appUrl()}/settings/notifications`,
  };
  if (input.email.key === "share_notification") vars.role = shareRoleLabel(input.email.role ?? "viewer");
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: input.email.key,
    profileId: input.recipientId,
    idempotencyKey: `notify:${notificationId}`,
    dataVariables: vars,
    ...(topic === "replies" ? { preference: "replies" } : {}),
  });
  // Marks the event as emailed so a later digest (e.g. after the person switches to daily) never repeats it.
  await ctx.db.patch(notificationId, { emailedAt: Date.now() });
}

// ---------------------------------------------------------------- access changes

const SHARE_ROLE_LABELS: Record<string, string> = { editor: "Can edit", commenter: "Can comment", viewer: "Can view" };
/** Roles as people read them; a member's access restriction is part of the label ("member:view"). */
const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  "member:edit": "Member",
  "member:comment": "Member (can comment)",
  "member:view": "Member (view only)",
  editor: "Member",
  commenter: "Member (can comment)",
  viewer: "Member (view only)",
};

export function shareRoleLabel(role: string): string {
  return SHARE_ROLE_LABELS[role] ?? "Can view";
}
/** "Owner", "Admin", "Member", "Member (can comment)" or "Member (view only)". */
export function workspaceRoleLabel(role: string, memberAccess?: string): string {
  const key = role === "member" && memberAccess ? `member:${memberAccess}` : role;
  return WORKSPACE_ROLE_LABELS[key] ?? "Member";
}

const quote = (s: string, max: number) => `“${(s.trim() || "Untitled").slice(0, max)}”`;
/** A note as access-change texts name it: its title, or "a note" when it's encrypted (the server can't read it). */
const noteName = (doc: Doc<"documents">) => (isSealed(doc) ? "a note" : quote(doc.title, 100));

/** A folder as access-change texts name it: its name, or "a folder" when it's encrypted. */
const folderName = (folder: Doc<"folders">) => (folder.sealedName ? "a folder" : quote(folder.name, 80));

export type AccessChange =
  | { type: "document_role"; doc: Doc<"documents">; role: string }
  | { type: "document_revoked"; doc: Doc<"documents"> }
  | { type: "document_restricted"; doc: Doc<"documents"> }
  | { type: "folder_role"; folder: Doc<"folders">; role: string }
  | { type: "folder_revoked"; folder: Doc<"folders"> }
  | { type: "workspace_role"; workspace: Doc<"workspaces">; role: string }
  | { type: "workspace_removed"; workspace: Doc<"workspaces"> }
  | { type: "workspace_guest"; workspace: Doc<"workspaces"> }
  | { type: "workspace_deletion_scheduled"; workspace: Doc<"workspaces">; at: number };

/** Plain-language description of an access change (without the actor), e.g. "changed your access to “Plan” to Can edit." */
export function describeAccessChange(change: AccessChange): string {
  switch (change.type) {
    case "document_role":
      return `changed your access to ${noteName(change.doc)} to ${shareRoleLabel(change.role)}.`;
    case "document_revoked":
      return `removed your access to ${noteName(change.doc)}.`;
    case "document_restricted":
      return `limited ${noteName(change.doc)} to people who were given access, so you can no longer open it.`;
    case "folder_role":
      return `changed your access to the folder ${folderName(change.folder)} to ${shareRoleLabel(change.role)}.`;
    case "folder_revoked":
      return `removed your access to the folder ${folderName(change.folder)} and the notes in it.`;
    case "workspace_role":
      return `changed your role in ${quote(change.workspace.name, 80)} to ${workspaceRoleLabel(change.role)}.`;
    case "workspace_removed":
      return `removed you from ${quote(change.workspace.name, 80)}.`;
    case "workspace_guest":
      return `made you a guest in ${quote(change.workspace.name, 80)}: you keep the pages you created or were given, and nothing else there.`;
    case "workspace_deletion_scheduled":
      return `scheduled ${quote(change.workspace.name, 80)} for deletion on ${new Date(change.at).toUTCString().slice(0, 16)}. Export anything you need before then.`;
  }
}

/**
 * Tells someone their access changed (in-app always; email when they allow share emails).
 *
 * Callers must only use this for people who could see the target *before* the change (existing grant
 * holders, workspace members), so naming the document or workspace never leaks anything new. Links
 * only point somewhere the person can still open.
 */
export async function notifyAccessChange(ctx: MutationCtx, input: { recipientId: Id<"profiles">; actor: Doc<"profiles">; change: AccessChange }): Promise<void> {
  const { change } = input;
  if (input.recipientId === input.actor._id) return;
  const recipient = await ctx.db.get(input.recipientId);
  if (!recipient || recipient.status !== "active") return;
  const doc = "doc" in change ? change.doc : undefined;
  // A document link is only kept while the person can still open it (role changes).
  const stillReadable = change.type === "document_role" && doc ? accessAtLeast(await documentAccess(ctx, recipient, doc), "read") : false;
  if (change.type === "document_role" && !stillReadable) return;
  const inApp = wantsInApp(recipient.notificationPrefs, "share_change");
  const emailNow = wantsImmediateEmail(recipient.notificationPrefs, "access_changed");
  if (!inApp && !emailNow) return;
  const summary = describeAccessChange(change);
  const workspaceId = doc ? doc.workspaceId : "workspace" in change ? change.workspace._id : "folder" in change ? change.folder.workspaceId : undefined;
  const now = Date.now();
  const notificationId = await ctx.db.insert("notifications", {
    profileId: recipient._id,
    // Not tied to a workspace the person may no longer be in (or that is going away).
    workspaceId: change.type === "workspace_removed" || change.type === "workspace_guest" || change.type === "workspace_deletion_scheduled" ? undefined : workspaceId,
    kind: "share_change",
    actorId: input.actor._id,
    documentId: stillReadable ? doc!._id : undefined,
    // A folder whose access changed (still theirs to open: the shared folder opens from it).
    ...(change.type === "folder_role" ? { folderId: change.folder._id } : {}),
    title: `${input.actor.displayName} ${summary}`.slice(0, 200),
    createdAt: now,
    ...(doc && isSealed(doc) ? { sealedDocument: true } : {}),
    ...(inApp ? {} : { silent: true, readAt: now }),
  });
  if (!emailNow) return;
  const actionUrl = stillReadable && doc ? `${appUrl()}/d/${doc.publicId}` : change.type === "folder_role" ? `${appUrl()}/shared/${change.folder.publicId}` : `${appUrl()}/documents`;
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "access_changed",
    profileId: recipient._id,
    idempotencyKey: `access:${notificationId}`,
    preference: "access",
    dataVariables: {
      actorName: input.actor.displayName.slice(0, 80),
      summary: summary.slice(0, 240),
      actionUrl,
      preferencesUrl: `${appUrl()}/settings/notifications`,
    },
  });
  await ctx.db.patch(notificationId, { emailedAt: Date.now() });
}

/**
 * After a document switched to "restricted", notifies the workspace members who could read it before
 * and can't any more. `before` is the document as it was before the patch. Bounded to 100 people.
 */
export async function notifyAccessLostOnRestrict(ctx: MutationCtx, actor: Doc<"profiles">, before: Doc<"documents">): Promise<number> {
  const after = await ctx.db.get(before._id);
  // Personal has no members: only its owner and the people pages were shared with (grants still apply).
  const workspaceId = before.workspaceId;
  if (!after || !workspaceId) return 0;
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(500);
  let notified = 0;
  for (const m of members) {
    if (notified >= 100) break;
    if (m.profileId === actor._id) continue;
    const person = await ctx.db.get(m.profileId);
    if (!person || person.status !== "active") continue;
    const had = accessAtLeast(await documentAccess(ctx, person, before), "read");
    if (!had) continue;
    const has = accessAtLeast(await documentAccess(ctx, person, after), "read");
    if (has) continue;
    await notifyAccessChange(ctx, { recipientId: person._id, actor, change: { type: "document_restricted", doc: after } });
    notified++;
  }
  return notified;
}

/**
 * The in-app notice of a workspace invitation (the email goes out separately, under the "invites" email
 * preference). Skipped when the person turned shares and invitations off for the bell.
 */
export async function notifyInvite(
  ctx: MutationCtx,
  input: { recipient: Doc<"profiles">; actorId?: Id<"profiles">; workspaceId: Id<"workspaces">; inviteId: Id<"workspaceInvites">; title: string },
): Promise<void> {
  if (input.recipient.status !== "active" || input.recipient._id === input.actorId) return;
  if (!wantsInApp(input.recipient.notificationPrefs, "invite")) return;
  await ctx.db.insert("notifications", {
    profileId: input.recipient._id,
    workspaceId: input.workspaceId,
    kind: "invite",
    actorId: input.actorId,
    inviteId: input.inviteId,
    title: input.title.slice(0, 200),
    createdAt: Date.now(),
  });
}

/** Extracts mentioned profile ids from rich text. */
export function mentionedIds(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const out = new Set<string>();
  for (const n of nodes) {
    if (n && typeof n === "object" && (n as { type?: string }).type === "mention") {
      const id = (n as { userId?: unknown }).userId;
      if (typeof id === "string") out.add(id);
    }
  }
  return [...out];
}

/** Deletes this person's notifications about an invitation (declined: nothing left to act on). */
export async function removeInviteNotices(ctx: MutationCtx, profileId: Id<"profiles">, about: (n: Doc<"notifications">) => boolean): Promise<void> {
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_profile_created", (q) => q.eq("profileId", profileId))
    .order("desc")
    .take(500);
  for (const n of notes) if (about(n)) await ctx.db.delete(n._id);
}

/**
 * Tells someone a folder was shared with them (docs/SHARING.md): in the bell, and by the share email when
 * they allow share emails. Only for people who can open the folder now (they were just given it).
 */
export async function notifyFolderShare(ctx: MutationCtx, input: { recipientId: Id<"profiles">; actor: Doc<"profiles">; folder: Doc<"folders">; role: string }): Promise<void> {
  if (input.recipientId === input.actor._id) return;
  const recipient = await ctx.db.get(input.recipientId);
  if (!recipient || recipient.status !== "active") return;
  const inApp = wantsInApp(recipient.notificationPrefs, "share");
  const emailNow = wantsImmediateEmail(recipient.notificationPrefs, "share_notification");
  if (!inApp && !emailNow) return;
  const name = input.folder.sealedName ? "a folder" : quote(input.folder.name, 100);
  const now = Date.now();
  const notificationId = await ctx.db.insert("notifications", {
    profileId: recipient._id,
    workspaceId: input.folder.workspaceId,
    kind: "share",
    actorId: input.actor._id,
    folderId: input.folder._id,
    title: `${input.actor.displayName} shared the folder ${name} with you`.slice(0, 200),
    createdAt: now,
    ...(inApp ? {} : { silent: true, readAt: now }),
  });
  if (!emailNow) return;
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "share_notification",
    profileId: recipient._id,
    idempotencyKey: `notify:${notificationId}`,
    dataVariables: {
      actorName: input.actor.displayName.slice(0, 80),
      documentTitle: `the folder ${name}`.slice(0, 120),
      role: shareRoleLabel(input.role),
      documentUrl: `${appUrl()}/shared/${input.folder.publicId}`,
      preferencesUrl: `${appUrl()}/settings/notifications`,
    },
  });
  await ctx.db.patch(notificationId, { emailedAt: Date.now() });
}
