// What Foli AI offers in local mode, per feature, for the model that's active (docs/LOCAL_MODE_PLAN.md §5.1,
// R10). The interface asks before it shows an entry point, so a feature the model can't do never appears.
//
// Apple's on-device model is small (about 4,000 tokens for question and answer together): it does writing help,
// questions about notes, catch-up briefs, chats, translations a piece at a time, and the smaller block tools.
// Big structured answers (wireframes, flowcharts, plans that change notes) need more room than it has, and
// long notes are cut to what fits. A person's own key does everything local mode has. Features that only
// Folevi's servers can do (the agent, research, the web, reading attachments and recordings, digests,
// routines, search by meaning, suggestions) are off here whatever the model.
import type { AiProviderId } from "@/lib/shell/types";

export const AI_FEATURES = [
  // Writing help on a selection or a note (ai.write).
  "write",
  // Whole long notes read in full (otherwise they're cut to what the model takes).
  "longNotes",
  // Ask about notes, Catch me up, chats (ai.ask, ai.brief, aiChat).
  "ask",
  "brief",
  "chat",
  // Proposed changes to notes from a chat (folders, new notes, moves; aiActions.apply).
  "actions",
  // Remembered preferences offered from a chat (aiMemory).
  "memory",
  // Translating a whole note (aiStudy.translateNote) and finding to-dos (aiTodos.find).
  "translate",
  "findTodos",
  // The blocks' own Foli AI.
  "mindmap",
  "mindmapFile",
  "stickies",
  "stickiesPhoto",
  "table",
  "chart",
  "wireframe",
  "flowchart",
  // A flowchart explained in words and clearer labels: small answers, so the on-device model does them too
  // (drawing, extending and arranging a chart are "flowchart").
  "flowchartExplain",
  // Server only.
  "agent",
  "research",
  "web",
  "attachments",
  "transcription",
  "digest",
  "routines",
  "semanticSearch",
  "suggestions",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];
export type AiFeatures = Readonly<Record<AiFeature, boolean>>;

const SERVER_ONLY: ReadonlySet<AiFeature> = new Set<AiFeature>(["agent", "research", "web", "attachments", "transcription", "digest", "routines", "semanticSearch", "suggestions", "mindmapFile", "stickiesPhoto"]);
/** What Apple's model can't fit: big JSON answers, plans that carry whole notes, long notes in full. */
const TOO_BIG_ON_DEVICE: ReadonlySet<AiFeature> = new Set<AiFeature>(["wireframe", "flowchart", "actions", "longNotes"]);

const all = (on: boolean): AiFeatures => Object.fromEntries(AI_FEATURES.map((f) => [f, on])) as Record<AiFeature, boolean>;

/** Account mode: every feature (the server decides the rest). */
export const ACCOUNT_FEATURES: AiFeatures = all(true);
/** Local mode with no model: nothing. */
export const NO_FEATURES: AiFeatures = all(false);

/** What local mode offers with this provider active (null: none is). */
export function featuresFor(provider: AiProviderId | null): AiFeatures {
  if (!provider) return NO_FEATURES;
  return Object.fromEntries(AI_FEATURES.map((f) => [f, !SERVER_ONLY.has(f) && !(provider === "on-device" && TOO_BIG_ON_DEVICE.has(f))])) as Record<AiFeature, boolean>;
}
