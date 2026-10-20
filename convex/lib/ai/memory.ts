// Memory (docs/AI_ASSISTANT.md, "Memory, suggestions, digests"): preferences the person approved (tone,
// language, length, terms, standing instructions), kept in `aiMemories` (convex/aiMemory.ts). The kinds and
// limits, the block of preferences every prompt gets, and the marker the chat model uses to propose one
// (it's only saved when the person clicks Save) are pure and shared with the local backend
// (packages/ai-prompts memory.ts). This file adds the validator and how memory rides on a request's meter.
//
// How memory reaches the model: `metered` (convex/ai.ts) looks up the preferences for the request's credit
// hold and attaches them to the request's meter; the provider layer (lib/ai/provider.ts) adds them to the
// system prompt of every call made with that meter, except quick plumbing calls (fast and JSON, such as
// turning a question into search terms) and calls that copy content out of files (`noMemory`). Memory text is the person's own words, so it's labelled as their
// preferences and can't override the app's rules.
import { v } from "convex/values";
import type { CallUsage } from "../credits";
import type { GenerateRequest } from "./provider";

export * from "@folevi/ai-prompts/memory";

export const vMemoryKind = v.union(v.literal("tone"), v.literal("language"), v.literal("length"), v.literal("term"), v.literal("instruction"));

// ---------------------------------------------------------------------------------------------------
// A request's memory, carried on its meter (set by `metered`, read by the provider layer)
// ---------------------------------------------------------------------------------------------------

const KEY = "__foleviMemory";

/** Attaches the preferences block to a request's meter (not enumerable: never stored or settled). */
export function setMeterMemory(meter: CallUsage[], text: string | null): void {
  Object.defineProperty(meter, KEY, { value: text, enumerable: false, configurable: true, writable: true });
}

export function meterMemory(meter: CallUsage[]): string | null {
  const value = (meter as unknown as Record<string, unknown>)[KEY];
  return typeof value === "string" && value ? value : null;
}

/** The request with the person's preferences added to its system prompt, when it should have them. */
export function withMemory(req: GenerateRequest, meter: CallUsage[]): GenerateRequest {
  const memory = meterMemory(meter);
  if (!memory || req.noMemory || (req.fast && req.json)) return req;
  return { ...req, system: `${req.system}\n\n${memory}` };
}
