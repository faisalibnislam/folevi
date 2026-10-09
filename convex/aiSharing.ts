// Sharing an AI conversation with a workspace (docs/AI_ASSISTANT.md, "Sharing"), only when its person asks.
//
// Rules:
//   - Only a kept conversation in a team workspace can be shared, by the person who started it. Personal
//     conversations can't be (and history-off ones aren't kept). Unsharing works at any time.
//   - Shared means read-only for the workspace's members (not guests): nobody else can ask, regenerate,
//     approve, undo, rename or delete it.
//   - A member sees it (in "Shared with you", and opened) only while they can open every note it depends on
//     (lib/ai/sharing.ts: what it cites, is about, attached files from, and what an agent run changed or
//     made). That's checked through documentAccess for each viewer on every read, never once at share time:
//     lose access to one of them and it's gone for you. It's also gone when its person leaves the workspace.
//   - Files: the person's chat uploads stay theirs (a "file not shared" chip); a note's file shows when the
//     viewer can open the note. Web citations show as they are. Agent runs show what happened, with no
//     Approve or Undo. The person's credits and memory offers aren't shown.
//
// Sharing and unsharing write an audit-style log line (who, which conversation, counts); never content.
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireProfile, requireRowScope, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { recordUserAction } from "./lib/audit";
import { vScopeArg } from "./lib/scope";
import { attachmentChips } from "./lib/ai/attachmentFiles";
import { MAX_NOTE_REFS, allNoteIds, conversationNoteIds } from "./lib/ai/sharing";
import { SHOWN_MESSAGES, byPublicId, contextItems, ownConversation, runsOf, scopeArgOf, wireMessage } from "./aiChat";

const GONE = "That conversation isn't there anymore.";
export const PERSONAL_NOT_SHARED = "Personal conversations can't be shared. Only conversations in a team workspace can.";
const NOT_KEPT = "History is off, so this conversation isn't kept and can't be shared.";
const TOO_MANY_NOTES = `This conversation uses more than ${MAX_NOTE_REFS} notes, which is too many to share.`;
/** Shared conversations listed under "Shared with you". */
const LISTED = 30;

/** Whether `profile` can open every note in `noteIds` right now. */
export async function canOpenAll(ctx: QueryCtx, profile: Doc<"profiles">, noteIds: string[]): Promise<boolean> {
  if (noteIds.length > MAX_NOTE_REFS) return false;
  for (const id of noteIds) {
    const doc = await getDocumentByPublicId(ctx, id);
    if (!doc || doc.inTrash || doc.deletedAt !== undefined || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return false;
  }
  return true;
}

/** Whether someone is still a member of a workspace (a shared conversation's person must be). */
async function isMember(ctx: QueryCtx, profileId: Id<"profiles">, workspaceId: Id<"workspaces">): Promise<boolean> {
  return (
    (await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", profileId))
      .unique()) !== null
  );
}

/**
 * A conversation someone else shared that `profile` may read now, or null: shared with its workspace,
 * `profile` a member there, its person still one, and every note it depends on open to `profile`.
 */
async function sharedFor(ctx: QueryCtx, profile: Doc<"profiles">, c: Doc<"aiConversations"> | null): Promise<Doc<"aiConversations"> | null> {
  if (!c || c.sharedWith !== "workspace" || !c.workspaceId || c.ephemeral || c.profileId === profile._id) return null;
  try {
    await requireRowScope(ctx, profile, c);
  } catch {
    return null;
  }
  if (!(await isMember(ctx, c.profileId, c.workspaceId))) return null;
  return (await canOpenAll(ctx, profile, c.noteRefs ?? [])) ? c : null;
}

const personName = async (ctx: QueryCtx, id: Id<"profiles">) => (await ctx.db.get(id))?.displayName || "A member";

// ---------------------------------------------------------------------------------------------------
// Sharing and unsharing (the conversation's own person)
// ---------------------------------------------------------------------------------------------------

/** Shares one of your conversations with its workspace, read-only. */
export const share = mutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const c = await ownConversation(ctx, profile, args.conversationId);
    if (!c) fail("not_found", GONE);
    if (!c.workspaceId) fail("invalid_argument", PERSONAL_NOT_SHARED);
    if (c.ephemeral) fail("invalid_argument", NOT_KEPT);
    const noteRefs = await allNoteIds(ctx, c);
    if (noteRefs.length > MAX_NOTE_REFS) fail("limit_exceeded", TOO_MANY_NOTES);
    if (c.sharedWith !== "workspace") {
      await ctx.db.patch(c._id, { sharedWith: "workspace", sharedAt: Date.now(), noteRefs });
      recordUserAction(profile, { action: "ai_chat.share", targetType: "aiConversation", targetId: c.publicId, counts: { notes: noteRefs.length } });
    } else {
      await ctx.db.patch(c._id, { noteRefs });
    }
    return null;
  },
});

