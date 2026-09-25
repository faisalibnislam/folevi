import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { markdownToBlocks, plainTextToBlocks } from "@folevi/editor-schema";
import { assertWritable, requireProfile, requireWorkspace } from "./lib/auth";
import { fail } from "./lib/errors";
import { createDocument } from "./lib/create";
import { IdResolver, toSummary } from "./lib/documents";

const MAX_IMPORT_CHARS = 2_000_000;

/**
 * Imports one Markdown or plain-text file as a new document. Unsupported constructs are reported back
 * as warnings (and kept as text), never silently dropped.
 */
export const importText = mutation({
  args: {
    workspaceId: v.string(),
    filename: v.string(),
    content: v.string(),
    format: v.union(v.literal("markdown"), v.literal("text")),
    folderId: v.optional(v.string()),
    imageMap: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    if (args.content.length > MAX_IMPORT_CHARS) fail("limit_exceeded", "That file is too large to import (2 MB of text max).");
    let folderId;
    if (args.folderId) {
      const folder = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
        .unique();
      if (!folder || folder.workspaceId !== workspace._id) fail("not_found", "Folder not found.");
      folderId = folder._id;
    }
    const baseName = args.filename.replace(/\.(md|markdown|txt|text)$/i, "").slice(0, 200) || "Imported";
    let title = baseName;
    let blocks;
    let warnings: { line: number; code: string; message: string }[] = [];
    let frontMatter: Record<string, string> = {};
    if (args.format === "markdown") {
      const map = args.imageMap ?? {};
      const result = markdownToBlocks(args.content, { resolveImage: (src) => (map[src] ? { fileId: map[src]! } : null) });
      blocks = result.blocks;
      warnings = result.warnings;
      frontMatter = result.frontMatter;
      if (result.title) title = result.title;
    } else {
      blocks = plainTextToBlocks(args.content);
    }
    if (blocks.length > 5000) fail("limit_exceeded", "That file has too many blocks to import.");
    const doc = await createDocument(ctx, { workspaceId: workspace._id, actor: profile, title, folderId, blocks });
    return {
      document: await toSummary(new IdResolver(ctx), doc),
      warnings: warnings.slice(0, 100),
      frontMatterKeys: Object.keys(frontMatter),
      blockCount: blocks.length,
    };
  },
});
