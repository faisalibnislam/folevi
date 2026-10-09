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
    case "web":
      return "Searching the web…";
    case "page":
      return "Reading the page…";
    case "research":
      return "Researching…";
    case "planning":
      return "Planning…";
    case "working":
      return "Working on it…";
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

/** One step an agent took (convex/lib/ai/tools: the tool, how many notes or results, whether it worked). */
export interface AgentStep {
  tool: string;
  count: number;
  ok: boolean;
}

const WRITE_TOOLS = new Set(["create_note", "update_note", "append_to_note", "rename_note", "move_note", "create_folder", "add_tags", "create_checklist", "create_tasks", "merge_notes"]);
const READ_TOOLS = new Set(["get_note", "get_notes", "compare_notes"]);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** An agent's steps as a few short lines, in the order it took them ("Searched notes", "Read 3 notes"). */
export function stepLines(steps: AgentStep[]): string[] {
  const groups = new Map<string, { n: number; count: number }>();
  let refused = 0;
  for (const s of steps) {
    if (!s.ok) {
      refused++;
      continue;
    }
    const key = READ_TOOLS.has(s.tool) ? "read" : WRITE_TOOLS.has(s.tool) ? "write" : s.tool;
    const g = groups.get(key) ?? { n: 0, count: 0 };
    g.n++;
    g.count += s.count;
    groups.set(key, g);
  }
  const out: string[] = [];
  for (const [key, g] of groups) {
    switch (key) {
      case "search_notes":
        out.push(g.n === 1 ? "Searched notes" : `Searched notes ${g.n} times`);
        break;
      case "read":
        out.push(`Read ${plural(g.count, "a note", "notes")}`);
        break;
      case "write":
        out.push(`Proposed ${plural(g.count, "a change", "changes")}`);
        break;
      case "list_folders":
        out.push("Looked at folders");
        break;
      case "list_tags":
        out.push("Looked at tags");
        break;
      case "find_related":
        out.push("Found related notes");
        break;
      case "find_duplicates":
        out.push("Looked for duplicates");
        break;
      case "get_workspace_context":
        out.push("Looked around");
        break;
      case "search_web":
        out.push(g.n === 1 ? "Searched the web" : `Searched the web ${g.n} times`);
        break;
      case "read_web_page":
        out.push(`Read ${plural(g.count, "a web page", "web pages")}`);
        break;
      case "calculate":
        out.push(g.n === 1 ? "Did a calculation" : `Did ${g.n} calculations`);
        break;
      default:
        out.push("Looked something up");
    }
  }
  if (refused) out.push(`${plural(refused, "A step", "steps")} didn't work`);
  return out;
}
