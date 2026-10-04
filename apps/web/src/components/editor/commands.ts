// Block-level editing commands shared by the keymap, slash menu, block menu and inspector.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { LIMITS, sanitizeHref, ulid } from "@folevi/editor-schema";
import { TEXT_NODES } from "./convert";
import { blockSelectionRange } from "./blockSelectionState";

export interface BlockRef {
  node: PMNode;
  pos: number;
  index: number;
}

export function blocksInSelection(state: EditorState): BlockRef[] {
  // A block selection (several whole blocks) wins over the text selection.
  const range = blockSelectionRange(state);
  if (range) {
    const refs: BlockRef[] = [];
    for (let i = range.from; i <= range.to; i++) refs.push(blockAt(state, i)!);
    return refs;
  }
  const { from, to, empty } = state.selection;
  const out: BlockRef[] = [];
  state.doc.forEach((node, offset, index) => {
    const end = offset + node.nodeSize;
    // A range ending exactly where the next block starts (a selected image or divider) doesn't include it.
    if (end > from && (offset < to || (empty && offset <= to))) out.push({ node, pos: offset, index });
  });
  if (!out.length) {
    const $from = state.selection.$from;
    const index = Math.min($from.index(0), state.doc.childCount - 1);
    out.push(blockAt(state, index)!);
  }
  return out;
}

/**
 * The contiguous run of top-level blocks an action applies to: every selected block plus the blocks
 * nested under the last one. `first`/`last` are inclusive indices; `start`/`end` are document positions.
 */
export function selectedSpan(state: EditorState): { first: number; last: number; start: number; end: number } {
  const refs = blocksInSelection(state);
  const first = refs[0]!.index;
  let last = first;
  for (const r of refs) last = Math.max(last, r.index + subtreeRange(state, r.index).count - 1);
  const start = blockAt(state, first)!.pos;
  const lastRef = blockAt(state, last)!;
  return { first, last, start, end: lastRef.pos + lastRef.node.nodeSize };
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
/** Block styling carried across type changes (see BlockFormat in extensions.ts). */
const FORMAT_ATTRS = ["decoration", "color", "align", "font", "group"] as const;
const FORMATTABLE = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote"]);

/**
 * Sets block styling on every selected text block: decoration, colour, align, font, group, and for
 * paragraphs the text style (Strong / Caption). A null value clears it.
 */
export function setBlockFormat(editor: Editor, attrs: Partial<Record<(typeof FORMAT_ATTRS)[number] | "textStyle", string | null>>): boolean {
  const { state } = editor;
  const tr = state.tr;
  for (const b of blocksInSelection(state)) {
    if (!FORMATTABLE.has(b.node.type.name)) continue;
    const next: Record<string, unknown> = { ...b.node.attrs };
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "textStyle" && b.node.type.name !== "paragraph") continue;
      next[k] = v;
    }
    tr.setNodeMarkup(tr.mapping.map(b.pos), undefined, next);
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(closeHistory(tr));
  endHistoryGroup(editor);
  return true;
}

/** The styling shared by the selected blocks (a value only when every block has it). */
export function selectedBlockFormat(editor: Editor): Record<string, string | null> {
  const refs = blocksInSelection(editor.state).filter((b) => FORMATTABLE.has(b.node.type.name));
  const out: Record<string, string | null> = {};
  for (const k of [...FORMAT_ATTRS, "textStyle"]) {
    const values = new Set(refs.map((b) => (b.node.attrs[k] as string | null | undefined) ?? null));
    out[k] = values.size === 1 ? [...values][0]! : null;
  }
  return out;
}

