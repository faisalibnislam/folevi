// The writing assistant's saves (docs/AI_ASSISTANT.md milestone 4). The AI writes with `ai.write` (a whole
// page or template too, see lib/ai/writing.ts); the person previews it, and only when they pick "Create
// note" or "Save as template" does it become a document here: a regular note, or a regular template that
// shows in the Templates list and the template picker like any other.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { markdownToBlocks } from "@folevi/editor-schema";
import { assertWritable, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { createDocument } from "./lib/create";
import { inScope, vScopeArg } from "./lib/scope";
import { consume } from "./lib/rateLimit";
import { MAX_DRAFT_BLOCKS, MAX_DRAFT_CHARS, cleanTitleLine } from "./lib/ai/writing";

/**
 * Saves a previewed draft as a new note or template in a scope (your Personal, or a workspace where you can
 * edit), optionally in a folder there. The Markdown becomes real blocks (headings, lists, to-dos, tables).
 */
export const saveDraft = mutation({
  args: {
    scope: vScopeArg,
    kind: v.union(v.literal("note"), v.literal("template")),
    title: v.string(),
    markdown: v.string(),
    folderId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    if (args.markdown.length > MAX_DRAFT_CHARS) fail("limit_exceeded", "That draft is too long to save. Make it shorter first.");
    await consume(ctx, "bulk", profile._id);
    let folderId;
    if (args.folderId && args.kind === "note") {
      const folder = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
        .unique();
      if (!folder || !inScope(folder, scope) || folder.deletedAt) fail("not_found", "Folder not found.");
      folderId = folder._id;
    }
    const { blocks } = markdownToBlocks(args.markdown, { titleFromHeading: false });
    if (blocks.length > MAX_DRAFT_BLOCKS) fail("limit_exceeded", "That draft has too many blocks to save.");
    const title = cleanTitleLine(args.title) || (args.kind === "template" ? "New template" : "Untitled");
    const doc = await createDocument(ctx, { scope, actor: profile, title, folderId, blocks, kind: args.kind === "template" ? "template" : "document" });
    return { id: doc.publicId };
  },
});
