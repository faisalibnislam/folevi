// Foli AI for sticky notes boards (docs/VISUAL_BLOCKS_PLAN.md, "Sticky notes block"):
//
//   stickiesAi.cluster:   group the notes by theme (labelled groups of the board's own note ids)
//   stickiesAi.summarize: a short summary of the board
//   stickiesAi.ideas:     new ideas that fit the board, as notes
//   stickiesAi.photo:     a photo of paper sticky notes read into notes, one per note with its colour
//                         (Gemini vision; the device makes the photo smaller first)
//   stickiesAi.tasks:     chosen notes as clear to-dos (the client adds them to the note as to-do blocks)
//   stickiesAi.writeUp:   the board as a note section: a heading, a summary and next steps
//
// Each is one Gemini call, in the note's scope when the note is named (so a note from a Core scope is never
// sent), held and settled through ai.begin and metered like every Foli AI request (lib/credits.ts): AI off,
// Core, the hourly limit and running out of credits are all refused before anything is sent. The board
// comes from the client (it may hold changes not saved yet) and is read with the forgiving reader; the
// model's JSON is checked in lib/stickiesAi.ts before it's returned, and nothing is stored here: the board
// changes only when the person applies the result in the note (one undo step). Prompts, notes and photos
// are never logged.
import { v } from "convex/values";
import { action, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseStickies, stickiesByGroup } from "@folevi/editor-schema";
import { requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg, type ScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { aiPrefsOf } from "./lib/ai/prefs";
import { attachmentTokens } from "./lib/ai/attachments";
import { ATTACHMENTS_OFF } from "./lib/ai/attachmentFiles";
import { capabilities, type Part } from "./lib/ai/provider";
import type { AiFeature } from "./lib/ai/usage";
import { gemini, metered, MAX_QUESTION } from "./ai";
import {
  CLUSTER_SYSTEM,
  IDEAS_SYSTEM,
  MAX_PHOTO_BASE64,
  MAX_TASKS,
  PHOTO_SYSTEM,
  PHOTO_TYPES,
  SUMMARY_SYSTEM,
  TASKS_SYSTEM,
  WRITE_UP_SYSTEM,
  boardForPrompt,
  parseClusters,
  parseIdeas,
  parsePhotoNotes,
  parseSummary,
  parseTasks,
  parseWriteUp,
  type PromptBoard,
} from "./lib/stickiesAi";

const vWhere = { scope: vScopeArg, documentId: v.optional(v.string()), board: v.string() };

interface Call<T> {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  feature: AiFeature;
  attachments?: Part[];
  /** Characters the attachments count as, for the hold (a photo's tokens, as characters). */
  extraChars?: number;
  temperature?: number;
  parse: (raw: string) => T | null;
  failure: string;
}

/**
 * One Foli AI call for a board: the gates and the hold (ai.begin: in the note's own scope when it's named),
 * the call, the reply checked, and the credits settled however it ends.
 */
async function run<T>(ctx: ActionCtx, where: { scope: ScopeArg; documentId?: string }, call: Call<T>): Promise<T> {
  const plan: PlannedCall[] = [{ fast: false, inputChars: call.system.length + call.prompt.length + (call.extraChars ?? 0), maxOutputTokens: call.maxOutputTokens }];
  const note = where.documentId ? { documentId: where.documentId, noteOnly: true } : null;
  const { holdId } = await ctx.runMutation(internal.ai.begin, { feature: call.feature, scope: where.scope, plan, ...note });
  return await metered(ctx, holdId, async (meter) => {
    const raw = await gemini({ system: call.system, prompt: call.prompt, json: true, temperature: call.temperature ?? 0.4, maxOutputTokens: call.maxOutputTokens, ...(call.attachments ? { attachments: call.attachments, noMemory: true } : {}) }, meter);
    const out = call.parse(raw);
    if (out === null) fail("invalid_argument", call.failure);
    return out;
  });
}

/** The board for a prompt, or a refusal when it has nothing to work with. */
function promptBoard(data: string, min: number, only?: readonly string[]): PromptBoard {
  const b = boardForPrompt(data, only);
  if (!b || b.ids.size < min) fail("invalid_argument", min > 1 ? `Add at least ${min} notes with text first.` : "Write something on a note first.");
  return b;
}

const boardBlock = (b: PromptBoard) => `<board notes="${b.count}">\n${b.text}\n</board>${b.ids.size < b.count ? `\nOnly ${b.ids.size} of the board's ${b.count} notes are shown.` : ""}`;

/** Group the notes by theme. */
export const cluster = action({
  args: vWhere,
  handler: async (ctx, args): Promise<{ groups: { label: string; ids: string[] }[] }> => {
    await requireIdentity(ctx);
    const b = promptBoard(args.board, 2);
    const groups = await run(ctx, args, {
      system: CLUSTER_SYSTEM,
      prompt: `${boardBlock(b)}\n\nGroup these notes by theme.`,
      maxOutputTokens: 4096,
      feature: "writing",
      temperature: 0.3,
      parse: (raw) => parseClusters(raw, b.ids),
      failure: "Foli AI couldn't group these notes. Try again.",
    });
    return { groups };
  },
});

/** A short summary of the board. */
export const summarize = action({
  args: vWhere,
  handler: async (ctx, args): Promise<{ summary: string }> => {
    await requireIdentity(ctx);
    const b = promptBoard(args.board, 1);
    const summary = await run(ctx, args, {
      system: SUMMARY_SYSTEM,
      prompt: `${boardBlock(b)}\n\nSummarise this board.`,
      maxOutputTokens: 2048,
      feature: "writing",
      parse: parseSummary,
      failure: "Foli AI couldn't summarise this board. Try again.",
    });
    return { summary };
  },
});

/** New ideas that fit the board (optionally about something). */
export const ideas = action({
  args: { ...vWhere, instruction: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ideas: { text: string; color: string }[] }> => {
    await requireIdentity(ctx);
    const instruction = (args.instruction ?? "").trim().slice(0, MAX_QUESTION);
    const b = boardForPrompt(args.board);
    if (!b && !instruction) fail("invalid_argument", "Say what the ideas should be about.");
    const existing = parseStickies(args.board.slice(0, 250_000)).notes.map((n) => n.text);
    const ideas = await run(ctx, args, {
      system: IDEAS_SYSTEM,
      prompt: `${b ? boardBlock(b) : "The board is empty."}\n\n${instruction ? `Suggest new ideas about: ${instruction}` : "Suggest new ideas for this board."}`,
      maxOutputTokens: 2048,
      feature: "writing",
      temperature: 0.8,
      parse: (raw) => parseIdeas(raw, existing),
      failure: "Foli AI couldn't come up with new ideas. Try again.",
    });
    return { ideas };
  },
});

/** Whether the person lets Foli AI read files and photos (Settings > AI). */
export const photoAllowed = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => aiPrefsOf(await requireProfile(ctx)).attachments,
});

