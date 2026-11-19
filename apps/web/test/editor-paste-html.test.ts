// Reading another app's HTML when it is pasted (paste.ts htmlToBlocks): nested lists and checklists from
// Google Docs, text that keeps its line breaks with CSS, code copied from chat sites, a link's own underline,
// a list item that starts with a picture, paragraphs split by two line breaks, and blocks over the schema's
// limits. Each case is what the app writes to the clipboard, cut down to what matters.
import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES, BlockFormat } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { TABLE_CUT_NOTICE, htmlTableIsCut, htmlToBlocks, insertPastedBlocks } from "@/components/editor/paste";
import { LIMITS, flattenTree, plainText, validateWireBlock, type InlineNode } from "@folevi/editor-schema";

/** The blocks as an outline: two spaces per level, then "type:text". */
const outline = (html: string) => flattenTree(htmlToBlocks(html)).map((e) => `${"  ".repeat(e.depth)}${e.block.type}:${plainText(e.block.text)}`);
const first = (html: string) => htmlToBlocks(html)[0]!;
const marksOf = (html: string) => (first(html).text as InlineNode[]).map((n) => (n.type === "text" ? `${n.text}[${(n.marks ?? []).map((m) => m.type).join(",")}]` : n.type));

const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockFormat, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });

/** What the editor said through the app's message event while `run` ran. */
function messages(run: () => void): string[] {
  const said: string[] = [];
  const onError = (e: Event) => void said.push(String((e as CustomEvent<unknown>).detail));
  window.addEventListener("folevi:error", onError);
  try {
    run();
  } finally {
    window.removeEventListener("folevi:error", onError);
  }
  return said;
}

afterEach(() => vi.restoreAllMocks());

describe("nested lists (P5)", () => {
  const li = (level: number, text: string) => `<li dir="ltr" aria-level="${level}"><p dir="ltr" role="presentation"><span>${text}</span></p></li>`;

  test("Google Docs sub-lists (a list inside the list, with aria-level on every item) keep their levels", () => {
    const html = `<b style="font-weight:normal;" id="docs-internal-guid-1"><ul>${li(1, "A")}<ul>${li(2, "B")}${li(2, "C")}<ul>${li(3, "D")}</ul>${li(2, "E")}</ul>${li(1, "F")}</ul></b>`;
    expect(outline(html)).toEqual(["bulleted:A", "  bulleted:B", "  bulleted:C", "    bulleted:D", "  bulleted:E", "bulleted:F"]);
  });

  test("one flat list with aria-level still nests by it", () => {
    expect(outline(`<ul>${li(1, "A")}${li(2, "B")}${li(3, "C")}${li(1, "D")}</ul>`)).toEqual(["bulleted:A", "  bulleted:B", "    bulleted:C", "bulleted:D"]);
  });

  test("a list inside an item (how most pages write it) is one level deeper, with or without aria-level", () => {
    expect(outline(`<ul><li aria-level="1">A<ul><li aria-level="2">B</li></ul></li><li>C</li></ul>`)).toEqual(["bulleted:A", "  bulleted:B", "bulleted:C"]);
    expect(outline('<ul class="ul1"><li>A</li><ul class="ul2"><li>B</li><li>C</li></ul><li>D</li></ul>')).toEqual(["bulleted:A", "  bulleted:B", "  bulleted:C", "bulleted:D"]);
  });
});

describe("text that keeps its line breaks with CSS (P8)", () => {
  test("white-space: pre-wrap (a post, a chat message) keeps each line", () => {
    const blocks = htmlToBlocks('<span style="color: rgb(15, 20, 25); white-space: pre-wrap;">line one\nline two\n\nline four</span>');
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(plainText(blocks[0]!.text)).toBe("line one\nline two\n\nline four");
  });

  test("white-space-collapse: preserve (newer Chrome) and a style on an element around the text count too", () => {
    expect(plainText(first('<div style="white-space-collapse: preserve;">line one\nline two</div>').text)).toBe("line one\nline two");
    expect(plainText(first('<div style="white-space: pre-line"><p><b>line one\nline two</b></p></div>').text)).toBe("line one\nline two");
  });

  test("runs of spaces still become one, and an element that turns it off is ordinary text", () => {
    expect(plainText(first('<span style="white-space: pre-wrap">a   b\n   c</span>').text)).toBe("a b\n c");
    expect(plainText(first('<div style="white-space: pre-wrap"><span style="white-space: normal">one\ntwo</span></div>').text)).toBe("one two");
  });

  test("without such a style a line break in the HTML is a space, as on any page", () => {
    expect(plainText(first("<p>line one\nline two</p>").text)).toBe("line one line two");
  });
});

