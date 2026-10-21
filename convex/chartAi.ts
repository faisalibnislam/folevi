// Foli AI for the chart block: suggest the chart type and layout, explain the data (the takeaways under
// the chart), a title and takeaway for a table turned into a chart, tidy and style, and make a chart from
// words (finding the numbers in the note). Prompts and the checks on every reply: lib/chartAi.ts.
//
// The usual gates (ai.begin): signed in, Foli AI on in settings, allowed where the note lives (never in a
// Core scope), the hourly limit, and a hold on the estimated AI credits, settled with what the calls really
// cost (metered). The note's scope decides when a note is named. Nothing is changed here: the client shows
// the result and applies it as one change (⌘Z undoes it).
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeChart } from "@folevi/editor-schema";
import { requireIdentity } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { gemini, metered, providedArgs, requestNote } from "./ai";
import { vProvidedContext } from "./lib/e2ee/ai";
import { CHART_MESSAGES, MAX_CHART, MAX_INSTRUCTION, NOTE_CHARS, chartTaskRequest, fromWordsRequest, parseChartDraft, parseChartPatch, type ChartPatch } from "./lib/chartAi";

const vTask = v.union(v.literal("suggest"), v.literal("explain"), v.literal("tidy"), v.literal("title"));

/**
 * One of the chart tasks on the chart as it is now (`chart`, the block's data). Returns what may change:
 * a suggestion (kind and layout, with a reason), takeaways, a title and takeaway, or a tidied chart (names,
 * labels and options; never a value).
 */
export const assist = action({
  args: { scope: vScopeArg, task: vTask, chart: v.string(), documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<ChartPatch> => {
    await requireIdentity(ctx);
    const chart = normalizeChart(safeJson(args.chart.slice(0, MAX_CHART)));
    if (!chart.columns.length || !chart.rows.length) fail("invalid_argument", CHART_MESSAGES.noData);
    const req = chartTaskRequest(args.task, chart);
    const plan: PlannedCall[] = [{ fast: req.fast, inputChars: req.system.length + req.prompt.length, maxOutputTokens: req.maxOutputTokens }];
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      const raw = await gemini(req, meter);
      const patch = parseChartPatch(args.task, raw, chart);
      if (!patch) fail("invalid_argument", CHART_MESSAGES.taskFailed);
      return patch;
    }, undefined, args.provided);
  },
});

/**
 * A chart from a description: the numbers come from the request itself or from the note (`documentId`,
 * read only if this person can open it). Returns the new chart's data, checked like any chart.
 */
export const fromWords = action({
  args: { scope: vScopeArg, instruction: v.string(), documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) },
  handler: async (ctx, args): Promise<{ data: string }> => {
    await requireIdentity(ctx);
    const instruction = args.instruction.trim().slice(0, MAX_INSTRUCTION);
    if (!instruction) fail("invalid_argument", CHART_MESSAGES.noInstruction);
    const estimate = fromWordsRequest(instruction, args.documentId ? { title: "", text: "x".repeat(NOTE_CHARS) } : null);
    const plan: PlannedCall[] = [{ fast: false, inputChars: estimate.system.length + estimate.prompt.length, maxOutputTokens: estimate.maxOutputTokens }];
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing", ...providedArgs(args.provided) });
    return await metered(ctx, holdId, async (meter) => {
      const note = args.documentId ? await requestNote(ctx, args.documentId, args.provided) : null;
      const req = fromWordsRequest(instruction, note ? { title: note.title, text: note.text.slice(0, NOTE_CHARS) } : null);
      const raw = await gemini(req, meter);
      const data = parseChartDraft(raw);
      if (!data) fail("invalid_argument", note ? CHART_MESSAGES.noNumbersInNote : CHART_MESSAGES.noNumbers);
      return { data };
    }, undefined, args.provided);
  },
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

