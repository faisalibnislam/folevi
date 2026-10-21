// Foli AI for the flowchart block, beyond drawing and changing a whole chart (ai.flowchart): a chart from a
// note, a list or selected text, the next steps or missing branches around a selection, an explanation in
// words, clearer labels, and an arrangement for "Tidy up with Foli AI". Prompts and the checks on every
// reply: lib/flowchartAi.ts (@folevi/ai-prompts flowchart.ts), shared with the local backend.
//
// The usual gates (ai.begin): signed in, Foli AI on in settings, allowed where the note lives (never in a
// Core scope), the hourly limit, and a hold on the estimated AI credits, settled with what the calls really
// cost (metered). A note is read only if this person can open it (ai.noteText). Nothing is changed here:
// the client previews the result and applies it as one change (one undo step).
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { checkFlowchart, parseFlowchart, LIMITS } from "@folevi/editor-schema";
import { requireIdentity } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { gemini, metered, providedArgs, requestNote } from "./ai";
import { vProvidedContext } from "./lib/e2ee/ai";
import {
  FLOWCHART_MESSAGES,
  FROM_TEXT_CHARS,
  MAX_INSTRUCTION,
  arrangeRequest,
  explainRequest,
  extendRequest,
  flowchartForPrompt,
  fromTextRequest,
  labelsRequest,
  parseArrangeReply,
  parseExplainReply,
  parseExtendReply,
  parseFlowchartDraft,
  parseLabelsReply,
  type FlowArrangement,
  type FlowDraft,
  type FlowExplanation,
  type FlowExtension,
  type LabelSuggestions,
} from "./lib/flowchartAi";
import type { PromptRequest } from "@folevi/ai-prompts";

const planOf = (req: PromptRequest): PlannedCall[] => [{ fast: Boolean(req.fast), inputChars: req.system.length + req.prompt.length, maxOutputTokens: req.maxOutputTokens ?? 2048 }];

/** The chart a request works on, read the forgiving way, with its compact copy for the prompt. */
function chartOf(data: string, opts: { ids?: boolean; min?: number } = {}) {
  const fc = parseFlowchart(data.slice(0, LIMITS.maxFlowchartDataLength));
  const current = flowchartForPrompt(data, { ids: opts.ids });
  if (!current || fc.nodes.length < (opts.min ?? 1)) fail("invalid_argument", (opts.min ?? 1) > 1 ? FLOWCHART_MESSAGES.tooSmall : FLOWCHART_MESSAGES.noChart);
  return { fc, current };
}

/**
 * A flowchart drawn from text: `text` (a list or selected text from the note), or the whole note
 * (`documentId`, read only if this person can open it). Returns a draft like ai.flowchart's.
 */
export const fromText = action({
  args: { scope: vScopeArg, text: v.optional(v.string()), documentId: v.optional(v.string()), instruction: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<FlowDraft> => {
    await requireIdentity(ctx);
    const text = (args.text ?? "").trim().slice(0, FROM_TEXT_CHARS);
    const instruction = (args.instruction ?? "").trim().slice(0, MAX_INSTRUCTION);
    if (!text && !args.documentId) fail("invalid_argument", FLOWCHART_MESSAGES.noText);
    const estimate = fromTextRequest({ text: text || "x".repeat(FROM_TEXT_CHARS), title: args.documentId && !text ? "Note" : null, instruction });
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan: planOf(estimate), feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      let source = { text, title: null as string | null };
      if (!text) {
        const note = await requestNote(ctx, args.documentId!, args.provided);
        // The note as Markdown starts with its title; a note with nothing under it has no steps.
        const body = note.text.replace(/^#[^\n]*\n?/, "").trim();
        if (!body) fail("invalid_argument", FLOWCHART_MESSAGES.emptyNote);
        source = { text: note.text.slice(0, FROM_TEXT_CHARS), title: note.title };
      }
      const draft = parseFlowchartDraft(await gemini(fromTextRequest({ ...source, instruction }), meter));
      if (!draft) fail("invalid_argument", FLOWCHART_MESSAGES.fromTextFailed);
      return draft;
    }, undefined, args.provided);
  },
});

/**
 * New shapes around the selected ones (`nodeIds`): the next steps ("next") or the missing branches
 * ("branches"). Returns only what's new (shapes, connectors, labels for bare connectors); the client
 * places it beside the selection with the layout engine.
 */
export const extend = action({
  args: { scope: vScopeArg, data: v.string(), nodeIds: v.array(v.string()), kind: v.union(v.literal("next"), v.literal("branches")), instruction: v.optional(v.string()), documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<FlowExtension> => {
    await requireIdentity(ctx);
    const { fc, current } = chartOf(args.data, { ids: true });
    const byId = new Map(fc.nodes.map((n) => [n.id, n]));
    if (!args.nodeIds.length) fail("invalid_argument", FLOWCHART_MESSAGES.pickShapes);
    const selected = args.nodeIds.slice(0, 20).flatMap((id) => (byId.has(id) ? [{ id, text: byId.get(id)!.text }] : []));
    if (!selected.length) fail("invalid_argument", FLOWCHART_MESSAGES.shapesGone);
    const req = extendRequest({ current, selected, kind: args.kind, instruction: (args.instruction ?? "").slice(0, MAX_INSTRUCTION) });
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan: planOf(req), feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      const ext = parseExtendReply(await gemini(req, meter), fc, selected.map((s) => s.id));
      if (!ext) fail("invalid_argument", FLOWCHART_MESSAGES.extendFailed);
      return ext;
    }, undefined, args.provided);
  },
});

/** The chart explained in words (with what the deterministic check found), and as Markdown for the note. */
export const explain = action({
  args: { scope: vScopeArg, data: v.string(), documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<FlowExplanation> => {
    await requireIdentity(ctx);
    const { fc, current } = chartOf(args.data);
    const req = explainRequest({ current, issues: checkFlowchart(fc).map((i) => i.message) });
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan: planOf(req), feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      const out = parseExplainReply(await gemini(req, meter));
      if (!out) fail("invalid_argument", FLOWCHART_MESSAGES.explainFailed);
      return out;
    }, undefined, args.provided);
  },
});

/** Clearer labels for shapes and connectors, each a suggestion the person can take or leave. */
export const labels = action({
  args: { scope: vScopeArg, data: v.string(), documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<LabelSuggestions> => {
    await requireIdentity(ctx);
    const { fc, current } = chartOf(args.data, { ids: true });
    const req = labelsRequest({ current });
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan: planOf(req), feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      const out = parseLabelsReply(await gemini(req, meter), fc);
      if (!out) fail("invalid_argument", FLOWCHART_MESSAGES.labelsFailed);
      return out;
    }, undefined, args.provided);
  },
});

/** An order of the shapes rank by rank, for the client's layout engine ("Tidy up with Foli AI"). */
export const arrange = action({
  args: { scope: vScopeArg, data: v.string(), documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<FlowArrangement> => {
    await requireIdentity(ctx);
    const { fc, current } = chartOf(args.data, { min: 2 });
    const req = arrangeRequest({ current });
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan: planOf(req), feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      const out = parseArrangeReply(await gemini(req, meter), fc);
      if (!out) fail("invalid_argument", FLOWCHART_MESSAGES.arrangeFailed);
      return out;
    }, undefined, args.provided);
  },
});
