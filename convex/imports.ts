import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { linkImportedPages, markdownToBlocks, plainTextToBlocks } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { createDocument } from "./lib/create";
import { IdResolver, toSummary } from "./lib/documents";
import { inScope, vScopeArg } from "./lib/scope";
import { failE2ee, isLocked, isSealed } from "./lib/e2ee/state";
import { isEncryptedSpace } from "./lib/e2ee/coreGuards";
import { lockFor } from "./lib/e2ee/sealedRows";

const MAX_IMPORT_CHARS = 2_000_000;

/**
 * Imports one Markdown or plain-text file as a new document in a scope (your Personal, or a workspace
 * where you can edit). Unsupported constructs are reported back as warnings (and kept as text), never
 * silently dropped.
 */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const safeDecode = (s: string) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

export const importText = mutation({
  args: {
    scope: vScopeArg,
    filename: v.string(),
    content: v.string(),
    format: v.union(v.literal("markdown"), v.literal("text")),
    folderId: v.optional(v.string()),
    imageMap: v.optional(v.record(v.string(), v.string())),
    /**
     * For a batch of pages that link to each other (a Notion export): this page's id, chosen by the
     * importer so the others can link to it before it exists; the page it's nested under (imported
     * earlier in the batch); and which link targets are pages of the batch (target → page id).
     */
    publicId: v.optional(v.string()),
    parentId: v.optional(v.string()),
    links: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope, "edit");
    if (args.content.length > MAX_IMPORT_CHARS) fail("limit_exceeded", "That file is too large to import (2 MB of text max).");
    // A new note in an encrypted space, or in a locked folder or page, must be sealed: the device parses and
    // seals it (the local import handler), docs/E2EE_DESIGN.md §5.7.
    if (await isEncryptedSpace(ctx, scope)) failE2ee("e2ee_device_only");
    let folderId;
    if (args.folderId) {
      const folder = await ctx.db
        .query("folders")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
        .unique();
      if (!folder || !inScope(folder, scope)) fail("not_found", "Folder not found.");
      // A locked folder (or one inside it) takes only sealed notes.
      if (folder.sealedName || (await lockFor(ctx, folder._id, null))) failE2ee("e2ee_device_only");
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
    if (args.links) {
      const links = args.links;
      linkImportedPages(blocks, (href) => {
        // Parsing gives a bare relative path ("Home/Projects.md") an https:// prefix; the export's own
        // links are relative, so look them up without it too.
        const bare = href.replace(/^https:\/\//, "");
        const id = links[href] ?? links[safeDecode(href)] ?? links[bare] ?? links[safeDecode(bare)];
        return id && ULID_RE.test(id) ? id : null;
      });
    }
    if (args.publicId !== undefined && !ULID_RE.test(args.publicId)) fail("invalid_argument", "Invalid page id.");
    let parentDocumentId;
    if (args.parentId) {
      const parent = await getDocumentByPublicId(ctx, args.parentId);
      if (!parent || parent.deletedAt !== undefined || !inScope(parent, scope)) fail("not_found", "The page to put it in isn't here.");
      if (!accessAtLeast(await documentAccess(ctx, profile, parent), "write")) fail("forbidden", "You can't add pages inside that one.");
      if (isSealed(parent) || (await isLocked(ctx, parent)) || (await lockFor(ctx, undefined, parent))) failE2ee("e2ee_device_only");
      parentDocumentId = parent._id;
    }
    const doc = await createDocument(ctx, { scope, actor: profile, title, folderId, blocks, publicId: args.publicId, parentDocumentId });
    return {
      document: await toSummary(new IdResolver(ctx), doc),
      warnings: warnings.slice(0, 100),
      frontMatterKeys: Object.keys(frontMatter),
      blockCount: blocks.length,
    };
  },
});
