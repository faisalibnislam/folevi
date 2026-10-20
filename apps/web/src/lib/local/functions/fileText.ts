// fileText.* in local mode (convex/fileText.ts; docs/ARCHITECTURE.md, "Search in files"). The words this
// device found in a note's PDFs, images and whiteboard handwriting are kept with the note (the note file's
// `fileText`, docs/LOCAL_MODE_PLAN.md §3.3: table `fileTexts`, under the note), so another device showing the
// same library never reads that file again. Search finds them (functions/search.ts, fileTextHits).
//
// Foli AI reading an image (fileText.readImage) is a server feature, hidden in local mode.
import { cleanFileText, highlightRanges, MAX_FILE_TEXT, pageAt, searchSnippet, validPageStarts, type FileTextSource } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal, type LocalQueryCtx } from "../registry";
import type { LocalDocument, LocalFile, LocalFileText } from "../store";
import { fileTextKey } from "../search";
import { requireProfile } from "./shared";

const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[A-Za-z0-9]{1,128}$/;

/** A found-text row's id under its note: the file's id, or `hw:<block>` for a whiteboard's handwriting. */
export const handwritingId = (blockId: string) => `hw:${blockId}`;

/** The note's file a device read, checked: the note's own, and the kind the source says. */
function checkFile(file: LocalFile | undefined, doc: LocalDocument, source: FileTextSource): LocalFile {
  if (!file || file.documentId !== doc.id) fail("not_found", "File not found.");
  if (source === "pdf" && file.mimeType !== "application/pdf") fail("invalid_argument", "That file isn't a PDF.");
  if (source === "image" && (file.kind !== "image" || !file.mimeType.startsWith("image/"))) fail("invalid_argument", "That file isn't an image.");
  return file;
}

defineLocal(api.fileText.forDocument, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const rows = (await ctx.db.list("fileTexts", doc.id)).sort((a, b) => (a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : a.createdAt - b.createdAt)).slice(0, 500);
  const out: { fileId: string | null; blockId: string; source: FileTextSource; by: LocalFileText["by"]; hash: string; empty: boolean }[] = [];
  for (const r of rows) {
    if (r.fileId) {
      const file = await ctx.db.get("files", r.fileId);
      if (!file || file.documentId !== doc.id) continue;
    }
    out.push({ fileId: r.fileId, blockId: r.blockId, source: r.source, by: r.by, hash: r.hash, empty: !r.text });
  }
  return out;
});

defineLocal(api.fileText.save, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc || doc.inTrash) fail("not_found", "Document not found.");
  if (!BLOCK_ID.test(args.blockId)) fail("invalid_argument", "Unknown block.");
  if (args.text.length > MAX_FILE_TEXT * 2) fail("invalid_argument", "That's more text than a file can keep.");
  const text = cleanFileText(args.text);
  // Page starts belong to the text as sent: kept only when tidying it changed nothing.
  let pageStarts: number[] | null = null;
  if (args.pageStarts?.length) {
    if (args.source !== "pdf") fail("invalid_argument", "Only a PDF has pages.");
    if (text === args.text && validPageStarts(args.pageStarts, text.length)) pageStarts = args.pageStarts;
  }
  const now = ctx.now();
  let row: Omit<LocalFileText, "createdAt" | "updatedAt">;
  if (args.source === "handwriting") {
    if (args.fileId) fail("invalid_argument", "Handwriting belongs to a drawing, not a file.");
    if (!args.hash || !HASH.test(args.hash)) fail("invalid_argument", "Say which drawing this is.");
    if (!profile.aiPrefs.deviceText) fail("forbidden", "Reading handwriting is turned off in Settings > AI.");
    row = { id: handwritingId(args.blockId), documentId: doc.id, blockId: args.blockId, fileId: null, source: "handwriting", by: "device", text, pageStarts: null, hash: args.hash };
  } else {
    if (!args.fileId) fail("invalid_argument", "Say which file this is.");
    const file = checkFile(await ctx.db.get("files", args.fileId), doc, args.source);
    if (args.source === "image" && !profile.aiPrefs.deviceText) fail("forbidden", "Reading images on this device is turned off in Settings > AI.");
    row = { id: file.id, documentId: doc.id, blockId: args.blockId, fileId: file.id, source: args.source, by: args.source === "pdf" ? "pdf" : "device", text, pageStarts, hash: file.sha256 };
  }
  // A file's text is one row wherever the file went (the server finds it by file); it moves with it.
  let existing: LocalFileText | undefined = await ctx.db.get("fileTexts", row.id, doc.id);
  if (!existing && row.fileId) {
    existing = (await ctx.db.list("fileTexts")).find((r) => r.fileId === row.fileId);
    if (existing) ctx.db.remove("fileTexts", existing.id, existing.documentId);
  }
  ctx.db.put("fileTexts", row.id, { ...row, createdAt: existing?.createdAt ?? now, updatedAt: now }, doc.id);
  return null;
});

// ---- search (functions/search.ts) ------------------------------------------------------------------------

export interface FileTextHit {
  documentId: string;
  blockId: string;
  source: FileTextSource;
  page: number | null;
  snippet: string;
}

/**
 * Found text matching `q`: the first hit per note, each still showing in its note (the block is live and, for
 * a file, still shows that file; a removed image's words aren't found). The server's fileTextHits, over the
 * local index: the best 40 rows, best first (ties: the row read first).
 */
export async function fileTextHits(ctx: LocalQueryCtx, q: string, take = 40): Promise<Map<string, FileTextHit>> {
  const index = await ctx.searchIndex();
  const rows = await ctx.db.list("fileTexts");
  index.syncFileTexts(rows);
  const byKey = new Map(rows.map((r) => [fileTextKey(r), r]));
  const scores = index.files.search(q);
  const ranked = [...scores]
    .map(([key, score]) => ({ row: byKey.get(key), score }))
    .filter((x): x is { row: LocalFileText; score: number } => Boolean(x.row))
    .sort((a, b) => b.score - a.score || a.row.createdAt - b.row.createdAt || (a.row.id < b.row.id ? -1 : 1))
    .slice(0, take);
  const out = new Map<string, FileTextHit>();
  for (const { row: r } of ranked) {
    if (!r.text) continue;
    let documentId = r.documentId;
    if (r.fileId) {
      const file = await ctx.db.get("files", r.fileId);
      if (!file || !file.documentId) continue;
      documentId = file.documentId;
    }
    if (out.has(documentId)) continue;
    const block = await ctx.db.get("blocks", r.blockId, documentId);
    if (!block || block.deletedAt !== null) continue;
    if (r.fileId && (block.props as { fileId?: unknown } | null)?.fileId !== r.fileId) continue;
    if (!r.fileId && block.type !== "whiteboard") continue;
    const at = highlightRanges(r.text, q)[0]?.start ?? 0;
    out.set(documentId, { documentId, blockId: r.blockId, source: r.source, page: r.source === "pdf" ? pageAt(r.pageStarts ?? undefined, at) : null, snippet: searchSnippet(r.text.replace(/\s+/g, " "), q, 70) });
  }
  return out;
}