export function turnInto(editor: Editor, type: string, attrs: Record<string, unknown> = {}): boolean {
  const { state } = editor;
  const schemaType = state.schema.nodes[type === "code" ? "codeBlock" : type];
  if (!schemaType) return false;
  const tr = state.tr;
  // Where the caret was, as (block, offset), so it stays in the converted block when the node is replaced.
  const $head = state.selection.$head;
  const caretBlock = $head.depth >= 1 ? $head.index(0) : -1;
  const caretOffset = $head.depth >= 1 ? $head.parentOffset : 0;
  const keepCaret = state.selection.empty;
  let caretPos: number | null = null;
  for (const b of blocksInSelection(state)) {
    const isText = TEXT_NODES.has(b.node.type.name) || b.node.type.name === "codeBlock";
    if (!isText) continue;
    // Keep the block's styling (colour, decoration, alignment…) when it changes type.
    const kept: Record<string, unknown> = {};
    if (FORMATTABLE.has(type) && FORMATTABLE.has(b.node.type.name)) {
      for (const k of FORMAT_ATTRS) if (b.node.attrs[k] != null) kept[k] = b.node.attrs[k];
      if (type === "paragraph" && b.node.type.name === "paragraph" && b.node.attrs.textStyle != null && !("textStyle" in attrs)) kept.textStyle = b.node.attrs.textStyle;
    }
    const baseAttrs = { id: b.node.attrs.id, depth: b.node.attrs.depth, ...kept, ...attrs };
    const from = tr.mapping.map(b.pos);
    const to = tr.mapping.map(b.pos + b.node.nodeSize);
    if (schemaType.name === "codeBlock" && b.node.type.name !== "codeBlock") {
      const code = schemaType.create(baseAttrs, b.node.textContent ? state.schema.text(b.node.textContent) : null);
      tr.replaceWith(from, to, code);
      if (b.index === caretBlock) caretPos = from + 1 + Math.min(caretOffset, code.content.size);
    } else if (b.node.type.name === "codeBlock" && schemaType.name !== "codeBlock") {
      // Each line of code becomes its own block (the first keeps the id).
      const lines = b.node.textContent.split("\n");
      const nodes = lines.map((line, i) => schemaType.create(i === 0 ? baseAttrs : { ...baseAttrs, id: ulid() }, line ? state.schema.text(line) : null));
      tr.replaceWith(from, to, nodes);
      if (b.index === caretBlock) {
        // Find the line the caret was on.
        let rest = caretOffset;
        let at = from;
        for (const n of nodes) {
          if (rest <= n.content.size) {
            caretPos = at + 1 + rest;
            break;
          }
          rest -= n.content.size + 1;
          at += n.nodeSize;
        }
      }
    } else {
      tr.setNodeMarkup(from, schemaType, baseAttrs);
    }
  }
  if (!tr.docChanged) return false;
  if (keepCaret && caretPos !== null) tr.setSelection(TextSelection.create(tr.doc, Math.min(caretPos, tr.doc.content.size)));
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
  return true;
}

/** Starts a new undo step after a block command, so text typed right after it undoes separately. */
export function endHistoryGroup(editor: Editor): void {
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
}

/** Indent/outdent the selected blocks; nested blocks move with their parent. */
export function changeDepth(editor: Editor, delta: 1 | -1): boolean {
  const { state } = editor;
  const selected = blocksInSelection(state);
  // Several blocks move as one: when the first can't go deeper, none do (the rest would end up nested under it).
  if (delta > 0 && selected.length > 1) {
    const first = selected[0]!;
    const prev = first.index > 0 ? state.doc.child(first.index - 1) : null;
    const max = prev ? Math.min(LIMITS.maxDepth, Number(prev.attrs.depth ?? 0) + 1) : 0;
    if (Number(first.node.attrs.depth ?? 0) >= max) return false;
  }
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
    // Nesting under a collapsed toggle opens it, so the block doesn't vanish.
    if (applied > 0) {
      for (let i = b.index - 1; i >= 0; i--) {
        const p = state.doc.child(i);
        const pd = Number(p.attrs.depth ?? 0);
        if (pd === next - 1) {
          if (p.type.name === "toggle" && p.attrs.collapsed) tr.setNodeMarkup(blockAt(state, i)!.pos, undefined, { ...p.attrs, collapsed: false });
          break;
        }
        if (pd < next - 1) break;
      }
    }
    for (let i = b.index; i < b.index + range.count; i++) {
      handled.add(i);
      const ref = blockAt(state, i)!;
      const d = Number(ref.node.attrs.depth ?? 0);
      tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, depth: Math.max(0, Math.min(LIMITS.maxDepth, d + applied)) });
      changed = true;
    }
  }
  if (!changed) return false;
  editor.view.dispatch(closeHistory(tr));
  endHistoryGroup(editor);
  return true;
}

/**
 * Moves the selected blocks (with their nested blocks) up or down past the neighbouring block group.
 * Works for a caret, a text selection spanning several blocks, and a block selection.
 */
export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  const span = selectedSpan(state);
  const depth = Number(state.doc.child(span.first).attrs.depth ?? 0);
  const slice = state.doc.slice(span.start, span.end);
  const size = span.end - span.start;
  const tr = state.tr;
  // Keep the text selection where it was relative to the moved blocks.
  const relFrom = Math.max(0, Math.min(size, state.selection.from - span.start));
  const relTo = Math.max(0, Math.min(size, state.selection.to - span.start));
  let newStart: number;
  if (dir < 0) {
    if (span.first === 0) return false;
    // Find the start of the previous sibling group at the same or lower depth.
    let target = span.first - 1;
    while (target > 0 && Number(state.doc.child(target).attrs.depth ?? 0) > depth) target--;
    const targetRef = blockAt(state, target)!;
    tr.delete(span.start, span.end);
    tr.insert(targetRef.pos, slice.content);
    newStart = targetRef.pos;
  } else {
    const after = span.last + 1;
    if (after >= state.doc.childCount) return false;
    const nextRange = subtreeRange(state, after);
    tr.delete(span.start, span.end);
    newStart = nextRange.end - size;
    tr.insert(newStart, slice.content);
  }
  const max = tr.doc.content.size;
  const $a = tr.doc.resolve(Math.min(max, newStart + relFrom));
  const $b = tr.doc.resolve(Math.min(max, newStart + relTo));
  if (state.selection instanceof NodeSelection && tr.doc.nodeAt($a.pos)) tr.setSelection(NodeSelection.create(tr.doc, $a.pos));
  else tr.setSelection(relFrom === relTo ? TextSelection.near($a) : TextSelection.between($a, $b));
  normalizeDepths(tr);
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
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
    // After the block's nested blocks, so they stay with it.
    at = current ? subtreeRange(state, current.index).end : state.doc.content.size;
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

