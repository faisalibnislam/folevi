import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { validateWireBlock, type WireBlock } from "@folevi/editor-schema";

vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(async (code: string) => (code.includes("oops") ? { error: "Parse error on line 1" } : { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>', width: 120, height: 80 })),
  svgDataUrl: (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
}));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { blocksToDoc, docToBlocks } = await import("@/components/editor/convert");
const { emptyTableRows, insertBlockAfterCurrent, insertBlockAt } = await import("@/components/editor/commands");
const { MERMAID_SAMPLE } = await import("@/components/editor/insertCatalog");

function makeEditor() {
  const start: WireBlock[] = [{ id: "01JAINSERTWEB000000000000A1", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text: "Intro" }], props: {} }];
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS], content: blocksToDoc(start) });
}

const canonical = (editor: Editor) => docToBlocks(editor.state.doc, new Map());

describe("Insert panel blocks in the editor", () => {
  test("divider styles, page breaks, formulas, whiteboards and picked tables become valid canonical blocks", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(3);
    insertBlockAfterCurrent(editor, "divider", { style: "extralight" });
    insertBlockAfterCurrent(editor, "pageBreak");
    insertBlockAfterCurrent(editor, "formula", { latex: "a^2+b^2=c^2" });
    insertBlockAfterCurrent(editor, "whiteboard", { data: "", height: 420 });
    insertBlockAfterCurrent(editor, "table", { headerRow: true, rows: emptyTableRows(3, 4) });
    const blocks = canonical(editor);
    const byType = (t: string) => blocks.find((b) => b.type === t)!;
    expect(byType("divider").props).toEqual({ style: "extralight" });
    expect(byType("pageBreak").props).toEqual({});
    expect(byType("formula").props).toEqual({ latex: "a^2+b^2=c^2" });
    expect(byType("whiteboard").props).toEqual({ data: "", height: 420 });
    const rows = byType("table").props.rows as unknown[][];
    expect([rows.length, rows[0]!.length]).toEqual([3, 4]);
    for (const b of blocks) expect(validateWireBlock(b), b.type).toEqual([]);
    editor.destroy();
  });

  test("a dropped item lands at the drop index with its text (Mermaid sample)", () => {
    const editor = makeEditor();
    insertBlockAt(editor, 0, 0, "code", { language: "mermaid" }, MERMAID_SAMPLE);
    const [first] = canonical(editor);
    expect(first).toMatchObject({ type: "code", props: { language: "mermaid", code: MERMAID_SAMPLE } });
    editor.destroy();
  });

  test("Mermaid code blocks show a rendered preview; other languages don't", async () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(3);
    insertBlockAfterCurrent(editor, "code", { language: "mermaid" }, "flowchart TD\n  A --> B");
    const pre = editor.view.dom.querySelector("pre.fb-code-mermaid")!;
    expect(pre).toBeTruthy();
    await vi.waitFor(() => expect(pre.querySelector("img.fb-mermaid-svg")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/));
    // The preview is outside the editable text.
    expect(pre.querySelector("code")!.textContent).toBe("flowchart TD\n  A --> B");
    // Switching language removes the preview.
    let pos = -1;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === "codeBlock") pos = off;
    });
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, language: "python" }));
    expect(editor.view.dom.querySelector(".fb-mermaid-preview")).toBeNull();
    editor.destroy();
  });

  test("Mermaid syntax errors show a friendly message", async () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(3);
    insertBlockAfterCurrent(editor, "code", { language: "mermaid" }, "oops");
    await vi.waitFor(() => expect(editor.view.dom.querySelector(".fb-mermaid-error")?.textContent).toContain("Couldn’t draw this diagram"));
    editor.destroy();
  });
});
