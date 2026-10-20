// Presenting a note: where slides start (src/slides.ts).
import { describe, expect, it } from "vitest";
import { flattenTree, slidesOf, splitSlides, type WireBlock } from "../src";

let n = 0;
function b(type: string, text = "", props: Record<string, unknown> = {}, parentId: string | null = null): WireBlock {
  const i = ++n;
  return { id: `01JASLIDES00000000000000${String(i).padStart(2, "0")}`, type, parentId, rank: `a${String(i).padStart(4, "0")}1`, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props };
}
const h = (level: number, text: string) => b("heading", text, { level });
const p = (text: string) => b("paragraph", text);
/** Each slide's lines, as their text (or type). */
const texts = (slides: WireBlock[][]) => slides.map((s) => s.map((x) => (x.text[0]?.type === "text" ? x.text[0].text : x.type)));

describe("splitSlides", () => {
  it("starts a slide at every divider and page break (the line itself isn't shown)", () => {
    const blocks = [h(1, "Title"), p("one"), b("divider"), p("two"), h(1, "Not a cut"), b("pageBreak"), p("three")];
    const split = splitSlides(flattenTree(blocks));
    expect(split.cut).toBe("breaks");
    expect(texts(split.slides.map((s) => s.map((e) => e.block)))).toEqual([["Title", "one"], ["two", "Not a cut"], ["three"]]);
  });

  it("without breaks, starts a slide at every top-level Heading 1", () => {
    const blocks = [p("intro"), h(1, "A"), p("a"), h(2, "A.1"), p("a1"), h(1, "B"), p("b")];
    const split = splitSlides(flattenTree(blocks));
    expect(split.cut).toBe("heading1");
    expect(texts(split.slides.map((s) => s.map((e) => e.block)))).toEqual([["intro"], ["A", "a", "A.1", "a1"], ["B", "b"]]);
  });

  it("without breaks or Heading 1, starts a slide at every Heading 2", () => {
    const blocks = [h(2, "A"), p("a"), h(3, "small"), h(2, "B"), p("b")];
    const split = splitSlides(flattenTree(blocks));
    expect(split.cut).toBe("heading2");
    expect(texts(split.slides.map((s) => s.map((e) => e.block)))).toEqual([["A", "a", "small"], ["B", "b"]]);
  });

  it("puts a note with no breaks and no headings on one slide", () => {
    const split = splitSlides(flattenTree([p("one"), p("two"), h(3, "three")]));
    expect(split.cut).toBe("none");
    expect(split.slides).toHaveLength(1);
  });

  it("leaves out empty slides (dividers in a row, empty lines only)", () => {
    const blocks = [b("divider"), p(""), b("divider"), b("divider"), p("real"), b("divider")];
    expect(texts(slidesOf(blocks))).toEqual([["real"]]);
    expect(slidesOf([])).toEqual([]);
  });

  it("never splits nested blocks: breaks and headings only count at the top level", () => {
    const one = h(1, "One");
    const toggle = b("toggle", "Open me", { collapsed: false });
    const nestedHeading = { ...h(1, "Inside"), parentId: toggle.id };
    const nestedDivider = b("divider", "", {}, toggle.id);
    const child = { ...p("child"), parentId: toggle.id };
    const blocks = [one, toggle, nestedHeading, nestedDivider, child, h(1, "Two")];
    const slides = slidesOf(blocks);
    expect(texts(slides)).toEqual([["One", "Open me", "Inside", "divider", "child"], ["Two"]]);
    // Each slide is a whole tree: its nested blocks' parents are on it.
    for (const s of slides) for (const x of s) if (x.parentId) expect(s.some((y) => y.id === x.parentId)).toBe(true);
  });

  it("keeps a tabs block and all its tabs on one slide", () => {
    const intro = h(1, "Intro");
    const tabs = b("tabs");
    const t1 = b("tab", "First", {}, tabs.id);
    const inT1 = { ...h(1, "Heading in a tab"), parentId: t1.id };
    const t2 = b("tab", "Second", {}, tabs.id);
    const blocks = [intro, tabs, t1, inT1, t2, h(1, "End")];
    expect(texts(slidesOf(blocks))).toEqual([["Intro", "tabs", "First", "Heading in a tab", "Second"], ["End"]]);
  });
});