/** Duplicates the selected blocks (and their nested blocks) right after them, with fresh ids. */
export function duplicateBlocks(editor: Editor): boolean {
  const { state } = editor;
  const span = selectedSpan(state);
  const nodes: PMNode[] = [];
  for (let i = span.first; i <= span.last; i++) {
    const node = state.doc.child(i);
    nodes.push(node.type.create({ ...node.attrs, id: ulid() }, node.content, node.marks));
  }
  editor.view.dispatch(closeHistory(state.tr.insert(span.end, nodes)).scrollIntoView());
  endHistoryGroup(editor);
  return true;
}

/**
 * Deletes the selected blocks (or the blocks at `indices`). Blocks nested under a deleted block go with it,
 * as they do when moving or duplicating, unless `withChildren` is false.
 */
export function deleteBlocks(editor: Editor, indices?: number[], withChildren = true): boolean {
  const { state } = editor;
  const base = indices ?? blocksInSelection(state).map((r) => r.index);
  const all = new Set<number>();
  for (const i of base) {
    if (i < 0 || i >= state.doc.childCount) continue;
    const count = withChildren ? subtreeRange(state, i).count : 1;
    for (let k = i; k < i + count; k++) all.add(k);
  }
  const refs = [...all].map((i) => blockAt(state, i)!).filter(Boolean);
  if (!refs.length) return false;
  const tr = state.tr;
  for (const ref of refs.sort((a, b) => b.pos - a.pos)) {
    tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
  }
  if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph!.create({ id: ulid(), depth: 0 }));
  normalizeDepths(tr);
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  endHistoryGroup(editor);
  return true;
}

/** Top-level child index → document position of its start. */
function posOfIndex(doc: EditorState["doc"], index: number): number {
  let pos = 0;
  for (let i = 0; i < Math.min(index, doc.childCount); i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * Moves the block at `fromIndex` (with its nested children) so it lands before the block currently at
 * `toIndex` (childCount = the end), re-indented to `depth`. Children keep their depth relative to it.
 * Returns the new index of the moved block, or null when the move is a no-op or impossible.
 */
export function moveSubtreeTo(state: EditorState, fromIndex: number, toIndex: number, depth: number): { tr: Transaction; index: number } | null {
  if (fromIndex < 0 || fromIndex >= state.doc.childCount) return null;
  const range = subtreeRange(state, fromIndex);
  if (toIndex > fromIndex && toIndex < fromIndex + range.count) return null; // into itself
  const baseDepth = Number(state.doc.child(fromIndex).attrs.depth ?? 0);
  const newIndex = toIndex > fromIndex ? toIndex - range.count : toIndex;
  if ((toIndex === fromIndex || toIndex === fromIndex + range.count) && depth === baseDepth) return null;
  const delta = depth - baseDepth;
  const nodes: PMNode[] = [];
  for (let i = fromIndex; i < fromIndex + range.count; i++) {
    const n = state.doc.child(i);
    const d = Math.max(0, Math.min(LIMITS.maxDepth, Number(n.attrs.depth ?? 0) + delta));
    nodes.push(n.type.create({ ...n.attrs, depth: d }, n.content, n.marks));
  }
  const tr = state.tr;
  tr.delete(range.start, range.end);
  tr.insert(posOfIndex(tr.doc, newIndex), nodes);
  normalizeDepths(tr);
  // Dropped inside a collapsed toggle: open it, so the block doesn't vanish.
  const landed = Number(tr.doc.child(newIndex).attrs.depth ?? 0);
  for (let i = newIndex - 1; i >= 0 && landed > 0; i--) {
    const p = tr.doc.child(i);
    const pd = Number(p.attrs.depth ?? 0);
    if (pd < landed) {
      if (pd === landed - 1 && p.type.name === "toggle" && p.attrs.collapsed) tr.setNodeMarkup(posOfIndex(tr.doc, i), undefined, { ...p.attrs, collapsed: false });
      break;
    }
  }
  return { tr, index: newIndex };
}

/** Rows × columns of empty cells for a new table block. */
export function emptyTableRows(rows: number, cols: number): never[][][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
}

/** Inserts a new block of `type` before the block at `index` (childCount = the end) at `depth`. */
export function insertBlockAt(editor: Editor, index: number, depth: number, type: string, attrs: Record<string, unknown> = {}, text?: string): number {
  const { state } = editor;
  const schemaType = state.schema.nodes[type === "code" ? "codeBlock" : type];
  if (!schemaType) return -1;
  const node = schemaType.create({ id: ulid(), depth, ...attrs }, text ? state.schema.text(text) : null);
  const tr = state.tr;
  const at = posOfIndex(state.doc, index);
  tr.insert(at, node);
  if (!node.isTextblock) {
    const after = at + node.nodeSize;
    if (!tr.doc.nodeAt(after)) tr.insert(after, state.schema.nodes.paragraph!.create({ id: ulid(), depth }));
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, after + 1))));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  }
  normalizeDepths(tr);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return index;
}

