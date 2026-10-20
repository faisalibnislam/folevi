// Foli AI for the mind map block (docs/VISUAL_BLOCKS_PLAN.md, "Mind map block"; lib/mindmapAi.ts holds the
// prompts and the checks on what comes back):
//
//   generate:   a whole map from a prompt, from the note it's in, from text selected in the note, or from a
//               PDF attached to the note (sent to Gemini as inline data, like a chat attachment).
//   expand:     3 to 6 new sub-ideas for one idea (asked again, it suggests different ones).
//   summarize:  the map written up as a short summary, which the client puts in the note below the block.
//   tasks:      chosen branches as concrete next actions, which the client puts in the note as to-dos (so
//               they're Folevi tasks, synced like any typed to-do).
//   tidy:       the map reorganised (grouped, merged, reworded), keeping the ids of the ideas it keeps.
//
// Every action goes through the same gates and credits as the rest of Foli AI (ai.begin: AI on, not in a
// Core scope, the hourly limit, a hold on the estimate; ai.metered settles what Gemini counted). A request
// made from a note is made in that note's scope. Maps returned are the block's own data, already through
// the server's strict check, so the client only applies them (one undo step). Prompts, notes and replies are
// never logged or stored.
import { v } from "convex/values";
import { action, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseMindmap } from "@folevi/editor-schema";
import { requireDocument, requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg, type ScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { aiPrefsOf } from "./lib/ai/prefs";
import { ATTACHMENT_LIMITS, attachmentTokens, toBase64 } from "./lib/ai/attachments";
import { ATTACHMENTS_OFF, FILE_GONE, fileByPublicId, readableKind } from "./lib/ai/attachmentFiles";
import type { Part } from "./lib/ai/provider";
import {
  AI_MAX_TASKS,
  EXPAND_MAX,
  MAP_OUTPUT,
  MAP_SYSTEM,
  MAP_TEXT,
  MAX_INSTRUCTION,
  MINDMAP_MESSAGES,
  attachedPdfLine,
  cleanSummary,
  expandPromptRequest,
  ideaContext,
  mapForPrompt,
  mapPromptRequest,
  mapTasksRequest,
  parseIdeasReply,
  parseMapReply,
  parseTasksReply,
  summarizeMapRequest,
  tidyRequest,
} from "./lib/mindmapAi";
import { gemini, metered } from "./ai";

const vLayout = v.optional(v.union(v.literal("both"), v.literal("right"), v.literal("down")));
/** Where a request is made from: the scope, and the note the block is in (the request is made in its scope). */
const placeArgs = { scope: vScopeArg, documentId: v.optional(v.string()) };

/** The gates and the credit hold, in the note's scope when there's a note. */
async function hold(ctx: ActionCtx, args: { scope: ScopeArg; documentId?: string }, plan: PlannedCall[]): Promise<Id<"aiCreditHolds">> {
  const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing" });
  return holdId;
}

const noMap = () => fail("invalid_argument", MINDMAP_MESSAGES.noMap);

/** A PDF of a note that this person can read, for "from a PDF" (the setting allows reading attachments). */
export const pdfFile = internalQuery({
  args: { documentId: v.string(), fileId: v.string() },
  handler: async (ctx, args): Promise<{ name: string; mimeType: string; size: number; storageId: Id<"_storage"> }> => {
    const profile = await requireProfile(ctx);
    if (!aiPrefsOf(profile).attachments) fail("forbidden", ATTACHMENTS_OFF);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const f = await fileByPublicId(ctx, args.fileId);
    if (!f || f.documentId !== doc._id || f.status !== "ready" || doc.inTrash) fail("not_found", FILE_GONE);
    const check = readableKind(f);
    if (!check.ok) fail("unsupported_file", check.reason);
    if (check.kind !== "pdf") fail("unsupported_file", MINDMAP_MESSAGES.pickPdf);
    if (f.size > ATTACHMENT_LIMITS.pdf) fail("limit_exceeded", MINDMAP_MESSAGES.pdfTooLarge);
    return { name: f.filename, mimeType: f.mimeType, size: f.size, storageId: f.storageId };
  },
});

/** A whole map from a prompt, the note, selected text or a PDF of the note. Returns the block's data. */
export const generate = action({
  args: {
    ...placeArgs,
    source: v.union(v.literal("prompt"), v.literal("note"), v.literal("text"), v.literal("file")),
    instruction: v.optional(v.string()),
    text: v.optional(v.string()),
    fileId: v.optional(v.string()),
    layout: vLayout,
  },
  handler: async (ctx, args): Promise<{ data: string }> => {
    await requireIdentity(ctx);
    const instruction = (args.instruction ?? "").trim().slice(0, MAX_INSTRUCTION);
    let request: ReturnType<typeof mapPromptRequest>;
    let inputChars = MAP_SYSTEM.length + instruction.length + 200;
    let file: { name: string; mimeType: string; size: number; storageId: Id<"_storage"> } | null = null;
    if (args.source === "prompt") {
      if (!instruction) fail("invalid_argument", MINDMAP_MESSAGES.noTopic);
      request = mapPromptRequest({ source: "prompt", instruction });
    } else if (args.source === "text") {
      const text = (args.text ?? "").trim().slice(0, MAP_TEXT);
      if (!text) fail("invalid_argument", MINDMAP_MESSAGES.noText);
      request = mapPromptRequest({ source: "text", instruction, text });
      inputChars += text.length;
    } else if (args.source === "note") {
      if (!args.documentId) fail("invalid_argument", MINDMAP_MESSAGES.noNote);
      const note = await ctx.runQuery(internal.ai.noteText, { documentId: args.documentId });
      if (!note.text.trim()) fail("invalid_argument", MINDMAP_MESSAGES.emptyNote);
      request = mapPromptRequest({ source: "note", instruction, note });
      inputChars += note.text.length;
    } else {
      if (!args.documentId || !args.fileId) fail("invalid_argument", MINDMAP_MESSAGES.pickPdf);
      file = await ctx.runQuery(internal.mindmapAi.pdfFile, { documentId: args.documentId, fileId: args.fileId });
      request = mapPromptRequest({ source: "file", instruction });
      inputChars += attachmentTokens("pdf", file.size) * 4;
    }
    const holdId = await hold(ctx, args, [{ fast: false, inputChars, maxOutputTokens: MAP_OUTPUT }]);
    return await metered(ctx, holdId, async (meter) => {
      let attachments: Part[] | undefined;
      if (file) {
        const blob = await ctx.storage.get(file.storageId);
        if (!blob) fail("not_found", FILE_GONE);
        attachments = [{ text: attachedPdfLine(file.name) }, { inlineData: { mimeType: file.mimeType || "application/pdf", data: toBase64(new Uint8Array(await blob.arrayBuffer())) } }];
      }
      const raw = await gemini({ ...request, attachments }, meter);
      const data = parseMapReply(raw, { layout: args.layout });
      if (!data) fail("invalid_argument", MINDMAP_MESSAGES.mapFailed);
      return { data };
    });
  },
});

/** New sub-ideas for one idea of the map (`data`, the block's data). */
export const expand = action({
  args: { ...placeArgs, data: v.string(), nodeId: v.string() },
  handler: async (ctx, args): Promise<{ ideas: { text: string; children?: { text: string }[] }[] }> => {
    await requireIdentity(ctx);
    const at = ideaContext(args.data, args.nodeId);
    if (!at) fail("invalid_argument", MINDMAP_MESSAGES.ideaGone);
    const req = expandPromptRequest(mapForPrompt(args.data) ?? noMap(), at);
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: req.system.length + req.prompt.length, maxOutputTokens: 1024 }]);
    return await metered(ctx, holdId, async (meter) => {
      const raw = await gemini(req, meter);
      const ideas = parseIdeasReply(raw, at.children, EXPAND_MAX);
      if (!ideas.length) fail("invalid_argument", MINDMAP_MESSAGES.expandFailed);
      return { ideas };
    });
  },
});

