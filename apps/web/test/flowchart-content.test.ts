// Flowchart shapes and content: the shape library's sections, the pure edits for what a shape holds
// (kind, label formatting and colour, auto-height, fit to text, icons, images, notes, page links, paint)
// and the label editor's document conversions.
import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { FLOWCHART_LIMITS, FLOWCHART_SHAPES, FLOWCHART_SHAPE_SIZE, flowchart, flowchartDataIssue, parseFlowchart, richPlainText, serializeFlowchart, type FlowNode } from "@folevi/editor-schema";

vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(),
  svgDataUrl: (svg: string) => svg,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
}));

const lib = await import("@/components/editor/flowchart/chrome/librarySections");
const ops = await import("@/components/editor/flowchart/contentOps");
const { LABEL_EXTENSIONS, labelDoc, labelParagraphs, pastedLines } = await import("@/components/editor/flowchart/richLabel");

const node = (extra: Partial<FlowNode> = {}): FlowNode => ({ id: "a1", shape: "process", x: 0, y: 0, w: 160, h: 64, text: "Review", color: "neutral", ...extra });

/** The node as the server would store it, read back. */
const roundTrip = (n: FlowNode) => {
  const data = serializeFlowchart(flowchart({ nodes: [n] }));
  expect(flowchartDataIssue(data)).toBeNull();
  return parseFlowchart(data).nodes[0]!;
};

describe("the shape library", () => {
  test("lists all 53 shapes once, in Flowchart, Basic, and Arrows and callouts", () => {
    const sections = lib.librarySections("");
    expect(sections.map((s) => s.label)).toEqual(["Flowchart", "Basic", "Arrows and callouts"]);
    const all = sections.flatMap((s) => s.shapes);
    expect(all).toHaveLength(53);
    expect(new Set(all)).toEqual(new Set(FLOWCHART_SHAPES));
    expect(sections[0]!.shapes.slice(0, 4)).toEqual(["process", "decision", "terminator", "io"]);
    expect(sections[2]!.shapes).toEqual(expect.arrayContaining(["arrowRight", "chevron", "callout", "annotation"]));
    expect(lib.libraryGroup("database")).toBe("flowchart");
    expect(lib.libraryGroup("note")).toBe("basic");
    expect(lib.libraryGroup("cloud")).toBe("basic");
  });

  test("search narrows the sections and drops empty ones", () => {
    const s = lib.librarySections("data");
    expect(s.flatMap((x) => x.shapes)).toEqual(expect.arrayContaining(["database", "storedData", "io"]));
    expect(s.every((x) => x.shapes.length)).toBe(true);
    expect(lib.librarySections("arrow").map((x) => x.id)).toEqual(["arrows"]);
    expect(lib.librarySections("zzzz")).toEqual([]);
  });
});

describe("changing a shape's kind", () => {
  test("a shape at its default size takes the new kind's size, keeping its centre", () => {
    const n = node({ x: 80, y: 40 });
    const next = ops.changeShape(n, "database");
    expect(next.shape).toBe("database");
    expect(next.w).toBe(FLOWCHART_SHAPE_SIZE.database.w);
    expect(next.x + next.w / 2).toBeCloseTo(n.x + n.w / 2, -1);
    expect(next.y + next.h / 2).toBeCloseTo(n.y + n.h / 2, -1);
  });

  test("a resized shape keeps its size; square kinds stay square", () => {
    const n = node({ w: 240, h: 120 });
    expect(ops.changeShape(n, "hexagon")).toMatchObject({ w: 240, h: 120 });
    const c = ops.changeShape(n, "connector");
    expect(c.w).toBe(c.h);
    expect(ops.changeShape(n, "process")).toBe(n);
  });
});

