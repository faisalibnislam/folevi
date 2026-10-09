"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import type { Id } from "@/lib/convex/api";

export type AiTask =
  | "improve" | "fix" | "shorter" | "longer" | "simplify"
  | "professional" | "casual" | "friendly" | "confident" | "direct" | "academic"
  | "translate" | "toList" | "toTable" | "toChecklist" | "refine"
  | "explain" | "summarizeText" | "continueText" | "actionItemsText"
  | "summarize" | "continue" | "outline" | "actions" | "title" | "brainstorm" | "draft"
  | "page" | "template";

/** How a selection action groups in the composer: edits, tones (a submenu), "turn into", and reading it. */
export type SelectionGroup = "edit" | "tone" | "turn" | "use";

/** Every selection action (the inline composer's menu, and result labels in the AI panel). */
export const SELECTION_ACTIONS: { task: AiTask; label: string; group: SelectionGroup }[] = [
  { task: "improve", label: "Improve writing", group: "edit" },
  { task: "fix", label: "Fix spelling & grammar", group: "edit" },
  { task: "shorter", label: "Make shorter", group: "edit" },
  { task: "longer", label: "Make longer", group: "edit" },
  { task: "simplify", label: "Simplify language", group: "edit" },
  { task: "translate", label: "Translate…", group: "edit" },
  { task: "professional", label: "Professional", group: "tone" },
  { task: "casual", label: "Casual", group: "tone" },
  { task: "friendly", label: "Friendly", group: "tone" },
  { task: "confident", label: "Confident", group: "tone" },
  { task: "direct", label: "Direct", group: "tone" },
  { task: "academic", label: "Academic", group: "tone" },
  { task: "toList", label: "Turn into a list", group: "turn" },
  { task: "toTable", label: "Turn into a table", group: "turn" },
  { task: "toChecklist", label: "Turn into a checklist", group: "turn" },
  { task: "summarizeText", label: "Summarize", group: "use" },
  { task: "explain", label: "Explain", group: "use" },
  { task: "continueText", label: "Continue writing", group: "use" },
  { task: "actionItemsText", label: "Extract action items", group: "use" },
];

/** Tasks whose result stands in for the selected text (so Replace is offered, with a preview of the changes). */
export const REWRITE_TASKS: ReadonlySet<AiTask> = new Set<AiTask>([
  ...SELECTION_ACTIONS.filter((a) => a.group === "edit" || a.group === "tone" || a.group === "turn").map((a) => a.task),
  "refine",
]);

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiAccess {
  /** Available here and turned on. */
  on: boolean;
  /** Included where you are. Never on Core: in Personal, your Personal plan (every plan but Core, and the
   * trial); in a team workspace you belong to, that workspace (its plan, or on Free your personal plan); on a
   * note from elsewhere, the server's answer for that note (a guest uses their own personal plan). */
  entitled: boolean;
  /** Your Personal plan includes AI (false only on Core; for Settings → Account). */
  personalEntitled: boolean;
  /** Your Personal plan is Core (no AI anywhere your personal credits would be used). */
  personalCore: boolean;
  /** Where you are: "personal" (your own Personal), "workspace" (a team workspace) or "shared" (someone else's). */
  context: "personal" | "workspace" | "shared";
  /** You haven't turned it off (Settings → Account). */
  setting: boolean;
}

/** Where a note lives, as documents.get reports it: a team workspace, or someone's Personal (workspaceId null). */
export interface NoteHome {
  /** The note's public id (asks the server about notes from elsewhere). */
  id?: string;
  workspaceId: string | null;
  ownerProfileId?: string | null;
}

/**
 * The note an editor is showing, for the AI inside it (the slash menu, the selection toolbar, ⌘J): where
 * it lives (so AI follows its plan, not the current context's), its title, and a way to set the title (a
 * page generated into an empty note names it).
 */
export interface NoteAi {
  home: NoteHome | null;
  title?: string;
  setTitle?: (title: string) => void;
}
export const NoteAiContext = createContext<NoteAi | null>(null);
export const useNoteAi = () => useContext(NoteAiContext);

/**
 * AI where you are: the current context (Personal or a team workspace), or `note`'s home (a note may be
 * open from elsewhere: shared from someone's Personal or a workspace you're a guest in). Core hides AI. The
 * server decides again on every request.
 */
export function useAiAccess(asked?: NoteHome | null): AiAccess {
  const { profile, context: current, workspaces, scope } = useAppState();
  // Inside a note's editor, the note being edited (unless the caller names one).
  const open = useContext(NoteAiContext);
  const note = asked === undefined ? open?.home : asked;
  const p = profile as { aiEnabled?: boolean; entitlements?: { ai: boolean; plan?: string } };
  const setting = p.aiEnabled !== false;
  const personalEntitled = p.entitlements ? p.entitlements.ai : true;
  const personalCore = p.entitlements?.plan === "core";
  let context: AiAccess["context"];
  let entitled: boolean;
  if (!note) {
    // The current context: your Personal plan in Personal, what the server says for you in a workspace.
    context = current.kind;
    entitled = current.kind === "personal" ? personalEntitled : current.workspace.aiIncluded;
  } else if (note.workspaceId === null) {
    // Personal: your own (your Personal plan), or someone else's shared with you (asked below).
    const own = !note.ownerProfileId || note.ownerProfileId === profile.id;
    context = own ? "personal" : "shared";
    entitled = own ? personalEntitled : false;
  } else {
    // A workspace you belong to: what the server says for you there. One you're a guest in: asked below.
    const w = workspaces.find((x) => x.id === note.workspaceId);
    context = w ? "workspace" : "shared";
    entitled = w?.aiIncluded ?? false;
  }
  // A note from elsewhere: guests use their own personal plan unless the page's scope is on Core, so only
  // the server knows. Asked only when it matters (AI on, and not ruled out by a Core personal plan).
  const ask = context === "shared" && setting && personalEntitled && Boolean(note?.id);
  const shared = useQuery(api.billing.credits, ask ? { scope, documentId: note!.id } : "skip");
  if (context === "shared") entitled = Boolean(ask && shared?.aiIncluded);
  return { on: setting && entitled, entitled, personalEntitled, personalCore, context, setting };
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
    (task: AiTask, opts: { documentId?: string; text?: string; instruction?: string; language?: string; streamId?: Id<"aiStreams"> } = {}): Promise<{ text: string; title?: string }> =>
      writeAction({ scope, task, ...opts }),
    [writeAction, scope],
  );
  const saveDraftMutation = useMutation(api.aiWriting.saveDraft);
  /** Saves a previewed page as a new note or template where you are (Markdown becomes real blocks). */
  const saveDraft = useCallback(
    (kind: "note" | "template", title: string, markdown: string) => saveDraftMutation({ scope, kind, title, markdown }),
    [saveDraftMutation, scope],
  );
  /** A flowchart draft (nodes and connectors, no positions) from a description, or the current chart changed. */
  const flowchart = useCallback(
    (mode: "create" | "update", instruction: string, current?: string) => flowchartAction({ scope, mode, instruction, current }),
    [flowchartAction, scope],
  );
  return { ask, write, flowchart, saveDraft };
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
  /** Opens ready for a prompt: "draft" writes at the cursor, "page" writes a whole page (title and all). */
  mode?: "draft" | "page";
}
export function openInlineAi(editorDom: Element, detail: InlineAiOpen): void {
  editorDom.dispatchEvent(new CustomEvent<InlineAiOpen>(INLINE_AI_EVENT, { detail }));
}
