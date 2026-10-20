// Pure helpers for AI conversations (convex/aiChat.ts): what a conversation is about, titles, finding
// the block a citation points at, and the Markdown export. Shared with the local backend
// (packages/ai-prompts chat.ts); the validator for a conversation's context is the server's.
import { v, type Infer } from "convex/values";
import type { AiContext as SharedAiContext } from "@folevi/ai-prompts/chat";

export * from "@folevi/ai-prompts/chat";

/**
 * What a conversation is about: some notes (read in full), one folder (its notes are searched), or the
 * whole scope (Personal or a workspace). Ids are public ids.
 */
export const vAiContext = v.object({
  kind: v.union(v.literal("note"), v.literal("notes"), v.literal("folder"), v.literal("workspace"), v.literal("selection")),
  ids: v.array(v.string()),
});
export type AiContext = Infer<typeof vAiContext>;

/** The validator and the shared type describe the same thing. */
const sameContext: [AiContext, SharedAiContext] extends [SharedAiContext, AiContext] ? true : never = true;
void sameContext;
