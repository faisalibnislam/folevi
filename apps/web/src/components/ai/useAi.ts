"use client";

import { useAction } from "convex/react";
import { useCallback } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import type { Id } from "@/lib/convex/api";

export type AiTask =
  | "improve" | "fix" | "shorter" | "longer" | "simplify" | "professional" | "casual" | "translate" | "explain" | "summarizeText"
  | "summarize" | "continue" | "outline" | "actions" | "title" | "brainstorm" | "draft" | "refine";

/** Selection rewrites (the "AI" menu in the formatting toolbar). */
export const SELECTION_ACTIONS: { task: AiTask; label: string }[] = [
  { task: "improve", label: "Improve writing" },
  { task: "fix", label: "Fix spelling & grammar" },
  { task: "shorter", label: "Make shorter" },
  { task: "longer", label: "Make longer" },
  { task: "simplify", label: "Simplify language" },
  { task: "professional", label: "Sound professional" },
  { task: "casual", label: "Sound casual" },
  { task: "translate", label: "Translate…" },
  { task: "explain", label: "Explain" },
  { task: "summarizeText", label: "Summarize" },
];

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiAccess {
  /** Available here and turned on. */
  on: boolean;
  /** Included where you are: in Personal, your Personal plan (Pro, the Pro trial or a grant from the Folevi
   * team); in a team workspace, that workspace's plan. */
  entitled: boolean;
  /** Your Personal plan includes it (for Settings → Account). */
  personalEntitled: boolean;
  /** Where you are: "personal" (your own Personal), "workspace" (a team workspace) or "shared" (someone else's). */
  context: "personal" | "workspace" | "shared";
  /** You haven't turned it off (Settings → Account). */
  setting: boolean;
}

/** Where a note lives, as documents.get reports it: a team workspace, or someone's Personal (workspaceId null). */
export interface NoteHome {
  workspaceId: string | null;
  ownerProfileId?: string | null;
}

/**
 * AI where you are — the current context (Personal or a team workspace), or `note`'s home (a note may be
 * open from elsewhere: shared from someone's Personal or another workspace). The server decides again on
 * every request.
 */
export function useAiAccess(note?: NoteHome | null): AiAccess {
  const { profile, context: current, workspaces } = useAppState();
  const p = profile as { aiEnabled?: boolean; entitlements?: { ai: boolean } };
  const setting = p.aiEnabled !== false;
  const personalEntitled = p.entitlements ? p.entitlements.ai : true;
  let context: AiAccess["context"];
  let entitled: boolean;
  if (!note) {
    // The current context: your Personal plan in Personal, the workspace's plan in a workspace.
    context = current.kind;
    entitled = current.kind === "personal" ? personalEntitled : current.workspace.aiIncluded;
  } else if (note.workspaceId === null) {
    // Personal: your own (your Personal plan), or someone else's shared with you (not included for you).
    const own = !note.ownerProfileId || note.ownerProfileId === profile.id;
    context = own ? "personal" : "shared";
    entitled = own ? personalEntitled : false;
  } else {
    // A workspace you belong to follows its plan; one you're only a guest in isn't included for you.
    const w = workspaces.find((x) => x.id === note.workspaceId);
    context = w ? "workspace" : "shared";
    entitled = w?.aiIncluded ?? false;
  }
  return { on: setting && entitled, entitled, personalEntitled, context, setting };
}

/** Whether AI is available and turned on (every AI entry point checks this; the server enforces it). */
export function useAiEnabled(note?: NoteHome | null): boolean {
  return useAiAccess(note).on;
}

/**
 * The AI actions, made from the current context (its `scope`). Asking about "all notes" searches the
 * current context; writing help on a note follows that note's own scope (the server decides).
 */
export function useAi() {
  const { scope } = useAppState();
  const askAction = useAction(api.ai.ask);
  const writeAction = useAction(api.ai.write);
  const flowchartAction = useAction(api.ai.flowchart);
  const ask = useCallback(
    (question: string, opts: { documentId?: string; range?: "note" | "all"; folderId?: string; history?: AskTurn[]; streamId?: Id<"aiStreams"> } = {}) =>
      askAction({ scope, question, documentId: opts.documentId, range: opts.range, folderId: opts.folderId, history: opts.history, streamId: opts.streamId }),
    [askAction, scope],
  );
  const write = useCallback(
    (task: AiTask, opts: { documentId?: string; text?: string; instruction?: string; language?: string; streamId?: Id<"aiStreams"> } = {}) =>
      writeAction({ scope, task, ...opts }),
    [writeAction, scope],
  );
  /** A flowchart draft (nodes and connectors, no positions) from a description, or the current chart changed. */
  const flowchart = useCallback(
    (mode: "create" | "update", instruction: string, current?: string) => flowchartAction({ scope, mode, instruction, current }),
    [flowchartAction, scope],
  );
  return { ask, write, flowchart };
}

/** Events between the editor's menus and the note's AI panel. */
export const AI_RUN_EVENT = "folevi:ai-run";
export interface AiRunDetail {
  task: AiTask;
  text: string;
  from: number;
  to: number;
  language?: string;
}
export const AI_OPEN_EVENT = "folevi:ai-open";

/** Opens the inline AI composer in this editor (at the cursor, or on a range of text), optionally running a task. */
export const INLINE_AI_EVENT = "folevi:ai-inline";
export interface InlineAiOpen {
  target: { from: number; to: number; text: string } | null;
  task?: AiTask;
  language?: string;
}
export function openInlineAi(editorDom: Element, detail: InlineAiOpen): void {
  editorDom.dispatchEvent(new CustomEvent<InlineAiOpen>(INLINE_AI_EVENT, { detail }));
}
