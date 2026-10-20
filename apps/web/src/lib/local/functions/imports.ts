// imports.importText in local mode (convex/imports.ts): one Markdown or plain-text file becomes a new note,
// through the same parser (packages/editor-schema markdown.ts). Settings > Import & export reads the files on
// the device (folders, ZIPs, Notion, Evernote, Word: lib/import) and sends each page here; their images are
// put in the library first (client.local.putFile) and named in `imageMap`.
import { linkImportedPages, markdownToBlocks, plainTextToBlocks, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import { checkScope, insertDocument, requireProfile, toSummary } from "./shared";

const MAX_IMPORT_CHARS = 2_000_000;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const safeDecode = (s: string) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

defineLocal(api.imports.importText, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  if (args.content.length > MAX_IMPORT_CHARS) fail("limit_exceeded", "That file is too large to import (2 MB of text max).");
  let folderId: string | null = null;
  if (args.folderId) {
    const folder = await ctx.db.get("folders", args.folderId);
    if (!folder || folder.deletedAt !== null) fail("not_found", "Folder not found.");
    folderId = folder.id;
  }
  const baseName = args.filename.replace(/\.(md|markdown|txt|text)$/i, "").slice(0, 200) || "Imported";
  let title = baseName;
  let blocks: WireBlock[];
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
      // Parsing gives a bare relative path ("Home/Projects.md") an https:// prefix; the export's own links
      // are relative, so look them up without it too.
      const bare = href.replace(/^https:\/\//, "");
      const id = links[href] ?? links[safeDecode(href)] ?? links[bare] ?? links[safeDecode(bare)];
      return id && ULID_RE.test(id) ? id : null;
    });
  }
  if (args.publicId !== undefined && !ULID_RE.test(args.publicId)) fail("invalid_argument", "Invalid page id.");
  let parentDocumentId: string | null = null;
  if (args.parentId) {
    const parent = await ctx.db.get("documents", args.parentId);
    if (!parent || parent.inTrash) fail("not_found", "The page to put it in isn't here.");
    parentDocumentId = parent.id;
  }
  const doc = await insertDocument(ctx, { id: args.publicId, title, folderId, blocks, parentDocumentId });
  return {
    document: toSummary(doc, profile.id),
    warnings: warnings.slice(0, 100),
    frontMatterKeys: Object.keys(frontMatter),
    blockCount: blocks.length,
  };
});
