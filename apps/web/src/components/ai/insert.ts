"use client";

import type { Editor } from "@tiptap/react";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { flattenTree, markdownToBlocks, ulid, type WireBlock } from "@folevi/editor-schema";
import type { Node as PMNode } from "@tiptap/pm/model";
import { blockToNode } from "@/components/editor/convert";
import { closeHistory } from "@tiptap/pm/history";
import { endHistoryGroup, normalizeDepths } from "@/components/editor/commands";
import { linkPeople, type MentionablePerson } from "./people";

/**
 * Where AI-written text goes: replacing a range (a selection), after the block at the cursor, above or
 * below the block holding a position (the text it was about), at a position between blocks at a depth
 * (after a block with no text in it, like a recording), or at the end of the note.
 */
export type AiPlacement =
  | { kind: "replace"; from: number; to: number; original: string }
  | { kind: "cursor" }
  | { kind: "above"; at: number }
  | { kind: "below"; at: number }
  | { kind: "after"; pos: number; depth: number }
  | { kind: "end" };

/** Put the cursor at the end of what was inserted (nothing left selected). */
function cursorAt(tr: Transaction, pos: number) {
  const p = Math.max(0, Math.min(pos, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(p), -1));
}

/** Options for inserting: people "@Name" can turn into mentions of (a meeting summary's owners). */
export interface InsertOptions {
  people?: readonly MentionablePerson[];
  /** Told the blocks about to be inserted (with their new ids), e.g. to find the to-dos in them afterwards. */
  onNodes?: (nodes: readonly PMNode[]) => void;
}

function nodesFor(editor: Editor, markdown: string, baseDepth: number, opts: InsertOptions = {}) {
  const { blocks } = markdownToBlocks(markdown.trim(), { titleFromHeading: false, remoteImages: "link" });
  const nodes = blockNodes(editor, linkPeople(blocks, opts.people), baseDepth);
  opts.onNodes?.(nodes);
  return nodes;
}

/** Blocks (a tree, by parentId) as editor nodes with fresh ids, nested from `baseDepth`. */
function blockNodes(editor: Editor, blocks: readonly WireBlock[], baseDepth: number): PMNode[] {
  return flattenTree([...blocks]).map(({ block, depth }) => editor.schema.nodeFromJSON(blockToNode({ ...block, id: ulid() }, baseDepth + depth)));
}

/** Sends the change as its own undo step: one ⌘Z takes all of it back, and typing after it undoes separately. */
function commit(editor: Editor, tr: Transaction) {
  normalizeDepths(tr);
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
  editor.commands.focus();
}

/**
 * Puts AI-written Markdown into the note as real blocks (headings, lists, to-dos…), as one undo step. A
 * one-paragraph result replacing a selection inside one block stays inline, keeping the rest of that block.
 * Returns false when a selection to replace has changed since it was sent (nothing is changed then).
 */
export function insertAiMarkdown(editor: Editor, markdown: string, placement: AiPlacement, opts: InsertOptions = {}): boolean {
  const { state } = editor;
  if (placement.kind === "replace") {
    const { from, to, original } = placement;
    if (to > state.doc.content.size || state.doc.textBetween(from, to, "\n") !== original) return false;
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    const depth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
    const nodes = nodesFor(editor, markdown, depth, opts);
    const tr = state.tr;
    if ($from.sameParent($to) && $from.parent.isTextblock && nodes.length === 1 && nodes[0]!.type.name === "paragraph") {
      tr.replaceWith(from, to, nodes[0]!.content);
      cursorAt(tr, from + nodes[0]!.content.size);
    } else {
      // Multi-block result: drop the selected text, then put the blocks after the block it was in.
      tr.delete(from, to);
      const after = tr.doc.resolve(tr.mapping.map(from));
      const blockEnd = after.depth >= 1 ? after.after(1) : after.pos;
      const emptyBlock = after.depth >= 1 && after.node(1).isTextblock && after.node(1).content.size === 0;
      const start = emptyBlock ? after.before(1) : blockEnd;
      if (emptyBlock) tr.replaceWith(after.before(1), blockEnd, nodes);
      else tr.insert(blockEnd, nodes);
      cursorAt(tr, start + nodes.reduce((n, x) => n + x.nodeSize, 0) - 1);
    }
    commit(editor, tr);
    return true;
  }
  return insertNodes(editor, (depth) => nodesFor(editor, markdown, depth, opts), placement);
}

