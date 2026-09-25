// Block-level editing commands shared by the keymap, slash menu, block menu and inspector.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { LIMITS, ulid } from "@folevi/editor-schema";
import { TEXT_NODES } from "./convert";

export interface BlockRef {
  node: PMNode;
  pos: number;
  index: number;
}

export function blocksInSelection(state: EditorState): BlockRef[] {
  const { from, to } = state.selection;
  const out: BlockRef[] = [];
  let pos = 0;
  state.doc.forEach((node, offset, index) => {
    const start = offset;
    const end = offset + node.nodeSize;
    if (end > from && start <= to) out.push({ node, pos: start, index });
    pos = end;
  });
  if (!out.length) {
    const $from = state.selection.$from;
    const index = $from.index(0);
    const node = state.doc.child(Math.min(index, state.doc.childCount - 1));
    out.push({ node, pos: $from.before(1), index });
  }
  void pos;
  return out;
}

export function blockAt(state: EditorState, index: number): BlockRef | null {
  if (index < 0 || index >= state.doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return { node: state.doc.child(index), pos, index };
}

/** The block plus the following blocks nested under it (greater depth). */
export function subtreeRange(state: EditorState, index: number): { start: number; end: number; count: number } {
  const first = blockAt(state, index)!;
  const baseDepth = Number(first.node.attrs.depth ?? 0);
  let end = first.pos + first.node.nodeSize;
  let count = 1;
  for (let i = index + 1; i < state.doc.childCount; i++) {
    const n = state.doc.child(i);
    if (Number(n.attrs.depth ?? 0) <= baseDepth) break;
    end += n.nodeSize;
    count++;
  }
  return { start: first.pos, end, count };
}

/** Converts the selected text blocks to `type` (keeping inline content, id and depth). */
export function turnInto(editor: Editor, type: string, attrs: Record<string, unknown> = {}): boolean {
  const { state } = editor;
  const schemaType = state.schema.nodes[type === "code" ? "codeBlock" : type];
  if (!schemaType) return false;
  const tr = state.tr;
  for (const b of blocksInSelection(state)) {
    const isText = TEXT_NODES.has(b.node.type.name) || b.node.type.name === "codeBlock";
    if (!isText) continue;
    const baseAttrs = { id: b.node.attrs.id, depth: b.node.attrs.depth, ...attrs };
    if (type === "code") {
      const code = schemaType.create(baseAttrs, b.node.textContent ? state.schema.text(b.node.textContent) : null);
      tr.replaceWith(tr.mapping.map(b.pos), tr.mapping.map(b.pos + b.node.nodeSize), code);
    } else if (b.node.type.name === "codeBlock") {
      const node = schemaType.create(baseAttrs, b.node.textContent ? state.schema.text(b.node.textContent) : null);
      tr.replaceWith(tr.mapping.map(b.pos), tr.mapping.map(b.pos + b.node.nodeSize), node);
    } else {
      tr.setNodeMarkup(tr.mapping.map(b.pos), schemaType, baseAttrs);
    }
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Indent/outdent the selected blocks; nested blocks move with their parent. */
export function changeDepth(editor: Editor, delta: 1 | -1): boolean {
  const { state } = editor;
  const selected = blocksInSelection(state);
  const tr = state.tr;
  let changed = false;
  const handled = new Set<number>();
  for (const b of selected) {
    if (handled.has(b.index)) continue;
    const depth = Number(b.node.attrs.depth ?? 0);
    const prev = b.index > 0 ? state.doc.child(b.index - 1) : null;
    const maxDepth = prev ? Math.min(LIMITS.maxDepth, Number(prev.attrs.depth ?? 0) + 1) : 0;
    const next = Math.max(0, Math.min(maxDepth, depth + delta));
    if (next === depth && !(delta < 0 && depth > 0)) continue;
    const range = subtreeRange(state, b.index);
    const applied = next - depth;
    if (applied === 0) continue;
    for (let i = b.index; i < b.index + range.count; i++) {
      handled.add(i);
      const ref = blockAt(state, i)!;
      const d = Number(ref.node.attrs.depth ?? 0);
      tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, depth: Math.max(0, Math.min(LIMITS.maxDepth, d + applied)) });
      changed = true;
    }
  }
  if (!changed) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Moves the block at the cursor (with its nested blocks) up or down past the neighbouring block group. */
export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  const [first] = blocksInSelection(state);
  if (!first) return false;
  const range = subtreeRange(state, first.index);
  const depth = Number(first.node.attrs.depth ?? 0);
  const slice = state.doc.slice(range.start, range.end);
  const tr = state.tr;
  if (dir < 0) {
    if (first.index === 0) return false;
    // Find the start of the previous sibling group at the same or lower depth.
    let target = first.index - 1;
    while (target > 0 && Number(state.doc.child(target).attrs.depth ?? 0) > depth) target--;
    const targetRef = blockAt(state, target)!;
    const offsetInBlock = state.selection.from - range.start;
    tr.delete(range.start, range.end);
    tr.insert(targetRef.pos, slice.content);
    // Depth may need clamping when moving to the very top.
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, targetRef.pos + offsetInBlock))));
  } else {
    const after = first.index + range.count;
    if (after >= state.doc.childCount) return false;
    const nextRange = subtreeRange(state, after);
    const offsetInBlock = state.selection.from - range.start;
    tr.delete(range.start, range.end);
    const insertAt = nextRange.end - (range.end - range.start);
    tr.insert(insertAt, slice.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, insertAt + offsetInBlock))));
  }
  normalizeDepths(tr);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Ensures depth never exceeds previous depth + 1 and the first block is at depth 0. */
