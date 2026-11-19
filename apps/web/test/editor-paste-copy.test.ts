// What a copy or cut puts on the clipboard (clipboardHtml.ts, clipboardText.ts, blockClipboard.ts) and how the
// copy of selected blocks is let through in WebKit (blockSelection.ts): nested lists other apps can read, the
// text of blocks that have none of their own, and the count the menus read to know a copy was made.
import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { BlockSelectionExtension, setBlockSelection } from "@/components/editor/blockSelection";
import { blockCopyCount } from "@/components/editor/blockClipboard";
import { clipboardSerializer } from "@/components/editor/clipboardHtml";
import { sliceToText } from "@/components/editor/clipboardText";
import { htmlToBlocks } from "@/components/editor/paste";
import { flattenTree, plainText, ulid } from "@folevi/editor-schema";

const line = (type: string, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { depth: 0, id: ulid(), ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (text: string, attrs: Record<string, unknown> = {}) => line("paragraph", text, attrs);
const make = (content: JSONContent[]) =>
  new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, BlockSelectionExtension, MarkdownShortcuts], content: { type: "doc", content } });
/** The clipboard HTML of a whole note, as another app reads it: without Folevi's own attributes. */
function copied(e: Editor): { html: string; bare: string } {
  const wrap = document.createElement("div");
  wrap.appendChild(clipboardSerializer(e.schema).serializeFragment(e.state.doc.content, { document }));
  return { html: wrap.innerHTML, bare: wrap.innerHTML.replace(/ (data-[\w-]+|style|class)="[^"]*"/g, "") };
}
function clipboard(): DataTransfer {
  const store: Record<string, string> = {};
  return {
    getData: (type: string) => store[type] ?? "",
    setData: (type: string, value: string) => void (store[type] = value),
    clearData: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    files: [],
  } as unknown as DataTransfer;
}
function fire(e: Editor, type: string, data?: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  if (data) Object.defineProperty(event, "clipboardData", { value: data });
  e.view.dom.dispatchEvent(event);
  return event;
}

describe("lists on the clipboard, for other apps (P10)", () => {
  test("a nested item is inside the item above it, numbering goes on after it, and a to-do says whether it is done", () => {
    const e = make([line("numbered", "one"), line("bulleted", "sub", { depth: 1 }), line("numbered", "two"), line("todo", "task", { checked: true }), line("todo", "open")]);
    expect(copied(e).bare).toBe('<ol><li>one<ul><li>sub</li></ul></li><li>two</li></ol><ul><li><input type="checkbox" disabled="" checked="">task</li><li><input type="checkbox" disabled="">open</li></ul>');
    e.destroy();
  });

  test("a numbered list that goes on after another block starts at its number", () => {
    const e = make([line("numbered", "one"), p("an aside", { depth: 1 }), line("numbered", "two"), line("numbered", "three"), p("a break"), line("numbered", "again")]);
    expect(copied(e).bare).toBe('<ol><li>one</li></ol><p>an aside</p><ol start="2"><li>two</li><li>three</li></ol><p>a break</p><ol><li>again</li></ol>');
    e.destroy();
  });

  test("deeper and shallower items, and a change of list kind at one depth, keep their places", () => {
    const e = make([line("bulleted", "a"), line("bulleted", "a1", { depth: 1 }), line("numbered", "a1i", { depth: 2 }), line("numbered", "a2", { depth: 1 }), line("bulleted", "b")]);
    expect(copied(e).bare).toBe("<ul><li>a<ul><li>a1<ol><li>a1i</li></ol></li></ul><ol><li>a2</li></ol></li><li>b</li></ul>");
    e.destroy();
  });

  test("read back as another app's HTML it is the same outline, to-dos included", () => {
    const e = make([line("numbered", "one"), line("bulleted", "sub", { depth: 1 }), line("numbered", "two"), line("todo", "task", { checked: true })]);
    // (Without Folevi's own attributes, as an app that rewrites the HTML would hand it back.)
    const blocks = flattenTree(htmlToBlocks(copied(e).bare));
    expect(blocks.map((entry) => `${entry.depth}:${entry.block.type}:${plainText(entry.block.text)}`)).toEqual(["0:numbered:one", "1:bulleted:sub", "0:numbered:two", "0:todo:task"]);
    expect(blocks[3]!.block.props).toEqual({ checked: true });
    e.destroy();
  });

  test("pasted back into a note (ProseMirror reads Folevi's own HTML) every block is what it was", () => {
    const e = make([line("numbered", "one"), line("bulleted", "sub", { depth: 1 }), line("numbered", "two"), line("todo", "task", { checked: true }), p("tail")]);
    const { dom, text } = e.view.serializeForClipboard(e.state.doc.slice(0, e.state.doc.content.size));
    const target = make([p("")]);
    target.commands.setTextSelection(1);
    target.view.pasteHTML(dom.innerHTML, new Event("paste") as ClipboardEvent);
    const out: string[] = [];
    target.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}${n.type.name === "todo" ? `:${String(n.attrs.checked)}` : ""}`));
    expect(out).toEqual(["numbered:one@0", "bulleted:sub@1", "numbered:two@0", "todo:task@0:true", "paragraph:tail@0"]);
    expect(text).toBe("1. one\n  - sub\n2. two\n- [x] task\ntail");
    e.destroy();
    target.destroy();
  });
});

describe("the plain text of blocks without text of their own (P10)", () => {
  test("a page is its title, a file and a recording their names", () => {
    const e = make([
      { type: "page", attrs: { id: ulid(), depth: 0, documentId: ulid(), display: "link", titleCache: "Roadmap" } },
      { type: "file", attrs: { id: ulid(), depth: 0, fileId: "f", name: "report.pdf", size: 3, mimeType: "application/pdf" } },
      { type: "audio", attrs: { id: ulid(), depth: 0, fileId: "a", name: "Standup.m4a", size: 3, mimeType: "audio/mp4", duration: 2 } },
      p("tail"),
    ]);
    expect(sliceToText(e.state.doc.slice(0, e.state.doc.content.size))).toBe("Roadmap\nreport.pdf\nStandup.m4a\ntail");
    e.destroy();
  });
});

describe("copying selected blocks in WebKit (P4)", () => {
  test("beforecopy and beforecut are refused while blocks are selected, so the copy and cut events come", () => {
    const e = make([p("one"), p("two")]);
    expect(fire(e, "beforecopy").defaultPrevented).toBe(false);
    expect(fire(e, "beforecut").defaultPrevented).toBe(false);
    setBlockSelection(e.view, 0, 1);
    expect(fire(e, "beforecopy").defaultPrevented).toBe(true);
    expect(fire(e, "beforecut").defaultPrevented).toBe(true);
    e.destroy();
  });

  test("the copy count goes up when blocks were written to the clipboard, and only then", () => {
    const e = make([p("one"), p("two"), p("three")]);
    const start = blockCopyCount();
    // A caret and nothing selected: no blocks are copied.
    fire(e, "copy", clipboard());
    expect(blockCopyCount()).toBe(start);
    setBlockSelection(e.view, 0, 0);
    const data = clipboard();
    expect(fire(e, "copy", data).defaultPrevented).toBe(true);
    expect(blockCopyCount()).toBe(start + 1);
    expect(data.getData("text/plain")).toBe("one");
    setBlockSelection(e.view, 1, 1);
    fire(e, "cut", clipboard());
    expect(blockCopyCount()).toBe(start + 2);
    expect(e.state.doc.childCount).toBe(2);
    e.destroy();
  });

  test("in a note that can't be edited, cutting selected blocks copies them and removes nothing", () => {
    const e = make([p("one"), p("two")]);
    setBlockSelection(e.view, 0, 0);
    e.setEditable(false);
    const data = clipboard();
    fire(e, "cut", data);
    expect(data.getData("text/plain")).toBe("one");
    expect(e.state.doc.childCount).toBe(2);
    e.destroy();
  });
});