describe("labels", () => {
  test("text and rich stay in step: formatting is kept only when there is some", () => {
    const plain = ops.withParagraphs(node(), [{ text: [{ type: "text", text: "One" }] }, { text: [{ type: "text", text: "Two" }] }]);
    expect(plain.text).toBe("One\nTwo");
    expect(plain.rich).toBeUndefined();
    const rich = ops.withParagraphs(node(), [{ text: [{ type: "text", text: "Ship " }, { type: "text", text: "it", marks: [{ type: "bold" }] }] }, { list: "bullet", text: [{ type: "text", text: "today" }] }]);
    expect(rich.text).toBe("Ship it\ntoday");
    expect(richPlainText(rich.rich!)).toBe(rich.text);
    const back = roundTrip(rich);
    expect(back.rich?.[0]?.text[1]?.marks).toEqual([{ type: "bold" }]);
    expect(back.rich?.[1]?.list).toBe("bullet");
  });

  test("labels keep to the model's limits", () => {
    const long = ops.withParagraphs(node(), [{ text: [{ type: "text", text: "x".repeat(FLOWCHART_LIMITS.maxText + 50) }] }]);
    expect(long.text.length).toBe(FLOWCHART_LIMITS.maxText);
    const many = ops.withParagraphs(node({ id: "b2" }), Array.from({ length: 60 }, (_, i) => ({ text: [{ type: "text" as const, text: `L${i}` }] })));
    expect(many.text.split("\n")).toHaveLength(FLOWCHART_LIMITS.maxParagraphs);
    expect(flowchartDataIssue(serializeFlowchart(flowchart({ nodes: [long, many] })))).toBeNull();
  });

  test("the whole label takes a text colour, and gives it back", () => {
    const n = ops.withParagraphs(node(), [{ text: [{ type: "text", text: "Ship " }, { type: "text", text: "it", marks: [{ type: "bold" }] }] }]);
    const red = ops.setLabelColor(n, "coral");
    expect(ops.labelColor(red)).toBe("coral");
    expect(red.rich?.[0]?.text[1]?.marks).toEqual([{ type: "bold" }, { type: "color", value: "coral" }]);
    expect(roundTrip(red).rich?.[0]?.text[0]?.marks).toEqual([{ type: "color", value: "coral" }]);
    const back = ops.setLabelColor(red, null);
    expect(ops.labelColor(back)).toBeNull();
    expect(back.rich?.[0]?.text[1]?.marks).toEqual([{ type: "bold" }]);
    expect(ops.labelColor(ops.setLabelColor(ops.setLabelColor(node(), null), null))).toBeNull();
    // Plain text with no formatting left has no rich text.
    expect(ops.setLabelColor(ops.setLabelColor(node(), "moss"), null).rich).toBeUndefined();
  });

  test("bold, italic and the rest toggle over the whole label", () => {
    const b = ops.toggleLabelMark(node(), "bold");
    expect(b.rich?.[0]?.text[0]?.marks).toEqual([{ type: "bold" }]);
    expect(ops.toggleLabelMark(b, "bold").rich).toBeUndefined();
  });

  test("alignment: centre is the default and isn't stored", () => {
    expect(ops.setAlign(node(), "left").align).toBe("left");
    expect("align" in ops.setAlign(node({ align: "left" }), "center")).toBe(false);
  });

  test("link addresses are made safe", () => {
    expect(ops.safeHref("folevi.com/plans")).toBe("https://folevi.com/plans");
    expect(ops.safeHref("https://example.com")).toBe("https://example.com");
    expect(ops.safeHref("javascript:alert(1)")).toBeNull();
    expect(ops.safeHref("  ")).toBeNull();
  });
});

