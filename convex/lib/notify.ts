import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { accessAtLeast, documentAccess } from "./auth";

export const appUrl = () => process.env.FOLEVI_APP_URL ?? "https://app.folevi.com";

type Kind = Doc<"notifications">["kind"];
type Prefs = Doc<"profiles">["notificationPrefs"];

/** Email templates for per-event product notifications. */
export type NotificationEmailKey = "mention_notification" | "comment_notification" | "share_notification";

/**
 * Whether an immediate email for `key` is wanted by someone with `prefs`.
 * People who chose the daily digest get comments, replies and mentions in that digest instead of
 * one email per event (never both).
 */
export function wantsImmediateEmail(prefs: Prefs, key: NotificationEmailKey | "access_changed"): boolean {
  switch (key) {
    case "mention_notification":
      return prefs.mentions && prefs.digest !== "daily";
    case "comment_notification":
      return prefs.comments && prefs.digest !== "daily";
    case "share_notification":
    case "access_changed":
      return prefs.shares;
  }
}

/** Whether a notification of `kind` belongs in the daily digest for someone with `prefs`. */
export function includedInDigest(prefs: Prefs, kind: Kind): boolean {
  if (prefs.digest !== "daily") return false;
  if (kind === "mention") return prefs.mentions;
  if (kind === "comment" || kind === "reply") return prefs.comments;
  return false;
}

/**
 * Creates an in-app notification and (subject to the recipient's Folevi preferences, enforced again in
 * email.sendTemplate) an immediate email. Recipients must be able to read the document; otherwise the
 * notification is dropped so titles never leak outside authorization boundaries.
 *
 * `excerpt` is shown in-app only. Emails never carry note or comment text — just who, where and a link.
 */
export async function notify(
  ctx: MutationCtx,
  input: {
    recipientId: Id<"profiles">;
    actor: Doc<"profiles">;
    kind: Kind;
    doc?: Doc<"documents">;
    threadId?: Id<"commentThreads">;
    title: string;
    excerpt?: string;
    email?: { key: NotificationEmailKey; role?: string };
  },
): Promise<void> {
  if (input.recipientId === input.actor._id) return;
  const recipient = await ctx.db.get(input.recipientId);
  if (!recipient || recipient.status !== "active") return;
  if (input.doc && !accessAtLeast(await documentAccess(ctx, recipient, input.doc), "read")) return;
  const notificationId = await ctx.db.insert("notifications", {
    profileId: input.recipientId,
    workspaceId: input.doc?.workspaceId,
    kind: input.kind,
    actorId: input.actor._id,
    documentId: input.doc?._id,
    threadId: input.threadId,
    title: input.title.slice(0, 200),
    body: input.excerpt?.slice(0, 140),
    createdAt: Date.now(),
  });
  if (!input.email || !input.doc) return;
  if (!wantsImmediateEmail(recipient.notificationPrefs, input.email.key)) return;
  const vars: Record<string, string | number> = {
    actorName: input.actor.displayName.slice(0, 80),
    documentTitle: (input.doc.title || "Untitled").slice(0, 120),
    documentUrl: `${appUrl()}/d/${input.doc.publicId}`,
    preferencesUrl: `${appUrl()}/settings/notifications`,
  };
  if (input.email.key === "share_notification") vars.role = shareRoleLabel(input.email.role ?? "viewer");
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: input.email.key,
    profileId: input.recipientId,
    idempotencyKey: `notify:${notificationId}`,
    dataVariables: vars,
  });
  // Marks the event as emailed so a later digest (e.g. after the person switches to daily) never repeats it.
  await ctx.db.patch(notificationId, { emailedAt: Date.now() });
}

// ---------------------------------------------------------------- access changes

const SHARE_ROLE_LABELS: Record<string, string> = { editor: "Can edit", commenter: "Can comment", viewer: "Can view" };
const WORKSPACE_ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };

export function shareRoleLabel(role: string): string {
  return SHARE_ROLE_LABELS[role] ?? "Can view";
}
export function workspaceRoleLabel(role: string): string {
  return WORKSPACE_ROLE_LABELS[role] ?? "Member";
}

const quote = (s: string, max: number) => `“${(s.trim() || "Untitled").slice(0, max)}”`;

export type AccessChange =
  | { type: "document_role"; doc: Doc<"documents">; role: string }
  | { type: "document_revoked"; doc: Doc<"documents"> }
  | { type: "document_restricted"; doc: Doc<"documents"> }
  | { type: "workspace_role"; workspace: Doc<"workspaces">; role: string }
  | { type: "workspace_removed"; workspace: Doc<"workspaces"> };

/** Plain-language description of an access change (without the actor), e.g. "changed your access to “Plan” to Can edit." */
export function describeAccessChange(change: AccessChange): string {
  switch (change.type) {
    case "document_role":
      return `changed your access to ${quote(change.doc.title, 100)} to ${shareRoleLabel(change.role)}.`;
    case "document_revoked":
      return `removed your access to ${quote(change.doc.title, 100)}.`;
    case "document_restricted":
      return `limited ${quote(change.doc.title, 100)} to people who were given access, so you can no longer open it.`;
    case "workspace_role":
      return `changed your role in ${quote(change.workspace.name, 80)} to ${workspaceRoleLabel(change.role)}.`;
    case "workspace_removed":
      return `removed you from ${quote(change.workspace.name, 80)}.`;
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
  const summary = describeAccessChange(change);
  const workspaceId = doc ? doc.workspaceId : "workspace" in change ? change.workspace._id : undefined;
  const notificationId = await ctx.db.insert("notifications", {
    profileId: recipient._id,
    workspaceId: change.type === "workspace_removed" ? undefined : workspaceId,
    kind: "share_change",
    actorId: input.actor._id,
    documentId: stillReadable ? doc!._id : undefined,
    title: `${input.actor.displayName} ${summary}`.slice(0, 200),
    createdAt: Date.now(),
  });
  if (!wantsImmediateEmail(recipient.notificationPrefs, "access_changed")) return;
  const actionUrl = stillReadable && doc ? `${appUrl()}/d/${doc.publicId}` : `${appUrl()}/documents`;
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "access_changed",
    profileId: recipient._id,
    idempotencyKey: `access:${notificationId}`,
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
  if (!after) return 0;
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", before.workspaceId))
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
