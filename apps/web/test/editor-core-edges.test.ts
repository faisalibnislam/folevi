// Edges of the note's text editing found by the audit of 19 November 2026 (docs/EDITOR_AUDIT_2026-11-19.md):
// which lines a selection covers, Backspace after a tabs block, folding a toggle the caret is in, the "@" menu
// and the number shortcut.
import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { undoDepth } from "@tiptap/pm/history";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts, Triggers, type TriggerState } from "@/components/editor/plugins";
import { BlockSelectionExtension, blockSelectionRange } from "@/components/editor/blockSelection";
import { TabsExtension } from "@/components/editor/tabs/tabsExtension";
import { blocksInSelection, changeDepth, focusEndOfNote } from "@/components/editor/commands";
import { foldToggle } from "@/components/editor/toggleFold";

let nextId = 0;
const line = (type: string, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type, attrs: { id: `L${++nextId}`, depth: 0, ...attrs }, content: text ? [{ type: "text", text }] : [] });
const p = (text: string, attrs: Record<string, unknown> = {}) => line("paragraph", text, attrs);

function make(content: JSONContent[], onTrigger: (t: TriggerState | null) => void = () => undefined) {
  return new Editor({
    extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo.configure({ newGroupDelay: 600 }), BlockIdentity, BlockKeymap, BlockSelectionExtension, TabsExtension, MarkdownShortcuts, Triggers.configure({ onChange: onTrigger })],
    content: { type: "doc", content },
  });
}
const texts = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}@${n.attrs.depth}`));
  return out;
};
const posOf = (e: Editor, index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += e.state.doc.child(i).nodeSize;
  return pos;
};
const select = (e: Editor, anchor: number, head: number) => e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, anchor, head)));
function key(e: Editor, k: string, opts: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  return Boolean(e.view.someProp("handleKeyDown", (f) => f(e.view, event)));
}
/** Text put in the way the browser reports it: over `from`..`to` (a phone's keyboard replaces what it wrote). */
function input(e: Editor, text: string, from = e.state.selection.from, to = e.state.selection.to) {
  const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from, to, text, () => e.state.tr.insertText(text, from, to)));
  if (!handled) e.view.dispatch(e.state.tr.insertText(text, from, to));
}
const type = (e: Editor, text: string) => {
  for (const ch of text) input(e, ch);
};

describe("the lines a text selection covers", () => {
  const four = () => make([p("One"), p("Two"), p("Three"), p("Four")]);
  const covered = (e: Editor) => blocksInSelection(e.state).map((b) => b.node.textContent);

  test("a selection that ends at the very start of a line does not take that line", () => {
    const e = four();
    // From the start of "Two", Shift+Down: the head is at the start of "Three", none of it selected.
    select(e, posOf(e, 1) + 1, posOf(e, 2) + 1);
    expect(covered(e)).toEqual(["Two"]);
    changeDepth(e, 1);
    expect(texts(e)).toEqual(["paragraph:One@0", "paragraph:Two@1", "paragraph:Three@0", "paragraph:Four@0"]);
    e.destroy();
  });

  test("one that starts at the very end of a line still takes that line (its end is selected)", () => {
    const e = four();
    select(e, posOf(e, 1) - 1, posOf(e, 2) + 3);
    expect(covered(e)).toEqual(["One", "Two", "Three"]);
    e.destroy();
  });

  test("lines with any of their text selected are all taken, in either direction", () => {
    const e = four();
    select(e, posOf(e, 0) + 2, posOf(e, 2) + 2);
    expect(covered(e)).toEqual(["One", "Two", "Three"]);
    select(e, posOf(e, 2) + 2, posOf(e, 0) + 2);
    expect(covered(e)).toEqual(["One", "Two", "Three"]);
    e.destroy();
  });

  test("a caret, and a selection inside one line, take their line", () => {
    const e = four();
    select(e, posOf(e, 1) + 1, posOf(e, 1) + 1);
    expect(covered(e)).toEqual(["Two"]);
    select(e, posOf(e, 1) + 1, posOf(e, 1) + 4);
    expect(covered(e)).toEqual(["Two"]);
    // From the end of a line to the start of the next: nothing of either is selected, the first is kept.
    select(e, posOf(e, 1) - 1, posOf(e, 1) + 1);
    expect(covered(e)).toEqual(["One"]);
    e.destroy();
  });
});

describe("Shift with the up and down arrows", () => {
  const four = () => make([p("One"), p("Two"), p("Three"), p("Four")]);

  test("taking a line back off a selection shrinks it, and never makes it whole blocks", () => {
    const e = four();
    // From the start of "One", Shift+Down twice: the head rests at the start of "Three". Then Shift+Up.
    select(e, posOf(e, 0) + 1, posOf(e, 2) + 1);
    expect(key(e, "ArrowUp", { shiftKey: true })).toBe(false);
    expect(blockSelectionRange(e.state)).toBeNull();
    // From the middle of "Three" up to the end of the shorter "Two" above, then Shift+Down.
    select(e, posOf(e, 2) + 4, posOf(e, 2) - 1);
    expect(key(e, "ArrowDown", { shiftKey: true })).toBe(false);
    expect(blockSelectionRange(e.state)).toBeNull();
    e.destroy();
  });

  test("growing a selection past a line's end still takes whole blocks", () => {
    const e = four();
    select(e, posOf(e, 0) + 2, posOf(e, 2) - 1);
    expect(key(e, "ArrowDown", { shiftKey: true })).toBe(true);
    expect(blockSelectionRange(e.state)).toEqual({ from: 0, to: 2 });
    e.destroy();
  });
});

describe("Backspace at the start of the line after a tabs block", () => {
  const tabs = (lastOfOpenTab: JSONContent) =>
    make([
      { type: "tabs", attrs: { id: "T", depth: 0 } },
      { type: "tab", attrs: { id: "A", depth: 1, name: "A" } },
      lastOfOpenTab,
      { type: "tab", attrs: { id: "B", depth: 1, name: "B" } },
      p("in b", { depth: 2 }),
      p("Hello after tabs"),
    ]);

  test("leaves the line alone when the open tab ends in code (it used to delete the line)", () => {
    const e = tabs({ type: "codeBlock", attrs: { id: "C", depth: 2, language: "plaintext" }, content: [{ type: "text", text: "x=1" }] });
    const before = texts(e);
    e.commands.setTextSelection(posOf(e, 5) + 1);
    expect(key(e, "Backspace")).toBe(true);
    expect(texts(e)).toEqual(before);
    e.destroy();
  });

  test("leaves the line alone when the open tab ends in text (it used to move the words into the tab)", () => {
    const e = tabs(p("in a", { depth: 2 }));
    const before = texts(e);
    e.commands.setTextSelection(posOf(e, 5) + 1);
    expect(key(e, "Backspace")).toBe(true);
    expect(texts(e)).toEqual(before);
    e.destroy();
  });

  test("after a folded toggle it still joins the toggle's own line", () => {
    const e = make([line("toggle", "Toggle", { collapsed: true }), p("hidden", { depth: 1 }), p("after")]);
    e.commands.setTextSelection(posOf(e, 2) + 1);
    expect(key(e, "Backspace")).toBe(true);
    expect(texts(e)).toEqual(["toggle:Toggleafter@0", "paragraph:hidden@1"]);
    e.destroy();
  });
});

describe("folding a toggle", () => {
  const toggled = () => make([line("toggle", "Toggle", { collapsed: false }), p("child", { depth: 1 }), p("deeper", { depth: 2 }), p("after")]);

  test("with the caret in one of its lines puts the caret on the toggle's own line", () => {
    const e = toggled();
    e.commands.setTextSelection(posOf(e, 2) + 3);
    e.view.dispatch(foldToggle(e.state, 0, true));
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(true);
    expect(e.state.selection.$from.index(0)).toBe(0);
    expect(e.state.selection.from).toBe(posOf(e, 1) - 1);
    // What is typed next shows.
    type(e, "!");
    expect(texts(e)[0]).toBe("toggle:Toggle!@0");
    expect(texts(e)[2]).toBe("paragraph:deeper@2");
    e.destroy();
  });

  test("leaves a caret outside it where it was, and opening never moves it", () => {
    const e = toggled();
    e.commands.setTextSelection(posOf(e, 3) + 2);
    const at = e.state.selection.from;
    e.view.dispatch(foldToggle(e.state, 0, true));
    expect(e.state.selection.from).toBe(at);
    e.view.dispatch(foldToggle(e.state, 0, false));
    expect(e.state.selection.from).toBe(at);
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(false);
    e.destroy();
  });

  test("with its key is not an undo step: Cmd+Z after it takes back the typing before", () => {
    const e = make([line("toggle", "Toggle", { collapsed: false }), p("child", { depth: 1 })]);
    e.commands.setTextSelection(posOf(e, 1) - 1);
    type(e, "x");
    const steps = undoDepth(e.state);
    expect(key(e, "Enter", { ctrlKey: true }) || key(e, "Enter", { metaKey: true })).toBe(true);
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(true);
    expect(undoDepth(e.state)).toBe(steps);
    e.destroy();
  });
});

describe("a click on the empty paper under the note", () => {
  test("puts the caret at the end of the last line", () => {
    const e = make([p("One"), p("Two")]);
    expect(focusEndOfNote(e)).toBe(true);
    expect(texts(e)).toEqual(["paragraph:One@0", "paragraph:Two@0"]);
    expect(e.state.selection.from).toBe(e.state.doc.content.size - 1);
    e.destroy();
  });

  test("starts a new line when the note ends in something that can't be written in", () => {
    const e = make([p("One"), { type: "divider", attrs: { id: "D", depth: 0 } }]);
    focusEndOfNote(e);
    expect(texts(e)).toEqual(["paragraph:One@0", "divider:@0", "paragraph:@0"]);
    expect(e.state.selection.$from.index(0)).toBe(2);
    e.destroy();
  });

  test("starts a new line after a folded toggle, never inside what it hides", () => {
    const e = make([line("toggle", "Toggle", { collapsed: true }), p("hidden", { depth: 1 })]);
    focusEndOfNote(e);
    expect(texts(e)).toEqual(["toggle:Toggle@0", "paragraph:hidden@1", "paragraph:@0"]);
    expect(e.state.selection.$from.index(0)).toBe(2);
    e.destroy();
  });

  test("does nothing in a note that can only be read", () => {
    const e = make([p("One")]);
    e.setEditable(false);
    expect(focusEndOfNote(e)).toBe(false);
    e.destroy();
  });
});

describe('the "@" menu', () => {
  const trigger = (text: string) => {
    let last: TriggerState | null = null;
    const e = make([p("")], (t) => (last = t));
    e.commands.setTextSelection(1);
    type(e, text);
    e.destroy();
    return last as TriggerState | null;
  };

  test('"@" then a space is not a mention (its menu took the next Enter)', () => {
    expect(trigger("meet @ ")).toBeNull();
    expect(trigger("meet @ tomorrow")).toBeNull();
  });

  test('"@" alone, and "@" with a name, still open it', () => {
    expect(trigger("meet @")).toMatchObject({ kind: "mention", query: "" });
    expect(trigger("meet @An")).toMatchObject({ kind: "mention", query: "An" });
    expect(trigger("meet @Ann Lee")).toMatchObject({ kind: "mention", query: "Ann Lee" });
  });
});

describe("the numbered list shortcut", () => {
  test('"2", "." and a space make a numbered line', () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, "2. ");
    expect(texts(e)).toEqual(["numbered:@0"]);
    e.destroy();
  });

  test("a phone's double space after a lone number (the keyboard writes \". \" over the space) does not", () => {
    const e = make([p("")]);
    e.commands.setTextSelection(1);
    type(e, "2 ");
    // The second space: iOS replaces the first with ". ".
    input(e, ". ", 2, 3);
    expect(texts(e)).toEqual(["paragraph:2. @0"]);
    e.destroy();
  });

  test("the other shortcuts still work key by key", () => {
    for (const [typed, made] of [["- ", "bulleted"], ["# ", "heading"], ["[] ", "todo"], ["> ", "quote"]] as const) {
      const e = make([p("")]);
      e.commands.setTextSelection(1);
      type(e, typed);
      expect(texts(e)).toEqual([`${made}:@0`]);
      e.destroy();
    }
  });
});
