"use client";

import { ulid } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { requireOutbox } from "@/lib/app/folders";
import type { OutboxArgs, OutboxMeta, OutboxName } from "@/lib/sync/outbox";
import type { ReactionKind } from "./CommentReactions";

type BodyNode = { type: string; text?: string; label?: string };

/** A comment's text in a few words, for the sync details. */
function excerpt(body: unknown[]): string {
  const text = (body as BodyNode[])
    .map((n) => (n.type === "text" ? n.text : n.type === "mention" ? `@${n.label}` : ""))
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * Comment changes. Writing, replying, editing, resolving, deleting and reacting go through the outbox:
 * shown at once (see `useCommentThreads`), kept on this device, and sent in order when there's a connection.
 * A new comment has its ids from the start, so it can be replied to and reacted to before it's sent; one on
 * a line typed a moment ago waits for that line to reach the server. Read marks go the same way, in order
 * with the thread's other changes.
 */
export function useCommentActions(_documentId: string) {
  const { outbox, engine } = useAppState();
  // Throws (so the caller's `catch` hears it) only while the outbox is still opening.
  const queue = <N extends OutboxName>(name: N, a: OutboxArgs<N>, meta: OutboxMeta) => {
    requireOutbox(outbox).enqueue(name, a, meta);
  };
  return {
    create: async (a: { documentId: string; blockId?: string; body: unknown[] }) => {
      const threadId = ulid();
      const commentId = ulid();
      queue("comments.create", { ...a, threadId, commentId }, { keys: [`thread:${threadId}`, `comment:${commentId}`], label: `Comment “${excerpt(a.body)}”`, after: [{ documentId: a.documentId, blockId: a.blockId ?? null }] });
      // A line typed a moment ago is sent now rather than after the usual pause, so the comment can follow.
      if (engine?.waitsToSync(a.documentId, a.blockId ?? null)) engine.scheduleFlush(0);
      return { threadId, commentId };
    },
    reply: async (a: { threadId: string; body: unknown[] }) => {
      const commentId = ulid();
      queue("comments.reply", { ...a, commentId }, { keys: [`thread:${a.threadId}`, `comment:${commentId}`], label: `Reply “${excerpt(a.body)}”` });
      return { commentId };
    },
    edit: async (a: { commentId: string; body: unknown[] }) => queue("comments.edit", a, { keys: [`comment:${a.commentId}`], label: `Edit comment “${excerpt(a.body)}”` }),
    remove: async (a: { commentId: string }) => queue("comments.remove", a, { keys: [`comment:${a.commentId}`], label: "Delete a comment" }),
    setResolved: async (a: { threadId: string; resolved: boolean }) => queue("comments.setResolved", a, { keys: [`thread:${a.threadId}`], label: a.resolved ? "Resolve a thread" : "Reopen a thread" }),
    deleteThread: async (a: { threadId: string }) => queue("comments.deleteThread", a, { keys: [`thread:${a.threadId}`], label: "Delete a thread" }),
    /** Sets the caller's reaction of `kind` on or off (`on` comes from what's shown, so a resend lands as meant). */
    react: async (a: { commentId: string; kind: ReactionKind; on: boolean }) => queue("comments.react", a, { keys: [`comment:${a.commentId}`], label: a.on ? "Add a reaction" : "Remove a reaction" }),
    /** Reads a thread up to its latest activity as shown (`upTo`): what comes after, from others, stays unread. */
    markThreadRead: async (a: { threadId: string; upTo: number }) => queue("comments.markThreadRead", a, { keys: [`thread:${a.threadId}`], label: "Mark a thread read" }),
    markThreadUnread: async (a: { threadId: string }) => queue("comments.markThreadUnread", a, { keys: [`thread:${a.threadId}`], label: "Mark a thread unread" }),
  };
}

