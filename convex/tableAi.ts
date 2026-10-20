// Foli AI for the table block (docs/VISUAL_BLOCKS_PLAN.md, "Tables"; lib/tableAi.ts holds the prompts and
// the checks on what comes back):
//
//   edit:     the table changed as the person asks (rows, columns, values, formulas).
//   clean:    empty cells filled where the table makes them clear, typos and formats fixed, repeated rows
//             removed.
//   formula:  one formula, from words, for the cell the person picked; it must work in the table.
//   explain:  what the table says, as a summary and a few takeaways the client can put under it.
//
// The client sends the table (its cells' text; formulas as written) and shows what comes back as a preview
// with the changed cells marked, applied only when the person accepts (one undo step). Every action goes
// through the same gates and credits as the rest of Foli AI (ai.begin: AI on, not in a Core scope, the hourly
// limit, a hold on the estimate; ai.metered settles what Gemini counted), in the note's scope when there's a
// note. Prompts, tables and replies are never logged or stored.
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireIdentity } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg, type ScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import {
  MAX_INSTRUCTION,
  TABLE_MESSAGES,
  tableOf as tableOrNull,
  parseExplainReply,
  parseFormulaReply,
  parseTableReply,
  tableCleanRequest,
  tableEditRequest,
  tableExplainRequest,
  tableFormulaRequest,
  type AiTable,
} from "./lib/tableAi";
import type { PromptRequest } from "@folevi/ai-prompts";
import { gemini, metered } from "./ai";

const vTable = v.object({ rows: v.array(v.array(v.string())), headerRow: v.boolean(), totalsRow: v.optional(v.boolean()) });
const placeArgs = { scope: vScopeArg, documentId: v.optional(v.string()), table: vTable };

async function hold(ctx: ActionCtx, args: { scope: ScopeArg; documentId?: string }, plan: PlannedCall[]): Promise<Id<"aiCreditHolds">> {
  const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing" });
  return holdId;
}

function tableOf(args: { table: { rows: string[][]; headerRow: boolean; totalsRow?: boolean } }): AiTable {
  return tableOrNull(args.table) ?? fail("invalid_argument", TABLE_MESSAGES.empty);
}

/** The estimate held for one call. */
const planOf = (req: PromptRequest): PlannedCall[] => [{ fast: false, inputChars: req.system.length + req.prompt.length, maxOutputTokens: req.maxOutputTokens ?? 0 }];

/** The table changed as asked. Returns its new rows (text cells) and what changed. */
export const edit = action({
  args: { ...placeArgs, instruction: v.string() },
  handler: async (ctx, args): Promise<{ rows: string[][]; summary: string }> => {
    await requireIdentity(ctx);
    const instruction = args.instruction.trim().slice(0, MAX_INSTRUCTION);
    if (!instruction) fail("invalid_argument", TABLE_MESSAGES.noEdit);
    const req = tableEditRequest(tableOf(args), instruction);
    const holdId = await hold(ctx, args, planOf(req));
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseTableReply(await gemini(req, meter));
      if (!reply) fail("invalid_argument", TABLE_MESSAGES.editFailed);
      return reply;
    });
  },
});

/** Empty cells filled, typos and formats fixed, repeated rows removed. */
export const clean = action({
  args: placeArgs,
  handler: async (ctx, args): Promise<{ rows: string[][]; summary: string }> => {
    await requireIdentity(ctx);
    const req = tableCleanRequest(tableOf(args));
    const holdId = await hold(ctx, args, planOf(req));
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseTableReply(await gemini(req, meter));
      if (!reply) fail("invalid_argument", TABLE_MESSAGES.cleanFailed);
      return reply;
    });
  },
});

/** A formula for the cell at (row, column), from words. */
export const formula = action({
  args: { ...placeArgs, instruction: v.string(), row: v.number(), column: v.number() },
  handler: async (ctx, args): Promise<{ formula: string; explanation: string }> => {
    await requireIdentity(ctx);
    const instruction = args.instruction.trim().slice(0, MAX_INSTRUCTION);
    if (!instruction) fail("invalid_argument", TABLE_MESSAGES.noFormula);
    const t = tableOf(args);
    const row = Math.trunc(args.row);
    const column = Math.trunc(args.column);
    if (row < 0 || column < 0 || row >= t.rows.length || column >= (t.rows[0]?.length ?? 0)) fail("invalid_argument", TABLE_MESSAGES.pickCell);
    const req = tableFormulaRequest(t, row, column, instruction);
    const holdId = await hold(ctx, args, planOf(req));
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseFormulaReply(await gemini(req, meter), t, row, column);
      if (!reply) fail("invalid_argument", TABLE_MESSAGES.formulaFailed);
      return reply;
    });
  },
});

/** What the table says: a summary and a few takeaways. */
export const explain = action({
  args: placeArgs,
  handler: async (ctx, args): Promise<{ summary: string; points: string[] }> => {
    await requireIdentity(ctx);
    const req = tableExplainRequest(tableOf(args));
    const holdId = await hold(ctx, args, planOf(req));
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseExplainReply(await gemini(req, meter));
      if (!reply) fail("invalid_argument", TABLE_MESSAGES.explainFailed);
      return reply;
    });
  },
});
