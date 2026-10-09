import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { canJoin } from "@tiptap/pm/transform";
import { assignTreePositions, flattenTree, rankBetween, type WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { diffBlocks, docToBlocks, localChanges, nodeToFlat, type FlatBlock } from "@/components/editor/convert";

/** A small seeded random number generator, so a failure can be replayed. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fresh = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** What a flush finds without any of the conversion's caches: every block converted, positioned and compared afresh. */
function fullChanges(doc: Editor["state"]["doc"], shown: ReadonlyMap<string, WireBlock>, schema: Schema) {
  const flat: FlatBlock[] = [];
  doc.forEach((node) => {
    const f = nodeToFlat(node);
    if (f) flat.push(f);
  });
  const positions = assignTreePositions(flat.map((f) => ({ id: f.id, depth: f.depth, rank: shown.get(f.id)?.rank, parentId: shown.get(f.id)?.parentId })));
  const next: WireBlock[] = flat.map((f) => {
    const p = positions.get(f.id)!;
    return { id: f.id, type: f.type, parentId: p.parentId, rank: p.rank, schemaVersion: f.schemaVersion, text: f.text, props: f.props };
  });
  const diff = diffBlocks(new Map([...shown].map(([id, b]) => [id, fresh(b)])), fresh(next), schema);
  const deleted = new Set(diff.deletes);
  const deletes = flattenTree([...shown.values()])
    .map((e) => e.block.id)
    .filter((id) => deleted.has(id))
    .reverse();
  return { next, upserts: diff.upserts, deletes };
}

const TEXT_TYPES = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle"] as const;

function makeEditor(rand: () => number, size: number) {
  const content: JSONContent[] = [];
  let depth = 0;
  for (let i = 0; i < size; i++) {
    depth = Math.max(0, Math.min(depth + Math.floor(rand() * 3) - 1, 3));
    const type = TEXT_TYPES[Math.floor(rand() * TEXT_TYPES.length)]!;
    if (rand() < 0.08) content.push({ type: "table", attrs: { depth, headerRow: true, rows: [[[{ type: "text", text: `t${i}` }], [{ type: "text", text: "b" }]]] } });
    else content.push({ type, attrs: { depth, ...(type === "heading" ? { level: 2 } : {}), ...(type === "toggle" ? { collapsed: rand() < 0.3 } : {}) }, content: [{ type: "text", text: `line ${i} words` }] });
  }
  const editor = new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, BlockIdentity], content: { type: "doc", content } });
  // Ids for every block (BlockIdentity runs on the first change of structure).
  editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph!.create({ depth: 0 })));
  return editor;
}

/** One random edit: typing, deleting, Enter, joining lines, nesting, moving, formatting, retyping, adding or removing a line, a toggle or a table cell. */
function randomEdit(editor: Editor, rand: () => number) {
  const { state } = editor;
  const doc = state.doc;
  const pick = (n: number) => Math.floor(rand() * n);
  const index = pick(doc.childCount);
  let start = 0;
  for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
  const node = doc.child(index);
  const tr = state.tr;
  const kind = pick(11);
  if (kind === 0 && node.isTextblock) tr.insertText(["a", "cat ", "é", "x y"][pick(4)]!, start + 1 + pick(node.content.size + 1));
  else if (kind === 1 && node.isTextblock && node.content.size > 1) {
    const from = start + 1 + pick(node.content.size - 1);
    tr.delete(from, Math.min(from + 1 + pick(4), start + 1 + node.content.size));
  } else if (kind === 2 && node.isTextblock) tr.split(start + 1 + pick(node.content.size + 1));
  else if (kind === 3 && index > 0 && node.isTextblock && doc.child(index - 1).type === node.type && canJoin(doc, start)) tr.join(start);
  else if (kind === 4) tr.setNodeMarkup(start, undefined, { ...node.attrs, depth: Math.max(0, Number(node.attrs.depth ?? 0) + (rand() < 0.5 ? -1 : 1)) });
  else if (kind === 5 && doc.childCount > 2) {
    tr.delete(start, start + node.nodeSize);
    const to = pick(tr.doc.childCount + 1);
    let at = 0;
    for (let i = 0; i < to; i++) at += tr.doc.child(i).nodeSize;
    tr.insert(at, node);
  } else if (kind === 6 && node.isTextblock && node.content.size > 1) tr.addMark(start + 1, start + 1 + pick(node.content.size), editor.schema.marks.bold!.create());
  else if (kind === 7 && node.isTextblock) {
    const type = TEXT_TYPES[pick(TEXT_TYPES.length)]!;
    tr.setNodeMarkup(start, editor.schema.nodes[type], { id: node.attrs.id, depth: node.attrs.depth, ...(type === "heading" ? { level: 1 + pick(3) } : {}) });
  } else if (kind === 8 && doc.childCount > 2) tr.delete(start, start + node.nodeSize);
  else if (kind === 9) tr.insert(start, editor.schema.nodes.paragraph!.create({ depth: node.attrs.depth }, editor.schema.text(`new ${pick(100)}`)));
  else if (kind === 10 && node.type.name === "toggle") tr.setNodeMarkup(start, undefined, { ...node.attrs, collapsed: !node.attrs.collapsed });
  else if (kind === 10 && node.type.name === "table") tr.setNodeMarkup(start, undefined, { ...node.attrs, rows: [[[{ type: "text", text: `cell ${pick(9)}` }], [{ type: "text", text: "b" }]]] });
  if (tr.docChanged) editor.view.dispatch(tr);
}

describe("incremental flush", () => {
  test("converting only what changed gives exactly what a full conversion gives, over random edits in two notes", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rand = random(seed);
      const notes = [makeEditor(rand, 30), makeEditor(rand, 12)].map((editor) => ({
        editor,
        shown: new Map(docToBlocks(editor.state.doc, new Map()).map((b) => [b.id, b] as [string, WireBlock])),
      }));
      for (let step = 0; step < 250; step++) {
        // The two notes take turns, so each flush may follow the other note's.
        const note = notes[Math.floor(rand() * notes.length)]!;
        const { editor } = note;
        for (let k = 1 + Math.floor(rand() * 3); k > 0; k--) randomEdit(editor, rand);
        if (rand() < 0.4) continue;
        const expected = fullChanges(editor.state.doc, note.shown, editor.schema);
        const got = localChanges(editor.state.doc, note.shown, editor.schema);
        expect(JSON.stringify(got), `seed ${seed}, step ${step}`).toBe(JSON.stringify(expected));
        // As the editor does: what it saved is what it shows; sometimes it shows the engine's copies instead
        // (a remote change taken in), which are other objects with the same content.
        note.shown = new Map(got.next.map((b) => [b.id, rand() < 0.15 ? fresh(b) : b]));
        // Now and then a block's place changes from elsewhere (a rebalance, a move on another device).
        if (rand() < 0.2) {
          const ids = [...note.shown.keys()];
          const id = ids[Math.floor(rand() * ids.length)]!;
          const b = note.shown.get(id)!;
          note.shown.set(id, { ...b, rank: rand() < 0.5 ? `${b.rank}V` : rankBetween(null, b.rank), parentId: rand() < 0.2 ? null : b.parentId });
        }
      }
      for (const { editor } of notes) editor.destroy();
    }
  });
});
