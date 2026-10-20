// Changes Ask AI can propose to someone's notes: make a folder, write a note (in a folder), move a note
// into a folder. Ask AI never changes anything itself: it returns these as a proposal, the person checks
// them, and applying them goes through `aiActions.apply`, which checks everything again. The plan's types,
// prompt and check are shared with the local backend (packages/ai-prompts actions.ts); the validator is
// the server's.

import { v, type Infer } from "convex/values";
import type { AiAction as SharedAiAction } from "@folevi/ai-prompts/actions";

export * from "@folevi/ai-prompts/actions";

/** A proposed change, as stored (in a chat message) and sent back to apply. */
export const vAiAction = v.union(
  v.object({ type: v.literal("createFolder"), name: v.string() }),
  v.object({ type: v.literal("createNote"), title: v.string(), markdown: v.string(), folderId: v.optional(v.string()), folderName: v.optional(v.string()) }),
  v.object({ type: v.literal("moveNote"), noteId: v.string(), noteTitle: v.string(), folderId: v.optional(v.string()), folderName: v.optional(v.string()) }),
);

/** The validator and the shared type describe the same thing. */
const sameAction: [Infer<typeof vAiAction>, SharedAiAction] extends [SharedAiAction, Infer<typeof vAiAction>] ? true : never = true;
void sameAction;
