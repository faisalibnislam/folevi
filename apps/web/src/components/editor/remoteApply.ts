// Brings the editor's document in line with the engine's blocks (changes from other devices, the server's
// answers) with the smallest set of steps: removed blocks are deleted, new ones inserted, moved ones moved,
// and changed ones edited in place (only the text that differs). The caret and the person's own undo history
// map through these steps, so undo keeps working after someone else edits the same note.
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { flattenTree, type WireBlock } from "@folevi/editor-schema";
import { blockToNode, contentKey, docToBlocks } from "./convert";

/** Indices (into `seq`) of a longest strictly increasing subsequence, ignoring -1 entries. */
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k]!;
  }
  return keep;
}

/** Edits `node` (at `pos` in tr.doc) into `want`: attributes, then only the stretch of content that differs. */
function patchNode(tr: Transaction, pos: number, node: PMNode, want: PMNode): void {
  if (want.type !== node.type || !node.isTextblock) {
    if (!node.eq(want)) tr.replaceWith(pos, pos + node.nodeSize, want);
    return;
  }
  const attrs = want.attrs;
  if (!node.hasMarkup(want.type, attrs)) tr.setNodeMarkup(pos, undefined, attrs);
  const start = node.content.findDiffStart(want.content);
  if (start === null) return;
  let { a: endA, b: endB } = node.content.findDiffEnd(want.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  tr.replace(pos + 1 + start, pos + 1 + endA, new Slice(want.content.cut(start, endB), 0, 0));
}

/**
 * A transaction turning the document into `blocks`, or null when they already match. Not added to history
 * and marked remote by the caller.
 */
export function remoteTransaction(state: EditorState, blocks: readonly WireBlock[]): Transaction | null {
  const { schema } = state;
  const desired = flattenTree(blocks);
  // Attributes only this device knows (an upload still in progress) carry over to the new version.
  const uploads = new Map<string, unknown>();
  state.doc.forEach((n) => {
    if (n.attrs.id && n.attrs.uploadId) uploads.set(n.attrs.id as string, n.attrs.uploadId);
  });
  const build = (block: WireBlock, depth: number): PMNode => {
    const json = blockToNode(block, depth);
    if (uploads.has(block.id)) json.attrs = { ...json.attrs, uploadId: uploads.get(block.id) };
    return schema.nodeFromJSON(json);
  };
  const wantIndex = new Map(desired.map((d, i) => [d.block.id, i]));
  const currentBlocks = new Map(docToBlocks(state.doc, new Map(blocks.map((b) => [b.id, b]))).map((b) => [b.id, b]));
  const tr = state.tr;

  // Where the caret is, by block id and offset (restored if its block has to be moved).
  const $head = state.selection.$head;
  const caretId = $head.depth >= 1 ? ($head.node(1).attrs.id as string | null) : null;
  const caretOffset = $head.depth >= 1 ? $head.parentOffset : 0;

  const children: { id: string | null; pos: number; size: number }[] = [];
  state.doc.forEach((n, offset) => children.push({ id: n.attrs.id as string | null, pos: offset, size: n.nodeSize }));
  // Nothing in common: the note is simply replaced (deleting every block first would make the editor add an
  // empty line of its own in between).
  if (!children.some((c) => c.id && wantIndex.has(c.id))) {
    const onlyEmptyLine = state.doc.childCount === 1 && state.doc.firstChild!.isTextblock && state.doc.firstChild!.content.size === 0;
    if (!desired.length && onlyEmptyLine) return null;
    const nodes = desired.length ? desired.map(({ block, depth }) => build(block, depth)) : [schema.nodes.paragraph!.create({ id: null, depth: 0 })];
    tr.replaceWith(0, state.doc.content.size, nodes);
    tr.setMeta("preventClearDocument", true);
    return tr;
  }

  // 1. Blocks that are gone (or have no id yet) are deleted.
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i]!;
    if (!c.id || !wantIndex.has(c.id)) tr.delete(c.pos, c.pos + c.size);
  }

  // 2. Of the rest, the longest run already in the right order stays; the others are moved (deleted here,
  // inserted again below).
  const remaining: { id: string; pos: number; size: number }[] = [];
  tr.doc.forEach((n, offset) => remaining.push({ id: n.attrs.id as string, pos: offset, size: n.nodeSize }));
  const keep = longestIncreasing(remaining.map((r) => wantIndex.get(r.id) ?? -1));
  for (let i = remaining.length - 1; i >= 0; i--) {
    if (!keep.has(i)) tr.delete(remaining[i]!.pos, remaining[i]!.pos + remaining[i]!.size);
  }

  // 3. Walk the wanted order: patch blocks that stayed, insert the rest.
  let pos = 0;
  let index = 0;
  for (const { block, depth } of desired) {
    const want = build(block, depth);
    const here = tr.doc.maybeChild(index);
    if (here && here.attrs.id === block.id) {
      const have = currentBlocks.get(block.id);
      if (!have || contentKey(have) !== contentKey(block) || Number(here.attrs.depth ?? 0) !== depth) patchNode(tr, pos, here, want);
      pos += tr.doc.child(index).nodeSize;
    } else {
      tr.insert(pos, want);
      pos += want.nodeSize;
    }
    index++;
  }
  // Anything left after the wanted blocks (a line the editor added while the note was briefly empty) goes.
  for (let i = tr.doc.childCount - 1; i >= desired.length; i--) {
    let at = 0;
    for (let k = 0; k < i; k++) at += tr.doc.child(k).nodeSize;
    tr.delete(at, at + tr.doc.child(i).nodeSize);
  }
  // An empty note still has one line to type in.
  if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph!.create({ id: null, depth: 0 }));
  if (!tr.docChanged) return null;
  tr.setMeta("preventClearDocument", true);

  // The caret's block was moved: put the caret back where it was inside it.
  if (caretId) {
    const $now = tr.selection.$head;
    const nowId = $now.depth >= 1 ? ($now.node(1).attrs.id as string | null) : null;
    if (nowId !== caretId) {
      tr.doc.forEach((n, offset) => {
        if (n.attrs.id === caretId) tr.setSelection(TextSelection.near(tr.doc.resolve(offset + 1 + Math.min(caretOffset, n.content.size))));
      });
    }
  }
  return tr;
}
