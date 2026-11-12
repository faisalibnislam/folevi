// Keys in the note's text (docs/EDITOR_AUDIT_2026-11-12.md, section 6): selection with Shift+arrows and Escape,
// the "/", "@" and "[[" menus, undo steps, Backspace and Enter on empty lines, links made as you type,
// Markdown shortcuts and select all.
import { describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts, Triggers, triggerRunsDry, type TriggerState } from "@/components/editor/plugins";
import { BlockSelectionExtension, blockSelectionRange, setBlockSelection } from "@/components/editor/blockSelection";
import { Autolink, addressIn } from "@/components/editor/autolink";

let nextId = 0;
/** A line with an id of its own, as every line of a note has. */
const line = (type: string, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { id: `L${++nextId}`, depth: 0, ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (text: string, attrs: Record<string, unknown> = {}) => line("paragraph", text, attrs);

function make(content: JSONContent[], onTrigger: (t: TriggerState | null) => void = () => undefined) {
  return new Editor({
    extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo.configure({ newGroupDelay: 600 }), BlockIdentity, BlockKeymap, BlockSelectionExtension, MarkdownShortcuts, Autolink, Triggers.configure({ onChange: onTrigger })],
    content: { type: "doc", content },
  });
}
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
/** Types text the way the browser does (so input rules and the editor's own handling of typed text run). */
function type(e: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)));
    if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
  }
}
/**
 * A key press as the editor's plugins see it. Returns whether one of them took it. (Not Tiptap's
 * keyboardShortcut command: it keeps only the steps of what a key did, so a key that only moves the selection,
 * or that starts a new undo step, would look as if it had done nothing.)
 */
function key(e: Editor, k: string, opts: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  return Boolean(e.view.someProp("handleKeyDown", (f) => f(e.view, event)));
}
/** The caret (or selection) in its line: "He|llo", or "H[el]lo" for a range. */
function caret(e: Editor) {
  const { $from, $to, empty } = e.state.selection;
  const t = $from.parent.textContent;
  return empty ? `${t.slice(0, $from.parentOffset)}|${t.slice($from.parentOffset)}` : `${t.slice(0, $from.parentOffset)}[${t.slice($from.parentOffset, $to.parentOffset)}]${t.slice($to.parentOffset)}`;
}
const marksOf = (e: Editor, index = 0) => {
  const out: string[] = [];
  e.state.doc.child(index).forEach((n) => out.push(`${n.text}:${n.marks.map((m) => m.type.name).sort().join("+")}`));
  return out;
};

describe("Shift+arrows and block selection", () => {
  test("Shift+↓ inside a line leaves the text selection to grow; at the block's end it selects blocks", () => {
    const e = make([p("Hello"), p("World"), p("End")]);
    e.commands.setTextSelection(3);
    expect(key(e, "ArrowDown", { shiftKey: true })).toBe(false);
    expect(blockSelectionRange(e.state)).toBeNull();
    // A text selection that already reaches the end of its block goes on to whole blocks.
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 3, 6)));
    expect(key(e, "ArrowDown", { shiftKey: true })).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 0, to: 1 });
    e.destroy();
  });

  test("Shift+↑ does the same at the block's start", () => {
    const e = make([p("Hello"), p("World")]);
    e.commands.setTextSelection(10);
    expect(key(e, "ArrowUp", { shiftKey: true })).toBe(false);
    expect(blockSelectionRange(e.state)).toBeNull();
    e.commands.setTextSelection(8);
    expect(key(e, "ArrowUp", { shiftKey: true })).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 0, to: 1 });
    e.destroy();
  });

  test("Escape then a letter types where the caret was, not at the end of the line", () => {
    const e = make([p("Hello")]);
    e.commands.setTextSelection(3);
    expect(key(e, "Escape")).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 0, to: 0 });
    expect(key(e, "x")).toBe(false);
    expect(blockSelectionRange(e.state)).toBeNull();
    expect(caret(e)).toBe("He|llo");
    e.destroy();
  });

  test("Escape twice gives back the selection there was", () => {
    const e = make([p("Hello"), p("World")]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 5)));
    key(e, "Escape");
    key(e, "ArrowDown", { shiftKey: true });
    expect(blockSelectionRange(e.state)).toEqual({ from: 0, to: 1 });
    expect(key(e, "Escape")).toBe(true);
    expect(blockSelectionRange(e.state)).toBeNull();
    expect(caret(e)).toBe("H[ell]o");
    e.destroy();
  });

  test("a letter on blocks picked without a caret among them changes nothing", () => {
    const e = make([p("Hello"), p("World")]);
    e.commands.setTextSelection(3);
    // The second block, as from its grip: the caret is in the first.
    setBlockSelection(e.view, 1, 1);
    expect(key(e, "x")).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 1, to: 1 });
    expect(texts(e)).toEqual(["paragraph:Hello@0", "paragraph:World@0"]);
    e.destroy();
  });

  test("a selected block is drawn selected with everything nested under it", () => {
    const e = make([p("parent"), p("child", { depth: 1 }), p("grandchild", { depth: 2 }), p("next")]);
    setBlockSelection(e.view, 0, 0);
    const selected = [...e.view.dom.querySelectorAll(".fb-selected")].map((el) => el.textContent);
    expect(selected).toEqual(["parent", "child", "grandchild"]);
    // Which is what Delete takes.
    key(e, "Backspace");
    expect(texts(e)).toEqual(["paragraph:next@0"]);
    e.destroy();
  });
});

