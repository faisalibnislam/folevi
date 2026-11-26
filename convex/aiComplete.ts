// Foli AI's longer next words for the note editor's ghost text (docs/SPELLING_PLAN.md): after a short pause,
// the text around the caret goes to the fast model, which answers with what comes next (a few words). Only
// when Foli AI is on for the person (begin checks it again, with the plan, the scope and the hourly limit),
// and never for an end-to-end encrypted note: the client doesn't ask there, and begin's gate refuses a sealed
// note sent without its device-provided context, which this action never takes.
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireIdentity } from "./lib/auth";
import { fail } from "./lib/errors";
import type { PlannedCall } from "./lib/credits";
import { vScopeArg } from "./lib/scope";
import { gemini, metered } from "./ai";

/** Text before the caret sent, at most (the end of it). */
export const COMPLETE_BEFORE = 1500;
/** Text after the caret sent, at most. */
export const COMPLETE_AFTER = 300;
/** Words in a completion, at most. */
export const COMPLETE_WORDS = 12;

export const COMPLETE_SYSTEM = [
  "You are the autocomplete in a notes app.",
  "Continue the person's text from exactly where their caret is (between <before> and <after>).",
  `Reply with only the words to insert there: at most ${COMPLETE_WORDS} words, in the same language, voice and style, ending at a natural place.`,
  "Start with a space when the text before the caret ends with a whole word; start without one to finish a word that is cut off.",
  "No quotes, no Markdown, no explanation, never a new line. If nothing natural would follow, reply with nothing.",
].join(" ");

/** The model's answer as text to insert: one line, a few words, no quotes. Empty when there is nothing. */
export function cleanCompletion(raw: string, before: string): string {
  let out = raw.replace(/\r?\n[\s\S]*$/, "").replace(/^(\s*)["'“”‘’`]+/, "$1").replace(/["'“”‘’`]+(\s*)$/, "$1");
  // (Some models repeat the end of what they were given.)
  const tail = before.slice(-40);
  if (tail.trim() && out.trimStart().startsWith(tail.trim())) out = out.trimStart().slice(tail.trim().length);
  const words = out.split(/(?<=\S)(?=\s)/);
  out = words.slice(0, COMPLETE_WORDS).join("").replace(/\s+$/, "");
  // Two spaces where the text before already ends in one.
  if (/\s$/.test(before)) out = out.replace(/^\s+/, "");
  return out.length > 200 ? "" : out;
}

export const complete = action({
  args: {
    scope: vScopeArg,
    documentId: v.string(),
    before: v.string(),
    after: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ text: string }> => {
    await requireIdentity(ctx);
    const before = args.before.slice(-COMPLETE_BEFORE);
    const after = (args.after ?? "").slice(0, COMPLETE_AFTER);
    if (before.trim().length < 3) fail("invalid_argument", "Write a little first.");
    const prompt = `${args.language ? `Language: ${args.language.slice(0, 20)}\n` : ""}<before>${before}</before><after>${after}</after>`;
    const plan: PlannedCall[] = [{ fast: true, inputChars: COMPLETE_SYSTEM.length + prompt.length, maxOutputTokens: 48 }];
    const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: true, plan, feature: "writing" });
    return await metered(ctx, holdId, async (meter) => {
      const raw = await gemini({ system: COMPLETE_SYSTEM, prompt, fast: true, temperature: 0.2, maxOutputTokens: 48 }, meter);
      return { text: cleanCompletion(raw, before) };
    });
  },
});
