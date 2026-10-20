// A person's AI settings (Settings > AI). Each one is stored on their profile (unset = the default) and
// enforced on the server wherever the feature runs (memory: convex/aiMemory.ts, suggestions:
// convex/aiSuggestions.ts, digests: convex/aiDigest.ts).
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";

export interface AiPrefs {
  /** Conversations are saved until deleted. Off: a conversation lasts only while its chat is open. */
  history: boolean;
  /** The assistant remembers what you approved (tone, terms, instructions). */
  memory: boolean;
  /** Quiet suggestions (related notes, duplicates, open questions). */
  suggestions: boolean;
  /** The assistant may read files you attach (PDFs, images, spreadsheets). */
  attachments: boolean;
  /** The assistant may search the web when you ask it to. */
  webResearch: boolean;
  /** Recurring summaries of your notes. */
  digests: boolean;
  /**
   * Foli AI reads the text in images added on a device that can't read it itself (a browser), so search
   * finds it. Off unless turned on: it uses AI credits (docs/ARCHITECTURE.md, "Search in files").
   */
  readImages: boolean;
  /** The iPhone, iPad and Mac apps read the text in images and handwriting on the device (nothing is sent). */
  deviceText: boolean;
}

export const AI_PREF_DEFAULTS: AiPrefs = { history: true, memory: true, suggestions: true, attachments: true, webResearch: true, digests: false, readImages: false, deviceText: true };

/** The profile field each setting is stored in. */
const FIELDS = {
  history: "aiHistory",
  memory: "aiMemory",
  suggestions: "aiSuggestions",
  attachments: "aiAttachments",
  webResearch: "aiWebResearch",
  digests: "aiDigests",
  readImages: "aiReadImages",
  deviceText: "deviceImageText",
} as const satisfies Record<keyof AiPrefs, keyof Doc<"profiles">>;

/** A person's AI settings, defaults filled in. */
export function aiPrefsOf(profile: Pick<Doc<"profiles">, (typeof FIELDS)[keyof AiPrefs]>): AiPrefs {
  const out = { ...AI_PREF_DEFAULTS };
  for (const key of Object.keys(FIELDS) as (keyof AiPrefs)[]) {
    const stored = profile[FIELDS[key]];
    if (typeof stored === "boolean") out[key] = stored;
  }
  return out;
}

/** A change to some of the settings, as clients send it. */
export const vAiPrefsPatch = v.object({
  history: v.optional(v.boolean()),
  memory: v.optional(v.boolean()),
  suggestions: v.optional(v.boolean()),
  attachments: v.optional(v.boolean()),
  webResearch: v.optional(v.boolean()),
  digests: v.optional(v.boolean()),
  readImages: v.optional(v.boolean()),
  deviceText: v.optional(v.boolean()),
});

/** The profile fields to patch for a change. */
export function aiPrefsPatch(patch: Partial<AiPrefs>): Partial<Doc<"profiles">> {
  const out: Partial<Doc<"profiles">> = {};
  for (const key of Object.keys(FIELDS) as (keyof AiPrefs)[]) {
    const value = patch[key];
    if (typeof value === "boolean") (out as Record<string, boolean>)[FIELDS[key]] = value;
  }
  return out;
}