export function normalizeDepths(tr: Transaction): void {
  let prevDepth = -1;
  let pos = 0;
  tr.doc.forEach((node) => {
    const d = Number(node.attrs.depth ?? 0);
    const max = Math.min(LIMITS.maxDepth, prevDepth + 1);
    if (d > max) tr.setNodeMarkup(pos, undefined, { ...node.attrs, depth: Math.max(0, max) });
    prevDepth = Math.min(d, Math.max(0, max));
    pos += node.nodeSize;
  });
}

export function insertBlockAfterCurrent(editor: Editor, type: string, attrs: Record<string, unknown> = {}, text?: string): number {
  const { state } = editor;
  const [current] = blocksInSelection(state);
  const depth = current ? Number(current.node.attrs.depth ?? 0) : 0;
  const empty = current && TEXT_NODES.has(current.node.type.name) && current.node.content.size === 0 && current.node.type.name === "paragraph";
  const schemaType = state.schema.nodes[type === "code" ? "codeBlock" : type]!;
  const node = schemaType.create({ id: ulid(), depth, ...attrs }, text ? state.schema.text(text) : null);
  const tr = state.tr;
  let at: number;
  if (current && empty) {
    at = current.pos;
    tr.replaceWith(current.pos, current.pos + current.node.nodeSize, node);
  } else {
    at = current ? current.pos + current.node.nodeSize : state.doc.content.size;
    tr.insert(at, node);
  }
  // Keep a text block after an atom so writing can continue.
  if (!node.isTextblock) {
    const after = at + node.nodeSize;
    const nextNode = tr.doc.nodeAt(after);
    if (!nextNode) tr.insert(after, state.schema.nodes.paragraph!.create({ id: ulid(), depth }));
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, after + 1))));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return at;
}

export function duplicateBlocks(editor: Editor): boolean {
  const { state } = editor;
  const [first] = blocksInSelection(state);
  if (!first) return false;
  const range = subtreeRange(state, first.index);
  const nodes: PMNode[] = [];
  state.doc.nodesBetween(range.start, range.end, (node, pos) => {
    if (pos >= range.start && pos < range.end && node.isBlock && state.doc.resolve(pos).depth === 0) {
      nodes.push(node.type.create({ ...node.attrs, id: ulid() }, node.content, node.marks));
    }
    return false;
  });
  editor.view.dispatch(state.tr.insert(range.end, nodes).scrollIntoView());
  return true;
}

export function deleteBlocks(editor: Editor, indices?: number[]): boolean {
  const { state } = editor;
  const refs = indices ? indices.map((i) => blockAt(state, i)).filter((x): x is BlockRef => Boolean(x)) : blocksInSelection(state);
  if (!refs.length) return false;
  const tr = state.tr;
  for (const ref of [...refs].sort((a, b) => b.pos - a.pos)) {
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
  }
  if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph!.create({ id: ulid(), depth: 0 }));
  normalizeDepths(tr);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
