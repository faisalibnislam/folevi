import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { canonicalJson, flattenTree, type WireBlock } from "@folevi/editor-schema";
import golden from "@folevi/editor-schema/fixtures/document-golden.json";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { blocksToDoc, diffBlocks, docToBlocks } from "@/components/editor/convert";
import { changeDepth, moveBlock, turnInto } from "@/components/editor/commands";
import { htmlToBlocks } from "@/components/editor/paste";

const blocks = golden.blocks as unknown as WireBlock[];

function makeEditor(content: ReturnType<typeof blocksToDoc>) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content });
}

describe("editor ↔ canonical blocks", () => {
  test("every golden block survives blocks → editor → blocks unchanged (ids, tree, content, unknown types)", () => {
    const editor = makeEditor(blocksToDoc(blocks));
    const previous = new Map(blocks.map((b) => [b.id, b]));
    const back = docToBlocks(editor.state.doc, previous);
    const norm = (list: WireBlock[]) => canonicalJson(flattenTree(list).map((e) => ({ ...e.block, depth: e.depth })));
    expect(norm(back)).toBe(norm(blocks));
    expect(diffBlocks(previous, back)).toEqual({ upserts: [], deletes: [] });
    editor.destroy();
  });

  test("turning a block into another type is a content change only; nesting is a position change only", () => {
    const editor = makeEditor(blocksToDoc(blocks));
    const previous = new Map(docToBlocks(editor.state.doc, new Map(blocks.map((b) => [b.id, b]))).map((b) => [b.id, b]));
    editor.commands.setTextSelection(3); // inside the first (heading) block's text? first block is heading
    turnInto(editor, "paragraph");
    let diff = diffBlocks(previous, docToBlocks(editor.state.doc, previous));
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]!.fields).toEqual(["content"]);
    const prev2 = new Map(docToBlocks(editor.state.doc, previous).map((b) => [b.id, b]));
    // Place the cursor in the 3rd block (bulleted "Tide tables") and indent it under the paragraph.
    let pos = 0;
    editor.state.doc.forEach((n, off, i) => {
      if (i === 2) pos = off + 2;
    });
    editor.commands.setTextSelection(pos);
    expect(changeDepth(editor, 1)).toBe(true);
    diff = diffBlocks(prev2, docToBlocks(editor.state.doc, prev2));
    expect(diff.upserts.every((u) => !u.fields.includes("content"))).toBe(true);
    expect(diff.deletes).toEqual([]);
    editor.destroy();
  });

  test("moving a block keeps sibling ranks stable (only the moved block is re-ranked)", () => {
    const simple: WireBlock[] = ["a", "b", "c", "d"].map((t, i) => ({ id: `id${t}`, type: "paragraph", parentId: null, rank: String(i + 1), schemaVersion: 1, text: [{ type: "text", text: t }], props: {} }));
    const editor = makeEditor(blocksToDoc(simple));
    const prev = new Map(simple.map((b) => [b.id, b]));
    let pos = 0;
    editor.state.doc.forEach((n, off, i) => {
      if (i === 3) pos = off + 1;
    });
    editor.commands.setTextSelection(pos);
    moveBlock(editor, -1);
    const diff = diffBlocks(prev, docToBlocks(editor.state.doc, prev));
    expect(diff.upserts.map((u) => u.block.id)).toEqual(["idd"]);
    expect(diff.upserts[0]!.fields).toEqual(["position"]);
    editor.destroy();
  });

  test("duplicate or missing block ids are repaired automatically", () => {
    const dup: WireBlock[] = [
      { id: "same", type: "paragraph", parentId: null, rank: "1", schemaVersion: 1, text: [{ type: "text", text: "one" }], props: {} },
      { id: "other", type: "paragraph", parentId: null, rank: "2", schemaVersion: 1, text: [{ type: "text", text: "two" }], props: {} },
    ];
    const editor = makeEditor(blocksToDoc(dup));
    editor.commands.setTextSelection(4);
    editor.commands.splitBlock();
    const ids: string[] = [];
    editor.state.doc.forEach((n) => ids.push(n.attrs.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Boolean)).toBe(true);
    editor.destroy();
  });
});

describe("paste normalization", () => {
  test("HTML from other apps becomes clean blocks with nesting, tasks and safe links", () => {
    const html = `<h1>Trip</h1><p>Go <strong>early</strong> and <a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>
      <ul><li>Pack<ul><li>Socks</li></ul></li><li><input type="checkbox" checked> Tickets</li></ul>
      <pre><code class="language-python">print(1)</code></pre><script>evil()</script><table><tr><th>A</th></tr><tr><td>1</td></tr></table>`;
    const out = htmlToBlocks(html);
    const flat = flattenTree(out).map((e) => `${"  ".repeat(e.depth)}${e.block.type}`);
    expect(flat).toEqual(["heading", "paragraph", "bulleted", "  bulleted", "todo", "code", "table"]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("evil");
    expect(json).toContain('"href":"https://example.com"');
    expect(out.find((b) => b.type === "todo")!.props).toEqual({ checked: true });
  });
});