/**
 * Where a dragged block would land, given each top-level block's vertical box. Blocks in `skip`
 * (the dragged subtree) and hidden blocks are ignored. `desiredDepth` is clamped to what the block
 * above allows (at most one deeper). Pure, so it is unit-tested.
 */
export function dropTarget(
  boxes: { top: number; bottom: number; depth: number; hidden?: boolean }[],
  y: number,
  desiredDepth: number,
  skip: { from: number; count: number } | null,
): { index: number; depth: number; lineY: number } {
  const visible = boxes.map((b, i) => ({ ...b, i })).filter((b) => !b.hidden && !(skip && b.i >= skip.from && b.i < skip.from + skip.count));
  if (!visible.length) return { index: boxes.length, depth: 0, lineY: 0 };
  let index = boxes.length;
  let lineY = visible[visible.length - 1]!.bottom;
  for (const b of visible) {
    if (y < b.top + (b.bottom - b.top) / 2) {
      index = b.i;
      lineY = b.top;
      break;
    }
  }
  // The block that would end up directly above the drop point.
  const above = [...visible].reverse().find((b) => b.i < index);
  const maxDepth = above ? Math.min(LIMITS.maxDepth, above.depth + 1) : 0;
  return { index, depth: Math.max(0, Math.min(maxDepth, desiredDepth)), lineY };
}

/**
 * Links the selection (or the link under the caret) to `raw`. With a collapsed caret outside a link the
 * address itself is inserted as linked text. Returns false when the address isn't a safe URL.
 */
export function applyLink(editor: Editor, raw: string): boolean {
  const text = raw.trim();
  // Typed without a scheme, it has to look like an address: no spaces, and a dot in the host (or localhost).
  if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text) && !text.startsWith("/") && !text.startsWith("#")) {
    if (/\s/.test(text) || (!/^[^/?#]*\.[^/?#.]/.test(text) && !/^localhost(?:[:/?#]|$)/i.test(text))) return false;
  }
  const href = sanitizeHref(text);
  if (!href) return false;
  const { empty } = editor.state.selection;
  if (empty && !editor.isActive("link")) {
    editor.chain().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).unsetMark("link").run();
  } else {
    // Link the text, then continue typing after it (not over it).
    editor
      .chain()
      .extendMarkRange("link")
      .setMark("link", { href })
      .command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
        return true;
      })
      .run();
  }
  // Focus now (Tiptap's .focus() waits a frame), so keys typed right away land in the text.
  editor.view.focus();
  return true;
}

export function removeLink(editor: Editor): void {
  editor.chain().extendMarkRange("link").unsetMark("link").run();
  editor.view.focus();
}

export const TEXT_COLORS = ["muted", "accent", "moss", "marigold", "plum", "coral"] as const;
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export const COLOR_NAMES: Record<string, string> = { muted: "Gray", accent: "Ember", moss: "Moss", marigold: "Marigold", plum: "Plum", coral: "Coral", yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" };

// These focus the editor synchronously (not via Tiptap's next-frame focus), so a keyboard user who
// moves on right away isn't pulled back into the text a frame later.
export function setTextColor(editor: Editor, value: string | null): void {
  if (value) editor.chain().setMark("textColor", { value }).run();
  else editor.chain().unsetMark("textColor").run();
  editor.view.focus();
}

export function setHighlight(editor: Editor, value: string | null): void {
  if (value) editor.chain().setMark("highlight", { value }).run();
  else editor.chain().unsetMark("highlight").run();
  editor.view.focus();
}

export function clearFormatting(editor: Editor): void {
  editor.chain().unsetAllMarks().run();
  editor.view.focus();
}

/** Puts the caret inside a block just inserted at `pos` that has its own fields (a table's first cell). */
export function focusInsideBlock(editor: Editor, pos: number) {
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.querySelector?.<HTMLElement>("[data-enter-focus]")?.focus();
  });
}
