// Tabs inside a note (src/tabs.ts): a `tabs` block holding `tab` blocks (their text is the name) that hold
// the tab's blocks. The server's checks, the structure readers and the exports (every tab under its name).
import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  blocksToHtml,
  blocksToMarkdown,
  documentSearchText,
  flattenTree,
  liftTabs,
  repairWireBlock,
  tabGroupAt,
  tabName,
  tabNameText,
  validateWireBlock,
  type WireBlock,
} from "../src";

let n = 0;
const id = () => `01JATABS0000000000000000${String(++n).padStart(2, "0")}`;
function b(type: string, parentId: string | null, rank: string, text = "", props: Record<string, unknown> = {}): WireBlock {
  return { id: id(), type, parentId, rank, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props };
}

/** A note: an intro line, tabs "Plan" (two lines, one nested) and "Notes" (a list), then a closing line. */
function note() {
  const intro = b("paragraph", null, "A", "Intro");
  const tabs = b("tabs", null, "B");
  const plan = b("tab", tabs.id, "A", "Plan");
  const step = b("paragraph", plan.id, "A", "First step");
  const detail = b("bulleted", step.id, "A", "Detail");
  const notes = b("tab", tabs.id, "B", "Notes");
  const item = b("bulleted", notes.id, "A", "Remember milk");
  const outro = b("paragraph", null, "C", "After the tabs");
  return { blocks: [intro, tabs, plan, step, detail, notes, item, outro], tabs, plan, notes, step, detail, item };
}

describe("tabs schema", () => {
  it("knows both block types", () => {
    expect(BLOCK_TYPES).toContain("tabs");
    expect(BLOCK_TYPES).toContain("tab");
  });

  it("accepts a tabs block without text and a tab with its name as text", () => {
    const { tabs, plan } = note();
    expect(validateWireBlock(tabs)).toEqual([]);
    expect(validateWireBlock(plan)).toEqual([]);
  });

  it("refuses text on the tabs block and repairs it away", () => {
    const bad = { ...b("tabs", null, "A"), text: [{ type: "text" as const, text: "nope" }] };
    expect(validateWireBlock(bad).length).toBeGreaterThan(0);
    const { block } = repairWireBlock(bad);
    expect(validateWireBlock(block)).toEqual([]);
    expect(block.text).toEqual([]);
  });

  it("names tabs from their text, on one line, Untitled when empty", () => {
    expect(tabName({ text: [{ type: "text", text: "  Q3\n plan " }] })).toBe("Q3 plan");
    expect(tabName({ text: [] })).toBe("Untitled");
    expect(tabNameText("  a   b ")).toEqual([{ type: "text", text: "a b" }]);
    expect(tabNameText("   ")).toEqual([]);
    expect(tabNameText("x".repeat(200))[0]).toMatchObject({ text: "x".repeat(60) });
  });
});

describe("tab structure", () => {
  it("finds a tabs block's tabs and where each one's contents end", () => {
    const { blocks, plan, notes } = note();
    const flat = flattenTree(blocks);
    const group = tabGroupAt(flat, 1)!;
    expect(group.tabs.map((t) => t.block.id)).toEqual([plan.id, notes.id]);
    expect(group.tabs.map((t) => [t.index, t.end])).toEqual([
      [2, 5],
      [5, 7],
    ]);
    expect(group.end).toBe(7);
    expect(tabGroupAt(flat, 0)).toBeNull();
  });

  it("shows a tab's contents at the tabs block's level, keeping nesting inside them", () => {
    const { blocks } = note();
    const lifted = liftTabs(flattenTree(blocks)).map((e) => [e.block.text[0]?.type === "text" ? e.block.text[0].text : e.block.type, e.depth]);
    expect(lifted).toEqual([
      ["Intro", 0],
      ["tabs", 0],
      ["Plan", 0],
      ["First step", 0],
      ["Detail", 1],
      ["Notes", 0],
      ["Remember milk", 0],
      ["After the tabs", 0],
    ]);
  });

  it("lifts nested tabs and leaves a stray tab (outside any tabs block) alone", () => {
    const tabs = b("tabs", null, "A");
    const outer = b("tab", tabs.id, "A", "Outer");
    const inner = b("tabs", outer.id, "A");
    const innerTab = b("tab", inner.id, "A", "Inner");
    const deep = b("paragraph", innerTab.id, "A", "Deep");
    const stray = b("tab", null, "B", "Stray");
    const strayChild = b("paragraph", stray.id, "A", "Under stray");
    const depths = liftTabs(flattenTree([tabs, outer, inner, innerTab, deep, stray, strayChild])).map((e) => e.depth);
    expect(depths).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });
});

describe("tabs in exports and search", () => {
  it("writes every tab under its name as a heading in Markdown", () => {
    const md = blocksToMarkdown(note().blocks, { title: "Trip" });
    expect(md).toContain("#### Plan\n\nFirst step\n\n  - Detail");
    expect(md).toContain("#### Notes\n\n- Remember milk");
    // Contents aren't indented into a code block.
    expect(md).not.toMatch(/^ {4}First step/m);
    expect(md.indexOf("Intro")).toBeLessThan(md.indexOf("Plan"));
    expect(md.indexOf("Remember milk")).toBeLessThan(md.indexOf("After the tabs"));
  });

  it("writes every tab under its name as a heading in HTML (and so in PDF)", () => {
    const html = blocksToHtml(note().blocks, { title: "Trip" });
    expect(html).toMatch(/<h4 class="tab-name">Plan<\/h4>\s*<p>First step<\/p>/);
    expect(html).toMatch(/<h4 class="tab-name">Notes<\/h4>\s*<ul>\s*<li>Remember milk/);
  });

  it("escapes tab names", () => {
    const tabs = b("tabs", null, "A");
    const t = b("tab", tabs.id, "A", "<b>Hi</b>");
    expect(blocksToHtml([tabs, t], { title: "x" })).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });

  it("finds tab names and what every tab holds", () => {
    const text = documentSearchText("Trip", note().blocks);
    for (const word of ["Plan", "Notes", "First step", "Remember milk"]) expect(text).toContain(word);
  });
});