describe("size", () => {
  test("grow with text sets the height to the text, and follows it", () => {
    const n = node({ h: 200, text: "Short" });
    const auto = ops.setAutoHeight(n, true);
    expect(auto.autoHeight).toBe(true);
    expect(auto.h).toBeLessThan(200);
    const off = ops.setAutoHeight(auto, false);
    expect("autoHeight" in off).toBe(false);
    expect(roundTrip(auto).autoHeight).toBe(true);
  });

  test("fit to text shrinks and grows once, keeping the centre", () => {
    const tall = node({ h: 400, y: 0 });
    const fit = ops.fitToText(tall);
    expect(fit.h).toBeLessThan(400);
    expect(fit.y + fit.h / 2).toBeCloseTo(200, -1);
    const crowded = node({ w: 80, h: 32, text: "A much longer label that needs several lines to fit" });
    expect(ops.fitToText(crowded).h).toBeGreaterThan(32);
    const sq = ops.fitToText(node({ shape: "circle", w: 104, h: 104 }));
    expect(sq.w).toBe(sq.h);
  });
});

describe("icons, images, notes and page links", () => {
  test("icons go beside, above or in the corner; removing one removes it", () => {
    const left = ops.setIcon(node(), { name: "user" });
    expect(left.icon).toEqual({ name: "user" });
    expect(ops.setIcon(node(), { name: "user", place: "top" }).icon).toEqual({ name: "user", place: "top" });
    expect("icon" in ops.setIcon(left, null)).toBe(false);
    expect(roundTrip(ops.setIcon(node(), { name: "database", place: "badge" })).icon).toEqual({ name: "database", place: "badge" });
  });

  test("an image is stored by file id, with its fit; a shape with text makes room for it", () => {
    const n = ops.setImage(node(), { fileId: "f_abc123" });
    expect(n.image).toEqual({ fileId: "f_abc123" });
    expect(n.h).toBeGreaterThan(64);
    expect(ops.setImage(n, { fileId: "f_abc123", fit: "contain" }).image).toEqual({ fileId: "f_abc123", fit: "contain" });
    expect("image" in ops.setImage(n, null)).toBe(false);
    expect(roundTrip(n).image).toEqual({ fileId: "f_abc123" });
  });

  test("a new image shape is sized to the picture", () => {
    expect(ops.imageNodeSize(1600, 1200)).toEqual({ w: 240, h: 184 });
    const tall = ops.imageNodeSize(600, 1200);
    expect(tall.h).toBe(200);
    expect(tall.w).toBeLessThan(120);
    expect(ops.imageNodeSize(0, 0).w).toBe(240);
  });

  test("notes are cleaned and an empty one is removed", () => {
    const n = ops.setNote(node(), "Ask finance first.\u0007  \n");
    expect(n.note).toBe("Ask finance first.");
    expect("note" in ops.setNote(n, "   ")).toBe(false);
    expect(ops.setNote(node(), "x".repeat(3000)).note).toHaveLength(FLOWCHART_LIMITS.maxNote);
    expect(roundTrip(n).note).toBe("Ask finance first.");
  });

  test("page links keep the page's title", () => {
    const n = ops.setLink(node(), { documentId: "01JDOC0000000000000000000A", title: "  Plan  " });
    expect(n.link).toEqual({ documentId: "01JDOC0000000000000000000A", title: "Plan" });
    expect("link" in ops.setLink(n, null)).toBe(false);
    expect(roundTrip(n).link).toEqual({ documentId: "01JDOC0000000000000000000A", title: "Plan" });
  });
});