describe('the "/", "@" and "[[" menus', () => {
  test("typing the character opens the menu and what follows is its query", () => {
    const seen = vi.fn();
    const e = make([p("")], seen);
    e.commands.setTextSelection(1);
    type(e, "/ta");
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "slash", query: "ta", from: 1 }));
    type(e, " ");
    key(e, "Backspace");
    e.commands.deleteRange({ from: 1, to: e.state.selection.from });
    expect(seen).toHaveBeenLastCalledWith(null);
    type(e, "see @an");
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "mention", query: "an" }));
    e.destroy();
  });

  test("the caret coming to rest next to an old /word opens nothing", () => {
    const seen = vi.fn();
    const e = make([p("/table"), p("other")], seen);
    e.commands.setTextSelection(7);
    e.commands.setTextSelection(10);
    e.commands.setTextSelection(7);
    expect(seen.mock.calls.every(([t]) => t === null)).toBe(true);
    // Nor does typing on from there: the "/" itself wasn't typed now.
    type(e, "s");
    expect(seen.mock.calls.every(([t]) => t === null)).toBe(true);
    e.destroy();
  });

  test("a menu that is open closes when the caret leaves, and stays closed when it comes back", () => {
    const seen = vi.fn();
    const e = make([p(""), p("other")], seen);
    e.commands.setTextSelection(1);
    type(e, "/tab");
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "slash", query: "tab" }));
    // Moving inside the query keeps it open.
    e.commands.setTextSelection(4);
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "slash", query: "ta" }));
    e.commands.setTextSelection(8);
    expect(seen).toHaveBeenLastCalledWith(null);
    e.commands.setTextSelection(5);
    expect(seen).toHaveBeenLastCalledWith(null);
    e.destroy();
  });

  test("a toolbar that puts the character in opens the menu; a paste and an undo do not", () => {
    const seen = vi.fn();
    const e = make([p("")], seen);
    e.chain().focus().insertContent("@").run();
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "mention", query: "" }));
    e.commands.deleteRange({ from: 1, to: 2 });
    expect(seen).toHaveBeenLastCalledWith(null);
    seen.mockClear();
    e.view.dispatch(e.state.tr.insertText("/pasted").setMeta("paste", true));
    e.commands.undo();
    e.commands.redo();
    expect(seen.mock.calls.every(([t]) => t === null)).toBe(true);
    e.destroy();
  });

  test("a menu with nothing to offer closes at the next space; one with choices, or still loading, stays", () => {
    const slash = (query: string): TriggerState => ({ kind: "slash", query, from: 1, to: 2 + query.length });
    expect(triggerRunsDry(slash("zzz"), 0, false)).toBe(false);
    expect(triggerRunsDry(slash("zzz "), 0, false)).toBe(true);
    expect(triggerRunsDry(slash("page "), 2, false)).toBe(false);
    expect(triggerRunsDry({ kind: "mention", query: "nobody ", from: 1, to: 9 }, 0, false)).toBe(true);
    expect(triggerRunsDry({ kind: "mention", query: "nobody ", from: 1, to: 9 }, 0, true)).toBe(false);
    expect(triggerRunsDry({ kind: "page", query: "New page ", from: 1, to: 12 }, 0, false)).toBe(false);
    expect(triggerRunsDry(null, 0, false)).toBe(false);
  });

  test("a new line made with its / already in it (the + button beside a block) opens the menu", () => {
    const seen = vi.fn();
    const e = make([p("above")], seen);
    const at = e.state.doc.content.size;
    e.chain().insertContentAt(at, { type: "paragraph", attrs: { id: "N", depth: 0 } }).focus(at + 1).insertContent("/").run();
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "slash", query: "", from: at + 1 }));
    e.destroy();
  });

  test("[[ opens the page menu as its second bracket is typed", () => {
    const seen = vi.fn();
    const e = make([p("")], seen);
    e.commands.setTextSelection(1);
    type(e, "[");
    expect(seen.mock.calls.every(([t]) => t === null)).toBe(true);
    type(e, "[No");
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "page", query: "No", from: 1 }));
    e.destroy();
  });
});

