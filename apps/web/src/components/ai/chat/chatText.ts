// Small, pure pieces of the AI chat (convex/aiChat.ts): words for what the assistant is doing, a stored
// refusal as the panels show it, and what a conversation is about.
import type { AiProblem } from "../AiCredits";

/** What a conversation is about, as the server stores it (public ids). */
export interface ChatContext {
  kind: "note" | "notes" | "folder" | "workspace" | "selection";
  ids: string[];
}

export const WHOLE_SCOPE: ChatContext = { kind: "workspace", ids: [] };
export const MAX_CONTEXT_NOTES = 5;

/** The status line while an answer is on its way. */
export function phaseLabel(phase: string | null, hasText: boolean): string {
  if (hasText) return "Writing…";
  switch (phase) {
    case "searching":
      return "Searching your notes…";
    case "reading":
      return "Reading your notes…";
    case "writing":
      return "Writing…";
    default:
      return "Thinking…";
  }
}

/** A refusal stored on an answer, as the AI panels show it (with Upgrade or Buy more when that helps). */
export function storedProblem(error: { code: string; message: string; action?: string; reason?: string }): AiProblem {
  if (error.code === "out_of_credits") return { message: error.message, kind: "out_of_credits", action: error.action === "buy" || error.action === "upgrade" ? error.action : "none" };
  if (error.code === "forbidden" && error.reason === "ai_not_included") return { message: error.message, kind: "not_included", action: "none" };
  return { message: error.message, kind: "other", action: "none" };
}

/** Adds a note to a context (a few at most); a folder or the whole scope becomes just that note. */
export function withNote(context: ChatContext, id: string): ChatContext {
  const ids = context.kind === "note" || context.kind === "notes" ? [...context.ids.filter((x) => x !== id), id].slice(-MAX_CONTEXT_NOTES) : [id];
  return { kind: ids.length === 1 ? "note" : "notes", ids };
}

/** Removes a note or the folder from a context; nothing left means the whole scope. */
export function without(context: ChatContext, id: string): ChatContext {
  const ids = context.ids.filter((x) => x !== id);
  if (!ids.length || context.kind === "folder") return WHOLE_SCOPE;
  return { kind: ids.length === 1 ? "note" : "notes", ids };
}

/** Where a citation opens: the note, at the block it matched when there is one. */
export function citationHref(c: { noteId: string; blockId?: string }): string {
  return `/d/${encodeURIComponent(c.noteId)}${c.blockId ? `#block-${encodeURIComponent(c.blockId)}` : ""}`;
}
