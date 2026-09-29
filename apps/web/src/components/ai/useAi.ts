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

/**
 * AI where you are — the current workspace, or `workspaceId` (e.g. the workspace a note belongs to). The
 * server decides again on every request.
 */
export function useAiAccess(workspaceId?: string): AiAccess {
  const { profile, workspace, workspaces } = useAppState();
  const p = profile as { aiEnabled?: boolean; entitlements?: { ai: boolean } };
  const setting = p.aiEnabled !== false;
  const personalEntitled = p.entitlements ? p.entitlements.ai : true;
  const here = (workspaceId ? workspaces.find((w) => w.id === workspaceId) : workspace) as
    | { kind: string; ownerName: string | null; plan?: { scope: string } | null; aiIncluded?: boolean }
    | undefined;
  // Not a member (a note shared with you), or someone else's Personal: AI isn't included there for you.
  const context: AiAccess["context"] = !here
    ? "shared"
    : here.plan === undefined
      ? here.kind === "personal" && !here.ownerName
        ? "personal"
        : here.kind === "personal"
          ? "shared"
          : "workspace"
      : !here.plan
        ? "shared"
        : here.plan.scope === "personal"
          ? "personal"
          : "workspace";
  // Older cached workspace lists have no aiIncluded: fall back to the Personal plan in Personal.
  const entitled = here?.aiIncluded ?? (context === "personal" ? personalEntitled : false);
  return { on: setting && entitled, entitled, personalEntitled, context, setting };
}

/** Whether AI is available and turned on (every AI entry point checks this; the server enforces it). */
export function useAiEnabled(workspaceId?: string): boolean {
  return useAiAccess(workspaceId).on;
}

/** The AI actions, bound to the current workspace. */
export function useAi() {
  const { workspace } = useAppState();
  const askAction = useAction(api.ai.ask);
  const writeAction = useAction(api.ai.write);
  const flowchartAction = useAction(api.ai.flowchart);
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
  /** A flowchart draft (nodes and connectors, no positions) from a description, or the current chart changed. */
  const flowchart = useCallback(
    (mode: "create" | "update", instruction: string, current?: string) => flowchartAction({ workspaceId: workspace.id, mode, instruction, current }),
    [flowchartAction, workspace.id],
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
