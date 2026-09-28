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

/**
 * AI for this person: `entitled` — their plan includes it (Pro, the Pro trial, or a grant from the Folevi
 * team); `setting` — they haven't turned it off (Settings → Account); `on` — both.
 */
export function useAiAccess(): { on: boolean; entitled: boolean; setting: boolean } {
  const { profile } = useAppState();
  const p = profile as { aiEnabled?: boolean; entitlements?: { ai: boolean } };
  const setting = p.aiEnabled !== false;
  const entitled = p.entitlements ? p.entitlements.ai : true;
  return { on: setting && entitled, entitled, setting };
}

/** Whether AI is available and turned on (every AI entry point checks this; the server enforces it). */
export function useAiEnabled(): boolean {
  return useAiAccess().on;
}

/** The AI actions, bound to the current workspace. */
export function useAi() {
  const { workspace } = useAppState();
  const askAction = useAction(api.ai.ask);
  const writeAction = useAction(api.ai.write);
  const ask = useCallback(
    (question: string, opts: { documentId?: string; scope?: "note" | "workspace"; folderId?: string; history?: AskTurn[]; streamId?: Id<"aiStreams"> } = {}) =>
      askAction({ workspaceId: workspace.id, question, documentId: opts.documentId, scope: opts.scope, folderId: opts.folderId, history: opts.history, streamId: opts.streamId }),
    [askAction, workspace.id],
  );
  const write = useCallback(
    (task: AiTask, opts: { documentId?: string; text?: string; instruction?: string; language?: string; streamId?: Id<"aiStreams"> } = {}) =>
      writeAction({ workspaceId: workspace.id, task, ...opts }),
    [writeAction, workspace.id],
  );
  return { ask, write };
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
