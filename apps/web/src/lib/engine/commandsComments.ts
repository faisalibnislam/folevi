// Revision 22: comments from the native apps (the iPhone app's Comments sheet): a comment on the whole note, a
// reply, resolving, read marks and deleting a thread, through the outbox as the web's own controls send them
// (components/doc/commentActions.ts): shown at once, kept on this device, sent in order. Account mode only.
import { ulid } from "@folevi/editor-schema";
import { requireOutbox } from "@/lib/app/folders";
import type { CommandDef } from "./commands";
import { BridgeError, bool, id, only, text } from "./validate";
import type { CommandName, CommentCreateResult, CommentReplyResult } from "./protocol";
import type { EngineDeps } from "./context";

/** A comment's text in a few words, for the sync details. */
const excerpt = (t: string) => {
  const s = t.trim().replace(/\s+/g, " ");
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
};

function outboxOf(deps: EngineDeps) {
  if (deps.app.mode !== "account") throw new BridgeError("unavailable", "Comments need a Folevi account.");
  return requireOutbox(deps.app.outbox);
}

/** The comment's text as the editor's comment body (plain text; mentions are made with the web's picker). */
const bodyOf = (t: string) => [{ type: "text", text: t }];

export const COMMENT_COMMANDS = {
  "comment.create": {
    async run(deps, args): Promise<CommentCreateResult> {
      only(args, ["noteId", "text"]);
      const documentId = id(args, "noteId");
      const t = (text(args, "text", { max: 10000 }) as string).trim();
      if (!t) throw new BridgeError("invalid_args", "A comment needs some text.");
      const threadId = ulid();
      const commentId = ulid();
      outboxOf(deps).enqueue("comments.create", { documentId, body: bodyOf(t), threadId, commentId }, { keys: [`thread:${threadId}`, `comment:${commentId}`], label: `Comment “${excerpt(t)}”`, after: [{ documentId, blockId: null }] });
      return { threadId, commentId };
    },
  },
  "comment.reply": {
    async run(deps, args): Promise<CommentReplyResult> {
      only(args, ["threadId", "text"]);
      const threadId = id(args, "threadId");
      const t = (text(args, "text", { max: 10000 }) as string).trim();
      if (!t) throw new BridgeError("invalid_args", "A reply needs some text.");
      const commentId = ulid();
      outboxOf(deps).enqueue("comments.reply", { threadId, body: bodyOf(t), commentId }, { keys: [`thread:${threadId}`, `comment:${commentId}`], label: `Reply “${excerpt(t)}”` });
      return { commentId };
    },
  },
  "comment.resolve": {
    async run(deps, args) {
      only(args, ["threadId", "resolved"]);
      const threadId = id(args, "threadId");
      const resolved = bool(args, "resolved");
      outboxOf(deps).enqueue("comments.setResolved", { threadId, resolved }, { keys: [`thread:${threadId}`], label: resolved ? "Resolve a thread" : "Reopen a thread" });
      return { ok: true };
    },
  },
  "comment.read": {
    async run(deps, args) {
      only(args, ["threadId", "read"]);
      const threadId = id(args, "threadId");
      if (bool(args, "read")) outboxOf(deps).enqueue("comments.markThreadRead", { threadId, upTo: Date.now() }, { keys: [`thread:${threadId}`], label: "Mark a thread read" });
      else outboxOf(deps).enqueue("comments.markThreadUnread", { threadId }, { keys: [`thread:${threadId}`], label: "Mark a thread unread" });
      return { ok: true };
    },
  },
  "comment.deleteThread": {
    async run(deps, args) {
      only(args, ["threadId"]);
      const threadId = id(args, "threadId");
      outboxOf(deps).enqueue("comments.deleteThread", { threadId }, { keys: [`thread:${threadId}`], label: "Delete a thread" });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
