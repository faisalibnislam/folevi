"use client";

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { InlineNode } from "@folevi/editor-schema";
import { blockToNode, nodeToFlat } from "@/components/editor/convert";
import { endHistoryGroup } from "@/components/editor/commands";

/** A block's translated content (aiStudy.translateNote "replace"): its text, or its table's cells. */
export interface BlockTranslation {
  id: string;
  text?: InlineNode[];
  rows?: InlineNode[][][];
  /** The words it was translated from (text nodes only): a block whose words changed since is skipped. */
  from?: string;
}

/** The words of some inline content (text nodes only), as the server's textSignature. */
function textSignature(nodes: readonly InlineNode[] | readonly InlineNode[][][]): string {
  const flat = (nodes as unknown[]).flat(3) as InlineNode[];
  return flat.map((n) => (n.type === "text" ? n.text : "")).join("");
}

/**
 * Puts a whole note's translation into the editor as one undo step: each block keeps its id, type, depth
 * and settings, only its text (or its table's cells) changes. Blocks added or edited since the translation
 * was made stay as they are (`skipped`). Returns how many blocks changed and how many were skipped.
 */
export function applyTranslation(editor: Editor, translations: readonly BlockTranslation[]): { changed: number; skipped: number } {
  const by = new Map(translations.map((t) => [t.id, t]));
  const { state } = editor;
  const tr = state.tr;
  let changed = 0;
  let skipped = 0;
  const swaps: { pos: number; node: PMNode }[] = [];
  state.doc.forEach((node, pos) => {
    const flat = nodeToFlat(node);
    const t = flat && by.get(flat.id);
    if (!flat || !t) return;
    const now = t.rows ? textSignature(((flat.props.rows as InlineNode[][][] | undefined) ?? [])) : textSignature(flat.text);
    if (t.from !== undefined && t.from !== now) {
      skipped++;
      return;
    }
    const block = {
      id: flat.id,
      type: flat.type,
      parentId: null,
      rank: "",
      schemaVersion: flat.schemaVersion,
      text: t.text && flat.text.length ? t.text : flat.text,
      props: t.rows && flat.type === "table" ? { ...flat.props, rows: t.rows } : flat.props,
    };
    swaps.push({ pos, node: editor.schema.nodeFromJSON(blockToNode(block, flat.depth)) });
  });
  // From the end, so earlier positions stay right.
  for (const { pos, node } of swaps.reverse()) {
    const old = tr.doc.nodeAt(pos);
    if (!old) continue;
    tr.replaceWith(pos, pos + old.nodeSize, node);
    changed++;
  }
  if (!changed) return { changed, skipped };
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
  return { changed, skipped };
}
