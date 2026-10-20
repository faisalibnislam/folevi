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
import { parseStickies } from "@folevi/editor-schema";
import type { PromptRequest } from "@folevi/ai-prompts";
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
  MAX_PHOTO_BASE64,
  MAX_TASKS,
  PHOTO_TYPES,
  STICKIES_MESSAGES,
  boardForPrompt,
  boardSummaryRequest,
  boardTasksRequest,
  clusterRequest,
  ideasRequest,
  labelledGroups,
  parseClusters,
  parseIdeas,
  parsePhotoNotes,
  parseSummary,
  parseTasks,
  parseWriteUp,
  photoRequest,
  promptBoardOf,
  writeUpRequest,
  type PromptBoard,
} from "./lib/stickiesAi";

const vWhere = { scope: vScopeArg, documentId: v.optional(v.string()), board: v.string() };

interface Call<T> {
  /** The request (packages/ai-prompts stickies.ts). */
  request: PromptRequest;
  feature: AiFeature;
  attachments?: Part[];
  /** Characters the attachments count as, for the hold (a photo's tokens, as characters). */
  extraChars?: number;
  parse: (raw: string) => T | null;
  failure: string;
}

/**
 * One Foli AI call for a board: the gates and the hold (ai.begin: in the note's own scope when it's named),
 * the call, the reply checked, and the credits settled however it ends.
 */
async function run<T>(ctx: ActionCtx, where: { scope: ScopeArg; documentId?: string }, call: Call<T>): Promise<T> {
  const req = call.request;
  const plan: PlannedCall[] = [{ fast: false, inputChars: req.system.length + req.prompt.length + (call.extraChars ?? 0), maxOutputTokens: req.maxOutputTokens ?? 0 }];
  const note = where.documentId ? { documentId: where.documentId, noteOnly: true } : null;
  const { holdId } = await ctx.runMutation(internal.ai.begin, { feature: call.feature, scope: where.scope, plan, ...note });
  return await metered(ctx, holdId, async (meter) => {
    const raw = await gemini({ ...req, ...(call.attachments ? { attachments: call.attachments } : {}) }, meter);
    const out = call.parse(raw);
    if (out === null) fail("invalid_argument", call.failure);
    return out;
  });
}

/** The board for a prompt, or a refusal when it has nothing to work with. */
function promptBoard(data: string, min: number, only?: readonly string[]): PromptBoard {
  const b = promptBoardOf(data, min, only);
  if ("refusal" in b) fail("invalid_argument", b.refusal);
  return b.board;
}

/** Group the notes by theme. */
export const cluster = action({
  args: vWhere,
  handler: async (ctx, args): Promise<{ groups: { label: string; ids: string[] }[] }> => {
    await requireIdentity(ctx);
    const b = promptBoard(args.board, 2);
    const groups = await run(ctx, args, {
      request: clusterRequest(b),
      feature: "writing",
      parse: (raw) => parseClusters(raw, b.ids),
      failure: STICKIES_MESSAGES.clusterFailed,
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
      request: boardSummaryRequest(b),
      feature: "writing",
      parse: parseSummary,
      failure: STICKIES_MESSAGES.summaryFailed,
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
    if (!b && !instruction) fail("invalid_argument", STICKIES_MESSAGES.noTopic);
    const existing = parseStickies(args.board.slice(0, 250_000)).notes.map((n) => n.text);
    const ideas = await run(ctx, args, {
      request: ideasRequest(b, instruction),
      feature: "writing",
      parse: (raw) => parseIdeas(raw, existing),
      failure: STICKIES_MESSAGES.ideasFailed,
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
    if (!(PHOTO_TYPES as readonly string[]).includes(mimeType)) fail("unsupported_file", STICKIES_MESSAGES.badPhotoType);
    if (!data || data.length > MAX_PHOTO_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(-64))) fail("invalid_argument", STICKIES_MESSAGES.photoTooLarge);
    if (!(await ctx.runQuery(internal.stickiesAi.photoAllowed, {}))) fail("forbidden", ATTACHMENTS_OFF);
    if (!capabilities().vision) fail("unsupported_file", STICKIES_MESSAGES.noVision);
    const notes = await run(ctx, args, {
      request: photoRequest(),
      attachments: [{ inlineData: { mimeType, data } }],
      extraChars: attachmentTokens("image", data.length) * 4,
      feature: "attachments",
      parse: parsePhotoNotes,
      failure: STICKIES_MESSAGES.photoFailed,
    });
    return { notes };
  },
});

/** Chosen notes as clear to-dos. */
export const tasks = action({
  args: { ...vWhere, noteIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ tasks: { noteId: string; text: string; owner: string | null }[] }> => {
    await requireIdentity(ctx);
    if (!args.noteIds.length) fail("invalid_argument", STICKIES_MESSAGES.chooseNotes);
    const b = promptBoard(args.board, 1, args.noteIds.slice(0, MAX_TASKS));
    const tasks = await run(ctx, args, {
      request: boardTasksRequest(b),
      feature: "writing",
      parse: (raw) => parseTasks(raw, b.ids),
      failure: STICKIES_MESSAGES.tasksFailed,
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
    return await run(ctx, args, {
      request: writeUpRequest(b, labelledGroups(args.board)),
      feature: "writing",
      parse: parseWriteUp,
      failure: STICKIES_MESSAGES.writeUpFailed,
    });
  },
});
