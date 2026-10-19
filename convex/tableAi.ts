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
import { cellReference } from "@folevi/editor-schema";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireIdentity } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg, type ScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { untrusted } from "./lib/ai/tools/untrusted";
import { CLEAN_SYSTEM, EDIT_SYSTEM, EXPLAIN_SYSTEM, FORMULA_SYSTEM, cleanTable, parseExplainReply, parseFormulaReply, parseTableReply, tableForPrompt, type AiTable } from "./lib/tableAi";
import { gemini, metered } from "./ai";

const MAX_INSTRUCTION = 2000;
const TABLE_OUTPUT = 8192;

const vTable = v.object({ rows: v.array(v.array(v.string())), headerRow: v.boolean(), totalsRow: v.optional(v.boolean()) });
const placeArgs = { scope: vScopeArg, documentId: v.optional(v.string()), table: vTable };

async function hold(ctx: ActionCtx, args: { scope: ScopeArg; documentId?: string }, plan: PlannedCall[]): Promise<Id<"aiCreditHolds">> {
  const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing" });
  return holdId;
}

function tableOf(args: { table: { rows: string[][]; headerRow: boolean; totalsRow?: boolean } }): AiTable {
  const t = cleanTable(args.table);
  if (!t || t.rows.every((r) => r.every((c) => !c.trim()))) fail("invalid_argument", "The table is empty. Add a few rows first.");
  return t;
}

const asTable = (t: AiTable) => untrusted("note", { part: "table" }, tableForPrompt(t));

/** The table changed as asked. Returns its new rows (text cells) and what changed. */
export const edit = action({
  args: { ...placeArgs, instruction: v.string() },
  handler: async (ctx, args): Promise<{ rows: string[][]; summary: string }> => {
    await requireIdentity(ctx);
    const instruction = args.instruction.trim().slice(0, MAX_INSTRUCTION);
    if (!instruction) fail("invalid_argument", "Say how the table should change.");
    const t = tableOf(args);
    const prompt = `${asTable(t)}\n\nChange the table as the person asks.\n\nRequest: ${instruction}`;
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: EDIT_SYSTEM.length + prompt.length, maxOutputTokens: TABLE_OUTPUT }]);
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseTableReply(await gemini({ system: EDIT_SYSTEM, prompt, json: true, temperature: 0.3, maxOutputTokens: TABLE_OUTPUT }, meter));
      if (!reply) fail("invalid_argument", "Foli AI couldn't change the table that way. Try saying it another way.");
      return reply;
    });
  },
});

/** Empty cells filled, typos and formats fixed, repeated rows removed. */
export const clean = action({
  args: placeArgs,
  handler: async (ctx, args): Promise<{ rows: string[][]; summary: string }> => {
    await requireIdentity(ctx);
    const t = tableOf(args);
    const prompt = `${asTable(t)}\n\nClean up this table.`;
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: CLEAN_SYSTEM.length + prompt.length, maxOutputTokens: TABLE_OUTPUT }]);
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseTableReply(await gemini({ system: CLEAN_SYSTEM, prompt, json: true, temperature: 0.2, maxOutputTokens: TABLE_OUTPUT }, meter));
      if (!reply) fail("invalid_argument", "Foli AI couldn't clean up the table. Try again.");
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
    if (!instruction) fail("invalid_argument", "Say what the formula should work out.");
    const t = tableOf(args);
    const row = Math.trunc(args.row);
    const column = Math.trunc(args.column);
    if (row < 0 || column < 0 || row >= t.rows.length || column >= (t.rows[0]?.length ?? 0)) fail("invalid_argument", "Pick a cell of the table first.");
    const ref = cellReference(row, column);
    const prompt = `${asTable(t)}\n\nWrite the formula for cell ${ref} (row ${row + 1}, column ${column + 1}).\n\nIt should work out: ${instruction}`;
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: FORMULA_SYSTEM.length + prompt.length, maxOutputTokens: 1024 }]);
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseFormulaReply(await gemini({ system: FORMULA_SYSTEM, prompt, json: true, temperature: 0.2, maxOutputTokens: 1024 }, meter), t, row, column);
      if (!reply) fail("invalid_argument", "Foli AI couldn't write a working formula for that. Try saying it another way.");
      return reply;
    });
  },
});

/** What the table says: a summary and a few takeaways. */
export const explain = action({
  args: placeArgs,
  handler: async (ctx, args): Promise<{ summary: string; points: string[] }> => {
    await requireIdentity(ctx);
    const t = tableOf(args);
    const prompt = `${asTable(t)}\n\nExplain this table.`;
    const holdId = await hold(ctx, args, [{ fast: false, inputChars: EXPLAIN_SYSTEM.length + prompt.length, maxOutputTokens: 1024 }]);
    return await metered(ctx, holdId, async (meter) => {
      const reply = parseExplainReply(await gemini({ system: EXPLAIN_SYSTEM, prompt, json: true, temperature: 0.4, maxOutputTokens: 1024 }, meter));
      if (!reply) fail("invalid_argument", "Foli AI couldn't explain the table. Try again.");
      return reply;
    });
  },
});
