import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { accessAtLeast, documentAccess } from "./auth";

export const appUrl = () => process.env.FOLEVI_APP_URL ?? "https://app.folevi.com";

type Kind = Doc<"notifications">["kind"];

/**
 * Creates an in-app notification and (subject to the recipient's Folevi preferences, enforced again in
 * email.sendTemplate) an immediate email. Recipients must be able to read the document; otherwise the
 * notification is dropped so titles never leak outside authorization boundaries.
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
    email?: { key: "mention_notification" | "comment_notification" | "share_notification"; role?: string };
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
  const prefs = recipient.notificationPrefs;
  const allowed =
    input.email.key === "mention_notification" ? prefs.mentions : input.email.key === "comment_notification" ? prefs.comments : prefs.shares;
  if (!allowed) return;
  const vars: Record<string, string | number> = {
    actorName: input.actor.displayName,
    documentTitle: (input.doc.title || "Untitled").slice(0, 120),
    documentUrl: `${appUrl()}/d/${input.doc.publicId}`,
    preferencesUrl: `${appUrl()}/settings/notifications`,
  };
  if (input.email.key === "share_notification") vars.role = input.email.role ?? "viewer";
  else if (input.excerpt) vars.excerpt = input.excerpt.slice(0, 140);
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: input.email.key,
    profileId: input.recipientId,
    idempotencyKey: `notify:${notificationId}`,
    dataVariables: vars,
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