describe("undo steps", () => {
  test("each line typed is its own undo step, however quickly they were typed", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, "one");
    key(e, "Enter");
    type(e, "two");
    key(e, "Enter");
    type(e, "three");
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0", "paragraph:three@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:@0"]);
    e.destroy();
  });

  test("joining two lines with Backspace is a step apart from the typing before it", () => {
    const e = make([p("one"), p("")]);
    e.commands.setTextSelection(6);
    type(e, "two");
    e.commands.setTextSelection(6);
    key(e, "Backspace");
    expect(texts(e)).toEqual(["paragraph:onetwo@0"]);
    e.commands.undo();
    expect(texts(e)).toEqual(["paragraph:one@0", "paragraph:two@0"]);
    e.destroy();
  });
});

describe("empty lines", () => {
  test("Backspace below an empty heading removes the heading and the text stays a paragraph", () => {
    const e = make([line("heading", "", { id: "H", level: 1 }), p("text", { id: "P" })]);
    e.commands.setTextSelection(3);
    key(e, "Backspace");
    expect(texts(e)).toEqual(["paragraph:text@0"]);
    expect(e.state.doc.child(0).attrs.id).toBe("P");
    expect(caret(e)).toBe("|text");
    e.destroy();
  });

  test("Backspace below an empty bullet does the same, and below a line with text still joins it", () => {
    const e = make([line("bulleted", "", { depth: 1 }), p("text")]);
    e.commands.setTextSelection(3);
    key(e, "Backspace");
    expect(texts(e)).toEqual(["paragraph:text@0"]);
    const f = make([line("bulleted", "item"), p("text")]);
    f.commands.setTextSelection(7);
    key(f, "Backspace");
    expect(texts(f)).toEqual(["bulleted:itemtext@0"]);
    e.destroy();
    f.destroy();
  });

  test("Delete on an empty heading above a paragraph removes the heading", () => {
    const e = make([line("heading", "", { level: 2 }), p("text", { id: "P" })]);
    e.commands.setTextSelection(1);
    key(e, "Delete");
    expect(texts(e)).toEqual(["paragraph:text@0"]);
    expect(e.state.doc.child(0).attrs.id).toBe("P");
    e.destroy();
  });

  test("Enter on an empty indented paragraph steps out one level; at the page's edge it adds a line", () => {
    const e = make([p("parent"), p("", { depth: 1 })]);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    key(e, "Enter");
    expect(texts(e)).toEqual(["paragraph:parent@0", "paragraph:@0"]);
    key(e, "Enter");
    expect(texts(e)).toEqual(["paragraph:parent@0", "paragraph:@0", "paragraph:@0"]);
    e.destroy();
  });

  test("Enter on an indented paragraph with text still adds an indented line", () => {
    const e = make([p("parent"), p("child", { depth: 1 })]);
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    key(e, "Enter");
    expect(texts(e)).toEqual(["paragraph:parent@0", "paragraph:child@1", "paragraph:@1"]);
    e.destroy();
  });
});

describe("links made as you type", () => {
  test("two-letter endings need more than a dot to be an address", () => {
    for (const w of ["install.sh", "lib.so", "Thanks.It", "script.pl", "notes.in", "word.to", "about.me", "Thanks.Io"]) expect(addressIn(w), w).toBeNull();
    for (const w of ["example.com", "sub.example.org/page", "bit.ly/3xYz", "notion.so/page", "bbc.co.uk", "example.com.au", "github.io", "claude.ai", "www.lib.so", "https://install.sh", "example.de:8080"]) expect(addressIn(w)?.text, w).toBe(w);
  });

  test("a file name followed by a space stays text; an address becomes a link", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, "run install.sh ");
    expect(marksOf(e)).toEqual(["run install.sh :"]);
    type(e, "see example.com ");
    expect(marksOf(e)).toEqual(["run install.sh see :", "example.com:link", " :"]);
    e.destroy();
  });

  test("Backspace right after a link was made removes the link and keeps the text", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, "example.com ");
    expect(marksOf(e)).toEqual(["example.com:link", " :"]);
    expect(key(e, "Backspace")).toBe(true);
    expect(marksOf(e)).toEqual(["example.com :"]);
    // Only that once: the next Backspace is an ordinary one.
    expect(key(e, "Backspace")).toBe(false);
    e.destroy();
  });

  test("after anything else, Backspace is an ordinary Backspace", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, "example.com x");
    expect(key(e, "Backspace")).toBe(false);
    expect(marksOf(e)[0]).toBe("example.com:link");
    e.destroy();
  });
});