/** Stops sharing one of your conversations: members can't see it anymore. */
export const unshare = mutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await ownConversation(ctx, profile, args.conversationId);
    if (!c) fail("not_found", GONE);
    if (c.sharedWith !== "workspace") return null;
    await ctx.db.patch(c._id, { sharedWith: "none", sharedAt: undefined, noteRefs: undefined });
    recordUserAction(profile, { action: "ai_chat.unshare", targetType: "aiConversation", targetId: c.publicId, counts: { notes: c.noteRefs?.length ?? 0 } });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Reading (the workspace's members)
// ---------------------------------------------------------------------------------------------------

/** "Shared with you" in a workspace: conversations others shared that you can read now, latest first. */
export const list = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    if (scope.kind !== "workspace") return [];
    const rows = await ctx.db
      .query("aiConversations")
      .withIndex("by_workspace_shared", (q) => q.eq("workspaceId", scope.workspaceId).eq("sharedWith", "workspace"))
      .order("desc")
      .take(LISTED * 2);
    const out: { id: string; title: string; by: string; lastMessageAt: number }[] = [];
    for (const c of rows) {
      if (out.length >= LISTED) break;
      if (!(await sharedFor(ctx, profile, c))) continue;
      out.push({ id: c.publicId, title: c.title, by: await personName(ctx, c.profileId), lastMessageAt: c.lastMessageAt });
    }
    return out;
  },
});

/** A file on a shared message: shown when the viewer can open it, otherwise only that it wasn't shared. */
type SharedFile = { id: string; name: string; mimeType: string; size: number; kind: string; shared: boolean };

/**
 * A conversation shared with you, read-only, with its latest messages; null when you can't read it (not
 * shared, not in your workspace, or a note it depends on is one you can't open).
 */
export const get = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const c = await sharedFor(ctx, profile, await byPublicId(ctx, args.conversationId));
    if (!c) return null;
    const rows = (
      await ctx.db
        .query("aiMessages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
        .order("desc")
        .take(SHOWN_MESSAGES)
    ).reverse();
    // The notes of what's shown, worked out again now (the stored list can lag a moment behind).
    if (!(await canOpenAll(ctx, profile, await conversationNoteIds(ctx, c, rows)))) return null;
    const runs = await runsOf(ctx, rows);
    // Files the viewer can open themselves (a note's files); the person's own uploads never are.
    const files = await attachmentChips(ctx, profile, c, rows);
    const now = Date.now();
    return {
      conversation: {
        id: c.publicId,
        title: c.title,
        by: await personName(ctx, c.profileId),
        scope: await scopeArgOf(ctx, c),
        context: { kind: c.context.kind, items: await contextItems(ctx, profile, c) },
        sharedAt: c.sharedAt ?? null,
        lastMessageAt: c.lastMessageAt,
      },
      messages: rows.map((m) => {
        const wire = wireMessage(m, now, runs, files);
        const attachments: SharedFile[] = (m.attachments ?? []).map((id, i) => {
          const chip = files.get(id);
          return chip ? { ...chip, shared: true } : { id: `${m._id}-${i}`, name: "File not shared", mimeType: "", size: 0, kind: "file", shared: false };
        });
        // Read-only: no credits, memory offers, follow-ups to ask, or live stream of someone else's answer.
        return { ...wire, attachments, credits: null, memory: null, suggestions: [], live: false };
      }),
    };
  },
});
