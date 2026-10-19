// Foli AI for the wireframe block (docs/VISUAL_BLOCKS_PLAN.md, "Wireframe block"; lib/wireframeAi.ts holds
// the prompt and the checks on what comes back):
//
//   draw:    a screen (or a short flow of up to four) from a description: "a sign-up screen with a
//            Google button".
//   vary:    two or three different takes on one screen, optionally steered ("try a card layout").
//   refine:  one screen changed as asked ("add a forgot password link"), keeping what wasn't mentioned.
//
// Every action goes through the same gates and credits as the rest of Foli AI (ai.begin: AI on, not in a
// Core scope, the hourly limit, a hold on the estimate; ai.metered settles what Gemini counted). A request
// made from a note is made in that note's scope. What's returned is the block's own data (screens laid side
// by side from 0, 0), already through the server's strict check; the client checks it again, places it and
// applies it as one undo step. Prompts, screens and replies are never logged or stored.
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { WireframeData } from "@folevi/editor-schema";
import { requireIdentity } from "./lib/auth";
import { fail } from "./lib/errors";
import { vScopeArg, type ScopeArg } from "./lib/scope";
import type { PlannedCall } from "./lib/credits";
import { AI_MAX_SCREENS, AI_MAX_VARIATIONS, WIREFRAME_SYSTEM, parseWireframeReply, screenForPrompt } from "./lib/wireframeAi";
import { gemini, metered } from "./ai";

const MAX_INSTRUCTION = 2000;
/** Output room per screen asked for (a screen of 60 parts is about 4,000 tokens of JSON). */
const OUTPUT_PER_SCREEN = 4096;

const vFrame = v.union(v.literal("phone"), v.literal("tablet"), v.literal("browser"), v.literal("plain"));
/** Where a request is made from: the scope, and the note the block is in (the request is made in its scope). */
const placeArgs = { scope: vScopeArg, documentId: v.optional(v.string()) };

async function hold(ctx: ActionCtx, args: { scope: ScopeArg; documentId?: string }, plan: PlannedCall[]): Promise<Id<"aiCreditHolds">> {
  const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing" });
  return holdId;
}

const cleanInstruction = (s: string | undefined) => (s ?? "").trim().slice(0, MAX_INSTRUCTION);

/** Asks Gemini for screens and reads the reply (refused with a plain message when nothing usable came back). */
async function ask(ctx: ActionCtx, holdId: Id<"aiCreditHolds">, prompt: string, screens: number, opts: { frame?: "phone" | "tablet" | "browser" | "plain"; temperature: number }): Promise<WireframeData> {
  const maxOutputTokens = Math.min(16_384, OUTPUT_PER_SCREEN * screens);
  return await metered(ctx, holdId, async (meter) => {
    const raw = await gemini({ system: WIREFRAME_SYSTEM, prompt, json: true, temperature: opts.temperature, maxOutputTokens }, meter);
    const wf = parseWireframeReply(raw, { frame: opts.frame, maxScreens: screens });
    if (!wf) fail("invalid_argument", "Foli AI couldn't draw that. Try describing the screen and what's on it.");
    return wf;
  });
}

const plan = (prompt: number, screens: number): PlannedCall[] => [{ fast: false, inputChars: WIREFRAME_SYSTEM.length + prompt + 300, maxOutputTokens: Math.min(16_384, OUTPUT_PER_SCREEN * screens) }];

/** A new screen (or a short flow) from a description. */
export const draw = action({
  args: { ...placeArgs, instruction: v.string(), frame: v.optional(vFrame) },
  handler: async (ctx, args): Promise<WireframeData> => {
    await requireIdentity(ctx);
    const instruction = cleanInstruction(args.instruction);
    if (!instruction) fail("invalid_argument", "Describe the screen first.");
    const frame = args.frame ?? "phone";
    const prompt = `Draw the screen the person describes as a ${frame} screen. If they describe a flow of several screens, draw each (at most ${AI_MAX_SCREENS}) and link them in order.\n\nRequest: ${instruction}`;
    const holdId = await hold(ctx, args, plan(prompt.length, AI_MAX_SCREENS));
    return await ask(ctx, holdId, prompt, AI_MAX_SCREENS, { frame, temperature: 0.5 });
  },
});

/** Two or three variations of one screen (`screen` is the screen and its parts as wireframe JSON). */
export const vary = action({
  args: { ...placeArgs, screen: v.string(), count: v.optional(v.number()), instruction: v.optional(v.string()) },
  handler: async (ctx, args): Promise<WireframeData> => {
    await requireIdentity(ctx);
    const current = screenForPrompt(args.screen);
    if (!current) fail("invalid_argument", "Pick a screen to vary first.");
    const count = Math.max(2, Math.min(AI_MAX_VARIATIONS, Math.round(args.count ?? 3)));
    const instruction = cleanInstruction(args.instruction);
    const prompt = `<wireframe>\n${current.prompt}\n</wireframe>\n\nMake ${count} different variations of this ${current.frame} screen, each its own screen with the same purpose and content but a clearly different layout or approach. Name them "${(current.name || "Screen").slice(0, 60)} A", "B" and so on. Don't link them.${instruction ? `\n\nAlso: ${instruction}` : ""}`;
    const holdId = await hold(ctx, args, plan(prompt.length, count));
    return await ask(ctx, holdId, prompt, count, { frame: current.frame, temperature: 0.9 });
  },
});

/** One screen changed as asked; everything not mentioned stays as it was. */
export const refine = action({
  args: { ...placeArgs, screen: v.string(), instruction: v.string() },
  handler: async (ctx, args): Promise<WireframeData> => {
    await requireIdentity(ctx);
    const instruction = cleanInstruction(args.instruction);
    if (!instruction) fail("invalid_argument", "Say what to change.");
    const current = screenForPrompt(args.screen);
    if (!current) fail("invalid_argument", "Pick a screen to refine first.");
    const prompt = `<wireframe>\n${current.prompt}\n</wireframe>\n\nChange this screen as the person asks, and return the complete updated screen (one screen, the same frame). Keep the text, positions and options of everything they didn't ask to change; move parts only to make room.\n\nRequest: ${instruction}`;
    const holdId = await hold(ctx, args, plan(prompt.length, 1));
    return await ask(ctx, holdId, prompt, 1, { frame: current.frame, temperature: 0.3 });
  },
});
