import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { strToU8, zipSync } from "fflate";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { BlockSelectionExtension, blockSelectionRange, setBlockSelection } from "@/components/editor/blockSelection";
import { applyLink, blocksInSelection, duplicateBlocks, moveBlock } from "@/components/editor/commands";
import { blocksToDoc } from "@/components/editor/convert";
import { dirname, entriesFromZip, entryMap, imageSources, normalizePath, resolveImage } from "@/components/doc/importBundle";
import { mentionQueryAt, textToCommentBody } from "@/components/doc/MentionInput";
import { linkedDocumentIds } from "@/components/doc/export";

const para = (id: string, text: string, depth = 0) => ({ type: "paragraph", attrs: { id, depth }, content: text ? [{ type: "text", text }] : [] });
const doc = (...nodes: object[]) => ({ type: "doc", content: nodes });

function makeEditor(content: object) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, BlockSelectionExtension, MarkdownShortcuts], content });
}

const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.textContent}:${n.attrs.depth}`));
  return out;
};

/** Types text the way the browser does (so input rules run). */
function type(e: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)));
    if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
  }
}

function key(e: Editor, k: string, opts: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  return Boolean(e.view.someProp("handleKeyDown", (f) => f(e.view, event)));
}

describe("Markdown inline shortcuts", () => {
  test.each([
    ["**bold**", "bold"],
    ["_it_", "italic"],
    ["`code`", "code"],
    ["~~gone~~", "strike"],
  ])("typing %s keeps the text before it and applies %s", (typed, mark) => {
    const e = makeEditor(doc(para("a", "")));
    e.commands.setTextSelection(1);
    type(e, `Say ${typed}`);
    const p = e.state.doc.child(0);
    const inner = typed.replace(/[*_`~]/g, "");
    expect(p.textContent).toBe(`Say ${inner}`);
    const marked: string[] = [];
    p.forEach((n) => {
      if (n.marks.some((m) => m.type.name === mark)) marked.push(n.text ?? "");
    });
    expect(marked).toEqual([inner]);
    // Typing continues without the mark.
    type(e, " next");
    let last = "";
    p.forEach(() => undefined);
    e.state.doc.child(0).forEach((n) => (last = n.marks.length ? "" : (n.text ?? "")));
    expect(last).toBe(" next");
    e.destroy();
  });

  test("a shortcut at the very start of a block works too", () => {
    const e = makeEditor(doc(para("a", "")));
    e.commands.setTextSelection(1);
    type(e, "**x**");
    expect(e.state.doc.child(0).textContent).toBe("x");
    expect(e.state.doc.child(0).firstChild!.marks.map((m) => m.type.name)).toEqual(["bold"]);
    e.destroy();
  });
});

describe("multi-block actions", () => {
  test("move and duplicate act on every block of a text selection, not just the first", () => {
    const e = makeEditor(doc(para("a", "A"), para("b", "B"), para("c", "C"), para("d", "D")));
    // Select from inside B to inside C.
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 4, 7)));
    expect(blocksInSelection(e.state).map((b) => b.node.textContent)).toEqual(["B", "C"]);
    moveBlock(e, -1);
    expect(texts(e)).toEqual(["B:0", "C:0", "A:0", "D:0"]);
    moveBlock(e, 1);
    moveBlock(e, 1);
    expect(texts(e)).toEqual(["A:0", "D:0", "B:0", "C:0"]);
    // The selection still covers B and C after moving.
    expect(blocksInSelection(e.state).map((b) => b.node.textContent)).toEqual(["B", "C"]);
    duplicateBlocks(e);
    expect(texts(e)).toEqual(["A:0", "D:0", "B:0", "C:0", "B:0", "C:0"]);
    const ids: string[] = [];
    e.state.doc.forEach((n) => ids.push(n.attrs.id));
    expect(new Set(ids).size).toBe(ids.length);
    e.destroy();
  });

  test("moving a block brings its nested blocks along", () => {
    const e = makeEditor(doc(para("a", "A"), para("b", "B"), para("c", "C", 1), para("d", "D")));
    e.commands.setTextSelection(4); // in B
    moveBlock(e, 1);
    expect(texts(e)).toEqual(["A:0", "D:0", "B:0", "C:1"]);
    e.destroy();
  });
});

