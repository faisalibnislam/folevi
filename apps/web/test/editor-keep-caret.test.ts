// @vitest-environment jsdom
// The caret stays where it was when the keyboard comes back to the note (keepCaret.ts): in the Mac app the
// Cmd+K palette, a dialog or the Find field takes the keyboard from the page, and WebKit puts the caret at the
// very start of the note when it is handed back.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { KeepCaret } from "@/components/editor/keepCaret";

const p = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: [{ type: "text", text }] });

describe("the caret when the window gets the keyboard back", () => {
  let host: HTMLElement;
  let e: Editor;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.body.appendChild(document.createElement("div"));
    e = new Editor({ element: host, extensions: [...ALL_NODES, ...ALL_MARKS, BlockIdentity, KeepCaret], content: { type: "doc", content: [p("a", "one two three"), p("b", "four")] } });
    (e.view.dom as HTMLElement).focus();
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 6)));
  });
  afterEach(() => {
    e.destroy();
    host.remove();
    vi.useRealTimers();
  });
  /** What WebKit does when the page is handed the keyboard again: the caret at the very start. */
  const reset = () => e.view.dispatch(e.state.tr.setSelection(Selection.atStart(e.state.doc)));
  const settle = () => vi.advanceTimersByTime(200);

  test("is put back where it was", () => {
    window.dispatchEvent(new Event("blur"));
    reset();
    window.dispatchEvent(new Event("focus"));
    settle();
    expect(e.state.selection.from).toBe(6);
  });

  test("a range is put back whole", () => {
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 5, 8)));
    window.dispatchEvent(new Event("blur"));
    reset();
    window.dispatchEvent(new Event("focus"));
    settle();
    expect([e.state.selection.from, e.state.selection.to]).toEqual([5, 8]);
  });

  test("a press that brings the window back keeps the place it chose", () => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pointerdown"));
    reset();
    settle();
    expect(e.state.selection.from).toBe(1);
  });

  test("a place chosen since (not the browser's reset) is left alone, and so is a note that changed", () => {
    window.dispatchEvent(new Event("blur"));
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 10)));
    window.dispatchEvent(new Event("focus"));
    settle();
    expect(e.state.selection.from).toBe(10);

    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 6)));
    window.dispatchEvent(new Event("blur"));
    // (Something else changed the note meanwhile: the place that was kept is not a place in this text.)
    e.view.dispatch(e.state.tr.insertText("!", 14));
    reset();
    window.dispatchEvent(new Event("focus"));
    settle();
    expect(e.state.selection.from).toBe(1);
  });

  test("nothing is put back when the note did not have the keyboard", () => {
    (e.view.dom as HTMLElement).blur();
    window.dispatchEvent(new Event("blur"));
    reset();
    window.dispatchEvent(new Event("focus"));
    settle();
    expect(e.state.selection.from).toBe(1);
  });
});
