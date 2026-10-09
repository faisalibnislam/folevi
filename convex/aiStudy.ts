// Whole-note translation (docs/AI_ASSISTANT.md milestone 8; lib/ai/translate.ts has how structure is kept).
// The other milestone 8 tools (meeting summaries, flashcards and quizzes, the frameworks) are writing tasks
// (lib/ai/writing.ts, `ai.write`): they only ever produce Markdown to preview.
//
//   translateNote:  translates a note into a language, as a new note ("Title (Spanish)") made here, or as
//                   new text for the note's blocks, which the editor applies as one undo step after
//                   `versionBeforeReplace` has saved a version of the note.
//
// Credits: the note's segments are counted first and the calls held up front (at most MAX_TRANSLATE_CHUNKS
// of them); `metered` settles what they really cost. Same gates as every AI request (ai.begin).
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { blocksToMarkdown, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { assertWritable, requireDocument, requireIdentity, requireProfile, requireRowScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { ReaderLabels } from "./lib/linkLabels";
import { cloneBlocks, createDocument } from "./lib/create";
import { copyCollectionsInto } from "./lib/collections";
import { vScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { cleanLanguage } from "./lib/ai/writing";
import {
  MAX_TRANSLATE_CHARS,
  MAX_TRANSLATE_CHUNKS,
  TRANSLATE_MAX_OUTPUT,
  TRANSLATE_SYSTEM,
  applyTranslations,
  chunkSegments,
  parseTranslation,
  segmentsOf,
  translationRequest,
  translationsFor,
  type BlockTranslation,
} from "./lib/ai/translate";
import { snapshot } from "./documents";
import { gemini, metered } from "./ai";

/** Chunks translated at the same time. */
const PARALLEL = 3;
/** The preview of a replacement shows at most this much. */
const PREVIEW_CHARS = 40_000;

/** A note's blocks for translating, if this person may: read it (for a new note), or change it (to replace). */
export const translationSource = internalQuery({
  args: { documentId: v.string(), need: v.union(v.literal("read"), v.literal("write")) },
  handler: async (ctx, args): Promise<{ title: string; blocks: WireBlock[] }> => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, args.need);
    if (doc.inTrash) fail("not_found", "Document not found.");
    // Link labels as this person may see them (lib/linkLabels.ts), as for every AI read of a note.
    const blocks = await new ReaderLabels(ctx, profile).blocks((await liveBlocks(ctx, doc._id)).map(toWireBlock));
    return { title: doc.title || "Untitled", blocks };
  },
});

const vInline = v.array(v.any());
const vTranslation = v.object({ id: v.string(), text: v.optional(vInline), rows: v.optional(v.array(v.array(vInline))), from: v.optional(v.string()) });

/**
 * The translated copy as a new note beside the original (same folder, parent, look), like Duplicate: the
 * blocks as they are now with the translated text put in (fresh ids). Needs the right to add pages there.
 */
export const saveTranslated = internalMutation({
  args: { documentId: v.string(), title: v.string(), translations: v.array(vTranslation) },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const { scope } = await requireRowScope(ctx, profile, doc, "edit", "Document not found.");
    const blocks = applyTranslations((await liveBlocks(ctx, doc._id)).map(toWireBlock), args.translations as BlockTranslation[]);
    const copy = await createDocument(ctx, {
      scope,
      actor: profile,
      title: args.title,
      icon: doc.icon,
      folderId: doc.folderId,
      parentDocumentId: doc.parentDocumentId,
      style: doc.style,
      cover: doc.cover,
      blocks: cloneBlocks(blocks),
    });
    await copyCollectionsInto(ctx, copy);
    return { id: copy.publicId };
  },
});

/**
 * Saves a version of the note before its text is replaced by a translation ("Before AI changes" in its
 * history, always a new version), so the whole note can be restored from there as well as undone.
 */
export const versionBeforeReplace = mutation({
  args: { documentId: v.string() },
  handler: async (ctx, args): Promise<{ versionId: string | null }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    await consume(ctx, "bulk", profile._id);
    const saved = await snapshot(ctx, doc, profile._id, "ai_run");
    return { versionId: saved.id ?? null };
  },
});

/** Runs `work` over `items`, at most `limit` at a time. */
async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Translates a whole note into `language`. "note": makes the translated copy and returns its id.
 * "replace": returns each block's new text (and a preview) for the editor to apply; nothing changes here.
 * Either way the note's structure, links, mentions, dates and code are kept; `untranslated` counts the
 * pieces that came back unusable (they keep their original text).
 */
export const translateNote = action({
  args: {
    scope: vScopeArg,
    documentId: v.string(),
    language: v.string(),
    output: v.union(v.literal("note"), v.literal("replace")),
  },
  handler: async (ctx, args): Promise<{ id?: string; title?: string; translations?: BlockTranslation[]; preview?: string; translated: number; untranslated: number }> => {
    await requireIdentity(ctx);
    const language = cleanLanguage(args.language);
    const source = await ctx.runQuery(internal.aiStudy.translationSource, { documentId: args.documentId, need: args.output === "replace" ? "write" : "read" });
    const segments = segmentsOf(source.blocks);
    if (!segments.length) fail("invalid_argument", "There's no text in this note to translate.");
    const chars = segments.reduce((n, s) => n + s.text.length, 0);
    const chunks = chunkSegments(segments);
    if (chars > MAX_TRANSLATE_CHARS || chunks.length > MAX_TRANSLATE_CHUNKS) fail("limit_exceeded", "This note is too long to translate in one go. Split it into shorter notes first.");
    // Every chunk's call is held up front.
    const plan: PlannedCall[] = chunks.map((c) => ({ fast: false, inputChars: TRANSLATE_SYSTEM.length + 400 + c.reduce((n, s) => n + s.text.length + 16, 0), maxOutputTokens: TRANSLATE_MAX_OUTPUT }));
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: true, plan, feature: "writing" });
    return await metered(ctx, holdId, async (meter) => {
      const done = new Map<string, InlineNode[]>();
      await inParallel(chunks, PARALLEL, async (chunk) => {
        for (const [key, nodes] of parseTranslation(await gemini(translationRequest(chunk, language), meter), chunk)) done.set(key, nodes);
      });
      if (!done.size) fail("invalid_argument", "The translation didn't come back right. Try again.");
      const translations = translationsFor(source.blocks, done);
      const counts = { translated: done.size, untranslated: segments.length - done.size };
      if (args.output === "note") {
        const title = `${source.title} (${language})`;
        const { id } = await ctx.runMutation(internal.aiStudy.saveTranslated, { documentId: args.documentId, title, translations });
        return { id, title, ...counts };
      }
      const preview = blocksToMarkdown(applyTranslations(source.blocks, translations)).slice(0, PREVIEW_CHARS);
      return { translations, preview, ...counts };
    });
  },
});
