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
import type { PromptRequest } from "@folevi/ai-prompts";
import {
  AI_MAX_SCREENS,
  MAX_INSTRUCTION,
  WIREFRAME_MESSAGES,
  drawRequest,
  parseWireframeReply,
  refineRequest,
  screenForPrompt,
  variationCount,
  varyRequest,
} from "./lib/wireframeAi";
import { gemini, metered, providedArgs } from "./ai";
import { vProvidedContext, type ProvidedContext } from "./lib/e2ee/ai";

const vFrame = v.union(v.literal("phone"), v.literal("tablet"), v.literal("browser"), v.literal("plain"));
/** Where a request is made from: the scope, and the note the block is in (the request is made in its scope). */
const placeArgs = { scope: vScopeArg, documentId: v.optional(v.string()), provided: v.optional(vProvidedContext) };

async function hold(ctx: ActionCtx, args: { scope: ScopeArg; documentId?: string; provided?: ProvidedContext }, plan: PlannedCall[]): Promise<Id<"aiCreditHolds">> {
  const { holdId } = await ctx.runMutation(internal.ai.begin, { scope: args.scope, documentId: args.documentId, noteOnly: Boolean(args.documentId), plan, feature: "writing", ...providedArgs(args.provided) });
  return holdId;
}

const cleanInstruction = (s: string | undefined) => (s ?? "").trim().slice(0, MAX_INSTRUCTION);

/** Asks Gemini for screens and reads the reply (refused with a plain message when nothing usable came back). */
async function ask(ctx: ActionCtx, holdId: Id<"aiCreditHolds">, req: PromptRequest, screens: number, frame?: "phone" | "tablet" | "browser" | "plain"): Promise<WireframeData> {
  return await metered(ctx, holdId, async (meter) => {
    const raw = await gemini(req, meter);
    const wf = parseWireframeReply(raw, { frame, maxScreens: screens });
    if (!wf) fail("invalid_argument", WIREFRAME_MESSAGES.failed);
    return wf;
  });
}

const plan = (req: PromptRequest): PlannedCall[] => [{ fast: false, inputChars: req.system.length + req.prompt.length + 300, maxOutputTokens: req.maxOutputTokens ?? 0 }];

/** A new screen (or a short flow) from a description. */
export const draw = action({
  args: { ...placeArgs, instruction: v.string(), frame: v.optional(vFrame) },
  handler: async (ctx, args): Promise<WireframeData> => {
    await requireIdentity(ctx);
    const instruction = cleanInstruction(args.instruction);
    if (!instruction) fail("invalid_argument", WIREFRAME_MESSAGES.noDescription);
    const frame = args.frame ?? "phone";
    const req = drawRequest(instruction, frame);
    const holdId = await hold(ctx, args, plan(req));
    return await ask(ctx, holdId, req, AI_MAX_SCREENS, frame);
  },
});

/** Two or three variations of one screen (`screen` is the screen and its parts as wireframe JSON). */
export const vary = action({
  args: { ...placeArgs, screen: v.string(), count: v.optional(v.number()), instruction: v.optional(v.string()) },
  handler: async (ctx, args): Promise<WireframeData> => {
    await requireIdentity(ctx);
    const current = screenForPrompt(args.screen);
    if (!current) fail("invalid_argument", WIREFRAME_MESSAGES.noVaryScreen);
    const count = variationCount(args.count);
    const req = varyRequest(current, count, cleanInstruction(args.instruction));
    const holdId = await hold(ctx, args, plan(req));
    return await ask(ctx, holdId, req, count, current.frame);
  },
});

/** One screen changed as asked; everything not mentioned stays as it was. */
export const refine = action({
  args: { ...placeArgs, screen: v.string(), instruction: v.string() },
  handler: async (ctx, args): Promise<WireframeData> => {
    await requireIdentity(ctx);
    const instruction = cleanInstruction(args.instruction);
    if (!instruction) fail("invalid_argument", WIREFRAME_MESSAGES.noChange);
    const current = screenForPrompt(args.screen);
    if (!current) fail("invalid_argument", WIREFRAME_MESSAGES.noRefineScreen);
    const req = refineRequest(current, instruction);
    const holdId = await hold(ctx, args, plan(req));
    return await ask(ctx, holdId, req, 1, current.frame);
  },
});