/** A photo of paper sticky notes, read into notes (one per paper note, with its colour). */
export const photo = action({
  args: { scope: vScopeArg, documentId: v.optional(v.string()), image: v.object({ mimeType: v.string(), data: v.string() }) },
  handler: async (ctx, args): Promise<{ notes: { text: string; color: string }[] }> => {
    await requireIdentity(ctx);
    const { mimeType, data } = args.image;
    if (!(PHOTO_TYPES as readonly string[]).includes(mimeType)) fail("unsupported_file", "Use a JPEG, PNG or WebP photo.");
    if (!data || data.length > MAX_PHOTO_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(-64))) fail("invalid_argument", "That photo is too large. Try a smaller one.");
    if (!(await ctx.runQuery(internal.stickiesAi.photoAllowed, {}))) fail("forbidden", ATTACHMENTS_OFF);
    if (!capabilities().vision) fail("unsupported_file", "Foli AI can't read photos right now.");
    const notes = await run(ctx, args, {
      system: PHOTO_SYSTEM,
      prompt: "Read the sticky notes in this photo.",
      attachments: [{ inlineData: { mimeType, data } }],
      extraChars: attachmentTokens("image", data.length) * 4,
      maxOutputTokens: 6144,
      feature: "attachments",
      temperature: 0,
      parse: parsePhotoNotes,
      failure: "Foli AI couldn't read that photo. Try a sharper one, taken straight on.",
    });
    return { notes };
  },
});

/** Chosen notes as clear to-dos. */
export const tasks = action({
  args: { ...vWhere, noteIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ tasks: { noteId: string; text: string; owner: string | null }[] }> => {
    await requireIdentity(ctx);
    if (!args.noteIds.length) fail("invalid_argument", "Choose the notes to turn into tasks.");
    const b = promptBoard(args.board, 1, args.noteIds.slice(0, MAX_TASKS));
    const tasks = await run(ctx, args, {
      system: TASKS_SYSTEM,
      prompt: `${boardBlock(b)}\n\nTurn each of these notes into a to-do.`,
      maxOutputTokens: 4096,
      feature: "writing",
      temperature: 0.3,
      parse: (raw) => parseTasks(raw, b.ids),
      failure: "Foli AI couldn't turn these notes into tasks. Try again.",
    });
    return { tasks };
  },
});

/** The board as a note section: a heading, a summary and next steps. */
export const writeUp = action({
  args: vWhere,
  handler: async (ctx, args): Promise<{ title: string; summary: string; nextSteps: string[] }> => {
    await requireIdentity(ctx);
    const b = promptBoard(args.board, 1);
    const groups = stickiesByGroup(parseStickies(args.board.slice(0, 250_000))).filter((g) => g.group?.label).length;
    return await run(ctx, args, {
      system: WRITE_UP_SYSTEM,
      prompt: `${boardBlock(b)}\n\nWrite this board up${groups ? ` (it has ${groups} labelled groups)` : ""}.`,
      maxOutputTokens: 3072,
      feature: "writing",
      parse: parseWriteUp,
      failure: "Foli AI couldn't write this board up. Try again.",
    });
  },
});