describe("paint", () => {
  test("custom fill and outline, a theme tint clearing the custom fill, invalid colours ignored", () => {
    const n = ops.setPaint(node(), { fill: "#1E3A8A", stroke: "none", strokeWidth: 3, strokeStyle: "dashed" });
    expect(n).toMatchObject({ fill: "#1e3a8a", stroke: "none", strokeWidth: 3, strokeStyle: "dashed" });
    expect(roundTrip(n)).toMatchObject({ fill: "#1e3a8a", stroke: "none", strokeWidth: 3, strokeStyle: "dashed" });
    const tinted = ops.setPaint(n, { color: "green" });
    expect(tinted.color).toBe("green");
    expect("fill" in tinted).toBe(false);
    expect(ops.setPaint(n, { fill: "red" }).fill).toBe("#1e3a8a");
    expect("strokeStyle" in ops.setPaint(n, { strokeStyle: "solid" })).toBe(false);
    expect(ops.setPaint(n, { strokeWidth: 99 }).strokeWidth).toBe(FLOWCHART_LIMITS.maxStrokeWidth);
  });

  test("colours typed by hand", () => {
    expect(ops.parseHex("#abc")).toBe("#aabbcc");
    expect(ops.parseHex("1E3A8A")).toBe("#1e3a8a");
    expect(ops.parseHex("blue")).toBeNull();
  });

  test("edits over a selection change only those shapes, and nothing at all when nothing changes", () => {
    const fc = flowchart({ nodes: [node(), node({ id: "b2", x: 300 })] });
    const next = ops.patchNodes(fc, ["b2"], (n) => ops.setPaint(n, { color: "blue" }));
    expect(next.nodes[0]).toBe(fc.nodes[0]);
    expect(next.nodes[1]!.color).toBe("blue");
    expect(ops.patchNodes(fc, ["a1"], (n) => n)).toBe(fc);
  });
});

describe("the label editor's document", () => {
  const editorFor = (n: FlowNode) => new Editor({ element: document.createElement("div"), extensions: LABEL_EXTENSIONS, content: labelDoc(n) });

  test("formatting, lists and links survive a round trip through the editor", () => {
    const n = ops.withParagraphs(node(), [
      { text: [{ type: "text", text: "Ship " }, { type: "text", text: "it", marks: [{ type: "bold" }, { type: "italic" }] }] },
      { list: "ordered", text: [{ type: "text", text: "Docs", marks: [{ type: "link", href: "https://folevi.com/" }] }] },
      { list: "ordered", text: [{ type: "text", text: "Red", marks: [{ type: "color", value: "coral" }] }] },
      { text: [] },
    ]);
    const ed = editorFor(n);
    const back = ops.withParagraphs(node(), labelParagraphs(ed.state.doc));
    expect(back.text).toBe(n.text);
    expect(back.rich).toEqual(n.rich);
    ed.destroy();
  });

  test("a label edited without its formatting reads as its plain text", () => {
    const ed = editorFor(node({ text: "Changed", rich: [{ text: [{ type: "text", text: "Old", marks: [{ type: "bold" }] }] }] }));
    expect(ed.state.doc.textContent).toBe("Changed");
    ed.destroy();
  });

  test("typing bold in the editor ends up as a bold run", () => {
    const ed = editorFor(node({ text: "" }));
    ed.commands.insertContent("Plan ");
    ed.chain().toggleMark("bold").insertContent("now").run();
    const n = ops.withParagraphs(node(), labelParagraphs(ed.state.doc));
    expect(n.text).toBe("Plan now");
    expect(n.rich?.[0]?.text).toEqual([{ type: "text", text: "Plan " }, { type: "text", text: "now", marks: [{ type: "bold" }] }]);
    ed.destroy();
  });

  test("pasted text arrives plain, one line per paragraph", () => {
    expect(pastedLines("one\r\ntwo\tthree\u0001")).toEqual(["one", "two three"]);
  });
});

describe("placing a new image shape", () => {
  test("the nearest spot that overlaps nothing", () => {
    const fc = flowchart({ nodes: [node({ x: -80, y: -32 })] });
    expect(ops.freeSpot(flowchart(), { x: 0, y: 0 }, 200, 200)).toEqual({ x: 0, y: 0 });
    const p = ops.freeSpot(fc, { x: 0, y: 0 }, 200, 200);
    expect(p).not.toEqual({ x: 0, y: 0 });
    const r = { x: p.x - 100, y: p.y - 100, w: 200, h: 200 };
    const n = fc.nodes[0]!;
    expect(n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y).toBe(false);
  });
});