/**
 * Puts ready-made blocks into the note (to-dos with their dates and assignees, "Find to-dos"), as one undo
 * step, anywhere but over a selection. They sync like typed blocks, so to-dos become tasks.
 */
export function insertAiBlocks(editor: Editor, blocks: readonly WireBlock[], placement: Exclude<AiPlacement, { kind: "replace" }>): boolean {
  return insertNodes(editor, (depth) => blockNodes(editor, blocks, depth), placement);
}

/**
 * Puts ready-made blocks where blocks of the note are (by id), at their depth, as one undo step: "Add dates
 * and people" swaps a result's plain to-dos for dated, assigned ones. An empty list removes the block. Ids
 * no longer in the note are skipped; returns how many were found.
 */
export function replaceBlocksById(editor: Editor, replacements: ReadonlyMap<string, readonly WireBlock[]>): number {
  const found: { pos: number; size: number; depth: number; blocks: readonly WireBlock[] }[] = [];
  editor.state.doc.forEach((n, pos) => {
    const blocks = replacements.get(String(n.attrs.id));
    if (blocks) found.push({ pos, size: n.nodeSize, depth: Number(n.attrs.depth ?? 0), blocks });
  });
  if (!found.length) return 0;
  const tr = editor.state.tr;
  // From the end back, so the positions before each change stay right.
  for (const f of [...found].reverse()) tr.replaceWith(f.pos, f.pos + f.size, blockNodes(editor, f.blocks, f.depth));
  const first = found[0]!;
  cursorAt(tr, tr.mapping.map(first.pos + first.size, -1) - 1);
  commit(editor, tr);
  return found.length;
}

/** Inserts the nodes `make` gives for a depth (the depth of where they go) at a placement other than replace. */
function insertNodes(editor: Editor, make: (baseDepth: number) => PMNode[], placement: Exclude<AiPlacement, { kind: "replace" }>): boolean {
  const { state } = editor;
  if (placement.kind === "after") {
    const nodes = make(placement.depth);
    if (!nodes.length) return true;
    const pos = Math.max(0, Math.min(placement.pos, state.doc.content.size));
    const tr = state.tr.insert(pos, nodes);
    cursorAt(tr, pos + nodes.reduce((n, x) => n + x.nodeSize, 0) - 1);
    commit(editor, tr);
    return true;
  }
  if (placement.kind === "above" || placement.kind === "below") {
    // Next to the top-level block holding `at` (the text the result is about), at that block's depth.
    const $at = state.doc.resolve(Math.max(0, Math.min(placement.at, state.doc.content.size)));
    if ($at.depth < 1) return insertNodes(editor, make, { kind: "end" });
    const block = $at.node(1);
    const nodes = make(Number(block.attrs.depth ?? 0));
    if (!nodes.length) return true;
    const size = nodes.reduce((n, x) => n + x.nodeSize, 0);
    const tr = state.tr;
    const start = placement.kind === "above" ? $at.before(1) : $at.after(1);
    tr.insert(start, nodes);
    cursorAt(tr, start + size - 1);
    commit(editor, tr);
    return true;
  }
  const tr = state.tr;
  const $sel = state.selection.$from;
  const atEnd = placement.kind === "end" || $sel.depth < 1;
  const depth = !atEnd ? Number($sel.node(1).attrs.depth ?? 0) : 0;
  const nodes = make(depth);
  if (!nodes.length) return true;
  const size = nodes.reduce((n, x) => n + x.nodeSize, 0);
  if (atEnd) {
    const last = state.doc.lastChild;
    const start = last && last.isTextblock && last.content.size === 0 ? state.doc.content.size - last.nodeSize : state.doc.content.size;
    tr.replaceWith(start, state.doc.content.size, nodes);
    cursorAt(tr, start + size - 1);
  } else {
    const block = $sel.node(1);
    const start = block.isTextblock && block.content.size === 0 ? $sel.before(1) : $sel.after(1);
    tr.replaceWith(start, block.isTextblock && block.content.size === 0 ? $sel.after(1) : start, nodes);
    cursorAt(tr, start + size - 1);
  }
  commit(editor, tr);
  return true;
}

/** Whether the note has nothing in it yet (empty lines only): a generated page can fill it. */
export function noteIsEmpty(editor: Editor): boolean {
  let empty = true;
  editor.state.doc.forEach((n) => {
    if (!n.isTextblock || n.content.size > 0) empty = false;
  });
  return empty;
}
