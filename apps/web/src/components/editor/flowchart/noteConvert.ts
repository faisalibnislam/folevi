"use client";

// "Make a flowchart" from the note: the block menu's "Flowchart with Foli AI" for selected blocks (a list,
// steps written out, any text), and the Foli AI panel's "Flowchart" for the selection or the whole note.
// Each puts an empty flowchart block in the note (one undo step) that, when it appears, asks Foli AI to
// draw the text and shows the result as a preview to apply or discard (FlowchartView takes it once).
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { createElement } from "react";
import { FLOWCHART_DEFAULT_HEIGHT, ulid } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { endHistoryGroup, normalizeDepths } from "../commands";

/** Blocks whose text Foli AI can turn into steps. */
const TEXT_TYPES = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout"]);
/** The most text a flowchart is drawn from (convex/flowchartAi.ts FROM_TEXT_CHARS). */
const MAX_TEXT = 24_000;

export type PendingFlowchart = { text: string } | { documentId: string };

/** Flowchart blocks made from the note, waiting for their view to start Foli AI. */
const pending = new Map<string, PendingFlowchart>();

/** What a new flowchart block (by id) should ask Foli AI to draw when it appears, once. */
export function takePendingFlowchart(blockId: string): PendingFlowchart | null {
  const p = pending.get(blockId) ?? null;
  pending.delete(blockId);
  return p;
}

function posOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** The text of blocks `from` to `to` (indexes), nested items indented, so lists keep their shape. */
export function blocksText(editor: Editor, from: number, to: number): string {
  const parts: string[] = [];
  for (let i = from; i <= to; i++) {
    const n = editor.state.doc.maybeChild(i);
    if (!n || !TEXT_TYPES.has(n.type.name) || !n.textContent.trim()) continue;
    const marker = n.type.name === "bulleted" || n.type.name === "todo" ? "- " : n.type.name === "numbered" ? "1. " : n.type.name === "heading" ? "# " : "";
    parts.push(`${"  ".repeat(Number(n.attrs.depth ?? 0))}${marker}${n.textContent.trim()}`);
  }
  return parts.join("\n").trim();
}

/** Inserts an empty flowchart block at `at` (a position between blocks) that will ask Foli AI for `request`. */
function insertPending(editor: Editor, at: number, depth: number, request: PendingFlowchart): boolean {
  const type = editor.state.schema.nodes.flowchart;
  if (!type) return false;
  const id = ulid();
  pending.set(id, request);
  const block = type.create({ id, depth, data: "", height: FLOWCHART_DEFAULT_HEIGHT });
  const tr = editor.state.tr.insert(at, block);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  normalizeDepths(tr);
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
  editor.view.focus();
  return true;
}

/** Blocks `from` to `to` drawn as a flowchart by Foli AI, in a new block below them. */
export function flowchartFromBlocksWithAi(editor: Editor, from: number, to: number): boolean {
  const text = blocksText(editor, from, to);
  if (!text) return false;
  const { doc } = editor.state;
  return insertPending(editor, posOf(doc, to) + doc.child(to).nodeSize, Number(doc.child(from).attrs.depth ?? 0), { text: text.slice(0, MAX_TEXT) });
}

/**
 * The Foli AI panel's "Flowchart": the selected text (several blocks or part of one), or else the whole note
 * (read on the server, `documentId`), drawn in a new flowchart block below the selection or the caret.
 */
export function flowchartFromNoteWithAi(editor: Editor, documentId: string): boolean {
  const { state } = editor;
  const sel = state.selection;
  const text = sel.empty ? "" : state.doc.textBetween(sel.from, sel.to, "\n", " ").trim();
  // After the top-level block that holds the end of the selection (or the caret).
  const index = Math.min(state.doc.childCount - 1, state.doc.resolve(Math.min(sel.to, state.doc.content.size)).index(0));
  if (index < 0) return false;
  const at = posOf(state.doc, index) + state.doc.child(index).nodeSize;
  const depth = Number(state.doc.child(index).attrs.depth ?? 0);
  return insertPending(editor, at, depth, text ? { text: text.slice(0, MAX_TEXT) } : { documentId });
}

/** The block menu's flowchart entry for blocks `from` to `to`: "Flowchart with Foli AI" for any text. */
export function flowchartMenuItems(editor: Editor, from: number, to: number, opts: { aiOn: boolean; close: (refocus?: boolean) => void }): { label: string; hint: string; icon: React.ReactNode; run: () => void }[] {
  if (!opts.aiOn || !editor.state.schema.nodes.flowchart || !blocksText(editor, from, to)) return [];
  return [{ label: "Flowchart with Foli AI", hint: "", icon: createElement(AiIcon, { size: 14, className: "text-[#7c6cf0]" }), run: () => (flowchartFromBlocksWithAi(editor, from, to), opts.close(false)) }];
}