describe("Markdown shortcuts", () => {
  const typed = (text: string) => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, text);
    return e;
  };

  test("any number starts a numbered list", () => {
    for (const start of ["1. ", "3. ", "12) ", "100. "]) {
      const e = typed(start);
      expect(texts(e), start).toEqual(["numbered:@0"]);
      e.destroy();
    }
    const e = typed("1000. ");
    expect(texts(e)).toEqual(["paragraph:1000. @0"]);
    e.destroy();
  });

  test("inline marks also start after an opening bracket or quote", () => {
    const e = typed("(**bold**");
    expect(marksOf(e)).toEqual(["(:", "bold:bold"]);
    const f = typed('say "`code`');
    expect(marksOf(f)).toEqual(['say ":', "code:code"]);
    e.destroy();
    f.destroy();
  });

  test("*italic*, _italic_, **bold** and ***bold italic***", () => {
    const cases: [string, string[]][] = [
      ["*it*", ["it:italic"]],
      ["_it_", ["it:italic"]],
      ["**b**", ["b:bold"]],
      ["***bi***", ["bi:bold+italic"]],
      ["a *b c* ", ["a :", "b c:italic", " :"]],
    ];
    for (const [text, marks] of cases) {
      const e = typed(text);
      expect(marksOf(e), text).toEqual(marks);
      e.destroy();
    }
  });

  test("stars and underscores inside words and sums stay as typed", () => {
    for (const text of ["2 * 3 * 4", "2*3*4", "snake_case_name", "a * b"]) {
      const e = typed(text);
      expect(marksOf(e), text).toEqual([`${text}:`]);
      e.destroy();
    }
  });

  test('"---" is a divider at once; so is an em dash and a hyphen (smart dashes)', () => {
    const e = typed("---");
    expect(texts(e)).toEqual(["divider:@0", "paragraph:@0"]);
    const f = typed("\u2014-");
    expect(texts(f)).toEqual(["divider:@0", "paragraph:@0"]);
    e.destroy();
    f.destroy();
  });

  test('"***" waits: it is a divider on Enter, and the start of bold italic text otherwise', () => {
    const e = typed("***");
    expect(texts(e)).toEqual(["paragraph:***@0"]);
    key(e, "Enter");
    expect(texts(e)).toEqual(["divider:@0", "paragraph:@0"]);
    e.destroy();
  });
});

describe("select all", () => {
  const mod = (e: Editor) => key(e, "a", { ctrlKey: true });

  test("first the block's text, then the whole note", () => {
    const e = make([p("Hello"), p("World")]);
    e.commands.setTextSelection(3);
    mod(e);
    expect(caret(e)).toBe("[Hello]");
    expect(e.state.selection.from).toBe(1);
    expect(e.state.selection.to).toBe(6);
    mod(e);
    expect(e.state.selection.from).toBeLessThanOrEqual(1);
    expect(e.state.selection.to).toBeGreaterThanOrEqual(e.state.doc.content.size - 1);
    e.destroy();
  });

  test("an empty block goes straight to the whole note", () => {
    const e = make([p(""), p("World")]);
    e.commands.setTextSelection(1);
    mod(e);
    expect(e.state.selection.to).toBeGreaterThanOrEqual(e.state.doc.content.size - 1);
    e.destroy();
  });

  test("in a code block the first press selects the code", () => {
    const e = make([p("before"), { type: "codeBlock", attrs: { id: "C", depth: 0, language: "plaintext" }, content: [{ type: "text", text: "a = 1\nb = 2" }] }, p("after")]);
    e.commands.setTextSelection(11);
    mod(e);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("a = 1\nb = 2");
    expect(e.state.selection.$from.parent.type.name).toBe("codeBlock");
    e.destroy();
  });

  test("a selected image is not a block of text: the whole note at once", () => {
    const e = make([p("a"), { type: "divider", attrs: { id: "D", depth: 0 } }, p("b")]);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 3)));
    mod(e);
    expect(e.state.selection.to).toBeGreaterThanOrEqual(e.state.doc.content.size - 1);
    e.destroy();
  });
});
