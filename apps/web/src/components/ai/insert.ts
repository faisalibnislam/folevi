"use client";

import type { Editor } from "@tiptap/react";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { flattenTree, markdownToBlocks, ulid } from "@folevi/editor-schema";
import { blockToNode } from "@/components/editor/convert";
import { normalizeDepths } from "@/components/editor/commands";

/** Where AI-written text goes: replacing a range (a selection), after the block at the cursor, or at the end. */
export type AiPlacement = { kind: "replace"; from: number; to: number; original: string } | { kind: "cursor" } | { kind: "end" };

/** Put the cursor at the end of what was inserted (nothing left selected). */
function cursorAt(tr: Transaction, pos: number) {
  const p = Math.max(0, Math.min(pos, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(p), -1));
}

function nodesFor(editor: Editor, markdown: string, baseDepth: number) {
  const { blocks } = markdownToBlocks(markdown.trim(), { titleFromHeading: false });
  return flattenTree(blocks).map(({ block, depth }) => editor.schema.nodeFromJSON(blockToNode({ ...block, id: ulid() }, baseDepth + depth)));
}

/**
 * Puts AI-written Markdown into the note as real blocks (headings, lists, to-dos…). A one-paragraph result
 * replacing a selection inside one block stays inline, keeping the rest of that block. Returns false when
 * a selection to replace has changed since it was sent.
 */
export function insertAiMarkdown(editor: Editor, markdown: string, placement: AiPlacement): boolean {
  const { state } = editor;
  if (placement.kind === "replace") {
    const { from, to, original } = placement;
    if (to > state.doc.content.size || state.doc.textBetween(from, to, "\n") !== original) return false;
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    const depth = $from.depth >= 1 ? Number($from.node(1).attrs.depth ?? 0) : 0;
    const nodes = nodesFor(editor, markdown, depth);
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
    normalizeDepths(tr);
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    return true;
  }
  const tr = state.tr;
  const $sel = state.selection.$from;
  const atEnd = placement.kind === "end" || $sel.depth < 1;
  const depth = !atEnd ? Number($sel.node(1).attrs.depth ?? 0) : 0;
  const nodes = nodesFor(editor, markdown, depth);
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
  normalizeDepths(tr);
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}
