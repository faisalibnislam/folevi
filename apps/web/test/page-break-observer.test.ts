// @vitest-environment jsdom
// The page-break mask measures the sheet again only when a block was added, removed or changed its own class,
// never for typing inside a line (it used to walk the whole sheet once a frame while writing).
import { describe, expect, it } from "vitest";
import { movesBlocks } from "@/components/doc/usePageBreakMask";

function sheet() {
  document.body.innerHTML = `<article class="fb-sheet"><header><h1>Title</h1></header><div class="wrap"><div class="fb-editor"><p class="fb"><strong>bold</strong> words</p><div class="fb fb-page-break"></div></div></div></article>`;
  const editor = document.querySelector(".fb-editor")!;
  return { editor, line: editor.children[0]!, pageBreak: editor.children[1]!, strong: document.querySelector("strong")!, wrap: document.querySelector(".wrap")!, title: document.querySelector("h1")! };
}
const record = (type: "childList" | "attributes", target: Node) => ({ type, target }) as unknown as MutationRecord;

describe("what makes the page-break mask measure again", () => {
  it("a block added to or removed from the editor does", () => {
    expect(movesBlocks(record("childList", sheet().editor))).toBe(true);
  });
  it("a block's own class changing does (folded away, selected)", () => {
    const { line, pageBreak } = sheet();
    expect(movesBlocks(record("attributes", pageBreak))).toBe(true);
    expect(movesBlocks(record("attributes", line))).toBe(true);
  });
  it("typing inside a line does not", () => {
    const { line, strong } = sheet();
    expect(movesBlocks(record("childList", line))).toBe(false);
    expect(movesBlocks(record("childList", strong))).toBe(false);
    expect(movesBlocks(record("attributes", strong))).toBe(false);
    expect(movesBlocks(record("childList", line.firstChild!.firstChild!))).toBe(false);
  });
  it("anything outside an editor does (the editor arriving, the header changing)", () => {
    const { wrap, title } = sheet();
    expect(movesBlocks(record("childList", wrap))).toBe(true);
    expect(movesBlocks(record("attributes", title))).toBe(true);
  });
});