/** The map written up as a short Markdown summary. */
export const summarize = action({
  args: { ...placeArgs, data: v.string() },
  handler: async (ctx, args): Promise<{ markdown: string }> => {
    await requireIdentity(ctx);
    const req = summarizeMapRequest(args.data) ?? noMap();
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: req.system.length + req.prompt.length, maxOutputTokens: 2048 }]);
    return await metered(ctx, holdId, async (meter) => {
      const markdown = cleanSummary(await gemini(req, meter));
      if (!markdown) fail("invalid_argument", MINDMAP_MESSAGES.summaryFailed);
      return { markdown };
    });
  },
});

/** Chosen branches (`nodeIds`; none means the whole map) as tasks. */
export const tasks = action({
  args: { ...placeArgs, data: v.string(), nodeIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ tasks: string[] }> => {
    await requireIdentity(ctx);
    const req = mapTasksRequest(args.data, args.nodeIds) ?? noMap();
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: req.system.length + req.prompt.length, maxOutputTokens: 2048 }]);
    return await metered(ctx, holdId, async (meter) => {
      const list = parseTasksReply(await gemini(req, meter)).slice(0, AI_MAX_TASKS);
      if (!list.length) fail("invalid_argument", MINDMAP_MESSAGES.tasksFailed);
      return { tasks: list };
    });
  },
});

/** The map reorganised by Foli AI (ids kept for the ideas it keeps). Returns the block's data. */
export const tidy = action({
  args: { ...placeArgs, data: v.string() },
  handler: async (ctx, args): Promise<{ data: string }> => {
    await requireIdentity(ctx);
    const current = parseMindmap(args.data.slice(0, 250_000));
    const req = tidyRequest(args.data) ?? noMap();
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: req.system.length + req.prompt.length, maxOutputTokens: req.maxOutputTokens }]);
    return await metered(ctx, holdId, async (meter) => {
      const data = parseMapReply(await gemini(req, meter), { keep: current });
      if (!data) fail("invalid_argument", MINDMAP_MESSAGES.tidyFailed);
      return { data };
    });
  },
});