describe("block selection", () => {
  test("Escape selects the current block; Shift+↓ grows it; actions apply to all selected blocks", () => {
    const e = makeEditor(doc(para("a", "A"), para("b", "B"), para("c", "C"), para("d", "D")));
    e.commands.setTextSelection(4); // in B
    expect(key(e, "Escape")).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 1, to: 1 });
    expect(key(e, "ArrowDown", { shiftKey: true })).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 1, to: 2 });
    // Selected blocks are decorated.
    expect(e.view.dom.querySelectorAll(".fb-selected")).toHaveLength(2);
    // Tab indents every selected block (B can't go deeper than A + 1, C follows B).
    expect(key(e, "Tab")).toBe(true);
    expect(texts(e)).toEqual(["A:0", "B:1", "C:1", "D:0"]);
    key(e, "Tab", { shiftKey: true });
    // ⌥⇧↓ moves both.
    key(e, "ArrowDown", { altKey: true, shiftKey: true });
    expect(texts(e)).toEqual(["A:0", "D:0", "B:0", "C:0"]);
    expect(blockSelectionRange(e.state)).toEqual({ from: 2, to: 3 });
    // ⌘D duplicates both.
    key(e, "d", { metaKey: true });
    expect(texts(e)).toEqual(["A:0", "D:0", "B:0", "C:0", "B:0", "C:0"]);
    // Backspace deletes the selection.
    expect(key(e, "Backspace")).toBe(true);
    expect(texts(e)).toEqual(["A:0", "D:0", "B:0", "C:0"]);
    expect(blockSelectionRange(e.state)).toBeNull();
    e.destroy();
  });

  test("Escape and plain arrows leave block selection; typing goes back to the text", () => {
    const e = makeEditor(doc(para("a", "A"), para("b", "B"), para("c", "C")));
    setBlockSelection(e.view, 0, 1);
    expect(key(e, "Escape")).toBe(true);
    expect(blockSelectionRange(e.state)).toBeNull();
    setBlockSelection(e.view, 0, 1);
    expect(key(e, "ArrowDown")).toBe(true);
    expect(blockSelectionRange(e.state)).toBeNull();
    expect(e.state.selection.$from.parent.textContent).toBe("B");
    setBlockSelection(e.view, 0, 0);
    expect(key(e, "x")).toBe(false);
    expect(blockSelectionRange(e.state)).toBeNull();
    e.destroy();
  });

  test("the block selection survives edits elsewhere and clears when its blocks are deleted", () => {
    const e = makeEditor(doc(para("a", "A"), para("b", "B"), para("c", "C")));
    setBlockSelection(e.view, 1, 2);
    e.view.dispatch(e.state.tr.insertText("!", 1));
    expect(blockSelectionRange(e.state)).toEqual({ from: 1, to: 2 });
    e.view.dispatch(e.state.tr.delete(e.state.doc.child(0).nodeSize, e.state.doc.content.size));
    expect(blockSelectionRange(e.state)).toBeNull();
    e.destroy();
  });
});

describe("links from the keyboard", () => {
  test("applyLink links a selection, inserts a linked address at a caret, and refuses unsafe URLs", () => {
    const e = makeEditor(doc(para("a", "Read the docs")));
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 10, 14)));
    expect(applyLink(e, "example.com/docs")).toBe(true);
    const linked: string[] = [];
    e.state.doc.child(0).forEach((n) => {
      const l = n.marks.find((m) => m.type.name === "link");
      if (l) linked.push(`${n.text}→${l.attrs.href}`);
    });
    expect(linked).toEqual(["docs→https://example.com/docs"]);
    e.commands.setTextSelection(1);
    expect(applyLink(e, "https://folevi.app")).toBe(true);
    expect(e.state.doc.child(0).textContent.startsWith("https://folevi.app")).toBe(true);
    expect(applyLink(e, "javascript:alert(1)")).toBe(false);
    e.destroy();
  });
});

