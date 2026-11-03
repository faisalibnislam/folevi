import { afterEach, describe, expect, test } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import type { WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";

const block = (id: string, type: string, text: string, props: Record<string, unknown> = {}): WireBlock => ({
  id,
  type,
  parentId: null,
  rank: id,
  schemaVersion: 1,
  text: text ? [{ type: "text", text }] : [],
  props,
});
// Nesting comes from parentId in the wire tree: a child sits under the block before it.
const child = (b: WireBlock, parentId: string): WireBlock => ({ ...b, parentId });

function render(blocks: WireBlock[], fileUrls: Record<string, string> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<ReadOnlyBlocks blocks={blocks} fileUrls={fileUrls} />));
  return host;
}

describe("read-only lists", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("runs of items are real lists, nested by depth, and other blocks end them", () => {
    const host = render([
      block("a", "bulleted", "one"),
      child(block("b", "bulleted", "one.a"), "a"),
      child(block("c", "numbered", "one.b"), "a"),
      block("d", "bulleted", "two"),
      block("e", "paragraph", "between"),
      block("f", "numbered", "first"),
      block("g", "numbered", "second"),
      block("h", "todo", "task", { checked: true }),
    ]);
    const root = host.querySelector(".fb-editor")!;
    const top = [...root.children].map((c) => c.tagName);
    expect(top).toEqual(["UL", "P", "OL", "UL"]);
    const ul = root.children[0]!;
    expect(ul.querySelectorAll(":scope > li")).toHaveLength(2);
    // The nested items are inside the first item: a bulleted list, then a numbered one.
    const firstItem = ul.querySelector(":scope > li")!;
    expect([...firstItem.children].map((c) => c.tagName)).toEqual(["DIV", "UL", "OL"]);
    expect(firstItem.querySelector(":scope > ul .fb-bulleted")?.textContent).toBe("one.a");
    expect(root.children[2]!.querySelectorAll("li")).toHaveLength(2);
    // Wrappers take no box and keep the editor class, so each line is still a `.fb-editor > .fb` line.
    for (const w of root.querySelectorAll("ul, ol, li")) {
      expect((w as HTMLElement).style.display).toBe("contents");
      expect(w.classList.contains("fb-editor")).toBe(true);
    }
    for (const line of root.querySelectorAll(".fb-bulleted, .fb-numbered, .fb-todo")) expect(line.parentElement?.classList.contains("fb-editor")).toBe(true);
    // The to-do's state is said.
    expect(root.querySelector(".fb-todo .fb-check")?.getAttribute("aria-label")).toBe("Done");
  });

  test("a numbered list that goes on after a nested block starts at its number", () => {
    const host = render([block("a", "numbered", "one"), child(block("b", "paragraph", "note"), "a"), block("c", "numbered", "two")]);
    const lists = host.querySelectorAll(".fb-editor > ol");
    expect(lists).toHaveLength(2);
    expect(lists[1]!.getAttribute("start")).toBe("2");
    expect(lists[1]!.querySelector(".fb-numbered")?.getAttribute("data-index")).toBe("2");
  });
});

describe("read-only image descriptions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("a description is the alt; a file name is not, and the figure is named instead", () => {
    const host = render(
      [
        block("a", "image", "", { fileId: "f1", alt: "A dog on the beach" }),
        block("b", "image", "", { fileId: "f1", alt: "IMG_2041" }),
        block("c", "image", "", { fileId: "f1", alt: "3f9a2c7e1b4d8f60a5c3e9d1", caption: "Our trip" }),
      ],
      { f1: "https://example.com/f1.png" },
    );
    const figures = [...host.querySelectorAll("figure")];
    expect(figures.map((f) => f.querySelector("img")?.getAttribute("alt"))).toEqual(["A dog on the beach", "", ""]);
    expect(figures.map((f) => f.getAttribute("aria-label"))).toEqual([null, "Image", null]);
    expect(figures[2]!.querySelector("figcaption")?.textContent).toBe("Our trip");
  });
});

describe("editor bullets", () => {
  const li = (type: string, text: string, depth = 0): JSONContent => ({ type, attrs: { depth }, content: text ? [{ type: "text", text }] : [] });
  const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat], content: { type: "doc", content } });
  const speech = (e: Editor) => [...e.view.dom.querySelectorAll(".fb-speech")].map((s) => s.textContent);

  test("each bulleted line starts with hidden words a screen reader says, and they follow edits", () => {
    const e = make([li("bulleted", "one"), li("bulleted", "two", 1), li("paragraph", "plain"), li("numbered", "n")]);
    expect(speech(e)).toEqual(["Bullet, ", "Bullet, level 2, "]);
    const marker = e.view.dom.querySelector<HTMLElement>(".fb-speech")!;
    expect(marker.contentEditable).toBe("false");
    expect(marker.style.position).toBe("absolute");
    // Not part of the text: the document, and so copying, doesn't have it.
    expect(e.state.doc.textContent).toBe("onetwoplainn");
    // A paragraph turned into a bullet gets one; a bullet moved a level says its new level.
    let pos = 0;
    for (let i = 0; i < 2; i++) pos += e.state.doc.child(i).nodeSize;
    e.view.dispatch(e.state.tr.setNodeMarkup(pos, e.schema.nodes.bulleted, { ...e.state.doc.child(2).attrs }));
    expect(speech(e)).toEqual(["Bullet, ", "Bullet, level 2, ", "Bullet, "]);
    e.view.dispatch(e.state.tr.setNodeAttribute(0, "depth", 2));
    expect(speech(e)).toEqual(["Bullet, level 3, ", "Bullet, level 2, ", "Bullet, "]);
    // Typing into a line keeps its words, once.
    e.commands.insertContentAt(2, "x");
    expect(speech(e)).toEqual(["Bullet, level 3, ", "Bullet, level 2, ", "Bullet, "]);
    // Deleting the line takes them away.
    e.view.dispatch(e.state.tr.delete(0, e.state.doc.child(0).nodeSize));
    expect(speech(e)).toEqual(["Bullet, level 2, ", "Bullet, "]);
    e.destroy();
  });

  test("a to-do's box is a checkbox with its state", () => {
    const e = make([{ type: "todo", attrs: { depth: 0, checked: true }, content: [{ type: "text", text: "task" }] }]);
    const box = e.view.dom.querySelector(".fb-check")!;
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("true");
    e.destroy();
  });
});
