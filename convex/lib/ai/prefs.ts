// A person's AI settings (Settings > AI). Each one is stored on their profile (unset = the default) and
// enforced on the server wherever the feature runs. Some belong to later milestones of
// docs/AI_ASSISTANT.md and are stored now so the switch is there when the feature lands.
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
}

export const AI_PREF_DEFAULTS: AiPrefs = { history: true, memory: true, suggestions: true, attachments: true, webResearch: true, digests: false };

/** The profile field each setting is stored in. */
const FIELDS = {
  history: "aiHistory",
  memory: "aiMemory",
  suggestions: "aiSuggestions",
  attachments: "aiAttachments",
  webResearch: "aiWebResearch",
  digests: "aiDigests",
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