describe("import bundles", () => {
  test("paths normalize and never escape the bundle", () => {
    expect(normalizePath("./a/../b//c.png")).toBe("b/c.png");
    expect(normalizePath("../x.png")).toBeNull();
    expect(dirname("notes/trip/day.md")).toBe("notes/trip");
    expect(imageSources('![a](img/x.png)\ntext ![b]( <img/y.png> "t") and ![c](https://e.com/z.png)')).toEqual(["img/x.png", "img/y.png", "https://e.com/z.png"]);
  });

  test("images resolve relative to the Markdown file, from the root, or by unique file name", () => {
    const zip = zipSync({
      "notes/trip.md": strToU8("![](photos/sea%20view.png)"),
      "notes/photos/sea view.png": new Uint8Array([1, 2, 3]),
      "assets/logo.png": new Uint8Array([4]),
      "a/dup.png": new Uint8Array([5]),
      "b/dup.png": new Uint8Array([6]),
      "__MACOSX/._trip.md": new Uint8Array([0]),
    });
    const entries = entriesFromZip(zip);
    expect(entries.map((e) => e.path).sort()).toEqual(["a/dup.png", "assets/logo.png", "b/dup.png", "notes/photos/sea view.png", "notes/trip.md"]);
    const map = entryMap(entries);
    expect(resolveImage(map, "notes/trip.md", "photos/sea%20view.png")?.path).toBe("notes/photos/sea view.png");
    expect(resolveImage(map, "notes/trip.md", "../assets/logo.png")?.path).toBe("assets/logo.png");
    expect(resolveImage(map, "notes/trip.md", "assets/logo.png")?.path).toBe("assets/logo.png");
    expect(resolveImage(map, "notes/trip.md", "elsewhere/logo.png")?.path).toBe("assets/logo.png");
    expect(resolveImage(map, "notes/trip.md", "dup.png")).toBeNull(); // ambiguous
    expect(resolveImage(map, "notes/trip.md", "https://example.com/logo.png")).toBeNull();
  });
});

describe("comment mentions", () => {
  const people = [
    { profileId: "p1", displayName: "Ana" },
    { profileId: "p2", displayName: "Ana Lima" },
    { profileId: "p3", displayName: "Bo" },
  ];

  test("@Name becomes a mention (longest name wins; picked people win over name matches)", () => {
    expect(textToCommentBody("Hi @Ana Lima and @Bo!", [], people)).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", userId: "p2", label: "Ana Lima" },
      { type: "text", text: " and " },
      { type: "mention", userId: "p3", label: "Bo" },
      { type: "text", text: "!" },
    ]);
    // A second "Ana" picked from the list keeps its own id.
    const other = { profileId: "p9", displayName: "Ana" };
    expect(textToCommentBody("@Ana hi", [other], people)[0]).toEqual({ type: "mention", userId: "p9", label: "Ana" });
    // Part of a longer word is not a mention; neither is an e-mail address.
    expect(textToCommentBody("@Bob and me@Bo", [], people)).toEqual([{ type: "text", text: "@Bob and me@Bo" }]);
  });

  test("the @query before the caret is found", () => {
    expect(mentionQueryAt("Hello @An", 9)).toEqual({ start: 6, query: "An" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail me@x", 9)).toBeNull();
  });
});

describe("single-page export", () => {
  test("finds every linked page: cards, inline links and links inside table cells", () => {
    const block = (id: string, type: string, text: WireBlock["text"], props: Record<string, unknown> = {}): WireBlock => ({ id, type, parentId: null, rank: id, schemaVersion: SCHEMA_VERSION, text, props });
    const ids = linkedDocumentIds([
      block("a", "page", [], { documentId: "D1", display: "card" }),
      block("b", "paragraph", [{ type: "pageLink", documentId: "D2", label: "x" }]),
      block("c", "table", [], { headerRow: false, rows: [[[{ type: "pageLink", documentId: "D3", label: "y" }]]] }),
    ]);
    expect(ids.sort()).toEqual(["D1", "D2", "D3"]);
  });
});

describe("document semantics", () => {
  test("callouts render as notes, not <aside> landmarks, and headings start at h2", () => {
    const e = makeEditor(
      blocksToDoc([
        { id: "h", type: "heading", parentId: null, rank: "1", schemaVersion: 1, text: [{ type: "text", text: "Top" }], props: { level: 1 } },
        { id: "c", type: "callout", parentId: null, rank: "2", schemaVersion: 1, text: [{ type: "text", text: "Hi" }], props: { tone: "note" } },
      ]),
    );
    expect(e.view.dom.querySelector("aside")).toBeNull();
    expect(e.view.dom.querySelector('[data-block="callout"]')?.getAttribute("role")).toBe("note");
    expect(e.view.dom.querySelector("h2")?.textContent).toBe("Top");
    expect(e.view.dom.querySelector("h1")).toBeNull();
    e.destroy();
  });
});