describe("code copied from a chat site (P9)", () => {
  test("the language's name and the copy button beside the code are not code", () => {
    const block = first('<pre><div class="rounded"><div class="flex items-center">python</div><div class="sticky"><button>Copy code</button></div><div class="overflow-y-auto"><code class="language-python"><span>print(1)\n</span><span>print(2)</span></code></div></div></pre>');
    expect(block.type).toBe("code");
    expect(block.props).toEqual({ language: "python", code: "print(1)\nprint(2)" });
  });

  test("a plain <pre>, and one with its language on the <pre>, read as before", () => {
    expect(first("<pre>a\n  b</pre>").props).toEqual({ language: "plaintext", code: "a\n  b" });
    expect(first('<pre class="language-typescript"><code>const a = 1;</code></pre>').props).toEqual({ language: "typescript", code: "const a = 1;" });
  });
});

describe("a link's own underline (P12)", () => {
  test("a Google Docs link is a link, not underlined text", () => {
    const html =
      '<p dir="ltr"><a href="https://example.com/" style="text-decoration:none;"><span style="font-size:11pt;color:#1155cc;font-weight:400;font-style:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;">a link</span></a><span style="font-weight:400;text-decoration:none;"> and text</span></p>';
    expect(marksOf(html)).toEqual(["a link[link]", " and text[]"]);
  });

  test("a <u> inside a link, and underlined text outside one, are still underlined", () => {
    expect(marksOf('<p><a href="https://example.com/"><u>both</u></a></p>')).toEqual(["both[underline,link]"]);
    expect(marksOf('<p><span style="text-decoration: underline">under</span></p>')).toEqual(["under[underline]"]);
  });
});

describe("a list item that starts with a picture (P13)", () => {
  test("the item keeps its text, and the picture goes under it", () => {
    const blocks = flattenTree(htmlToBlocks('<ul><li><img src="https://example.com/e.png" alt="x"><p>text of the item</p></li></ul>'));
    expect(blocks.map((e) => `${e.depth}:${e.block.type}:${plainText(e.block.text)}`)).toEqual(["0:bulleted:text of the item", "1:image:"]);
    expect(blocks[1]!.block.props).toMatchObject({ url: "https://example.com/e.png", alt: "x" });
  });

  test("a Google Docs checklist item is a to-do, done or not", () => {
    const item = (checked: boolean, text: string) =>
      `<li dir="ltr" role="checkbox" aria-checked="${checked}" aria-level="1"><img src="data:image/png;base64,AA" alt="${checked ? "checked" : "unchecked"}" aria-roledescription="checkbox"><p role="presentation"><span>${text}</span></p></li>`;
    const blocks = htmlToBlocks(`<ul>${item(true, "done thing")}${item(false, "open thing")}</ul>`);
    expect(blocks.map((b) => `${b.type}:${plainText(b.text)}:${String((b.props as { checked?: boolean }).checked)}`)).toEqual(["todo:done thing:true", "todo:open thing:false"]);
  });
});

describe("two line breaks in a row end a paragraph", () => {
  test("text with <br><br> between its paragraphs is two paragraphs; one <br> stays a line break", () => {
    expect(outline("<div>First paragraph.<br><br>Second paragraph.</div>")).toEqual(["paragraph:First paragraph.", "paragraph:Second paragraph."]);
    expect(outline("Hello<br>\n<br><br>World<br>again")).toEqual(["paragraph:Hello", "paragraph:World\nagain"]);
    expect(outline("<p>one<br><br>two</p>")).toEqual(["paragraph:one\n\ntwo"]);
  });
});

describe("blocks over the schema's limits (P14)", () => {
  test("code longer than a code block holds continues in more code blocks, nothing lost", () => {
    const code = Array.from({ length: 30000 }, (_, i) => `line ${i}`).join("\n");
    expect(code.length).toBeGreaterThan(LIMITS.maxCodeLength);
    const blocks = htmlToBlocks(`<pre><code class="language-python">${code}</code></pre>`);
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) {
      expect(b.type).toBe("code");
      expect((b.props as { language: string }).language).toBe("python");
      expect(validateWireBlock(b)).toEqual([]);
    }
    expect(blocks.map((b) => (b.props as { code: string }).code).join("\n")).toBe(code);
  });

  test("a table with more rows than a table holds is cut, and the paste says so once it is in", () => {
    const rows = Array.from({ length: LIMITS.maxTableRows + 5 }, (_, i) => `<tr><td>${i}</td><td>b</td></tr>`).join("");
    const doc = new DOMParser().parseFromString(`<table>${rows}</table>`, "text/html");
    expect(htmlTableIsCut(doc.querySelector("table")!)).toBe(true);
    const blocks = htmlToBlocks(`<table>${rows}</table>`);
    expect((blocks[0]!.props as { rows: unknown[] }).rows.length).toBe(LIMITS.maxTableRows);
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    expect(messages(() => insertPastedBlocks(e.view, blocks))).toEqual([TABLE_CUT_NOTICE]);
    expect(e.state.doc.child(0).type.name).toBe("table");
    e.destroy();
  });

  test("a table within the size says nothing", () => {
    const html = "<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>";
    expect(htmlTableIsCut(new DOMParser().parseFromString(html, "text/html").querySelector("table")!)).toBe(false);
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    expect(messages(() => insertPastedBlocks(e.view, htmlToBlocks(html)))).toEqual([]);
    e.destroy();
  });
});
