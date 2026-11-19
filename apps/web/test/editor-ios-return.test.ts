// @vitest-environment jsdom
// Return on an iPhone or iPad. There ProseMirror never hands the Return key to the editor's own handlers: it
// lets WebKit make its line, looks at what changed in the page, and then runs Enter itself (and, if it saw no
// new line, tries again 200 ms later). In a to-do or a toggle, WebKit's new line is a copy of the text holder
// put beside it, inside the block's own element. Those views told ProseMirror to ignore everything outside the
// text holder, so it never saw the new line: Return in the middle of a task deleted the words after the caret
// from the note (they stayed on screen in a stray element until the next reload), and every Return was 200 ms
// late with what was typed meanwhile lost. (The apps' engine is WebKit; the other tests run ProseMirror's
// desktop path, which is why none of them saw it.)
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/core";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const was = { vendor: navigator.vendor, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
let make: (content: JSONContent[]) => TiptapEditor;

beforeAll(async () => {
  // ProseMirror decides which browser it is in when it is first loaded.
  for (const [k, v] of Object.entries({ vendor: "Apple Computer, Inc.", userAgent: IPHONE, maxTouchPoints: 5 })) Object.defineProperty(navigator, k, { value: v, configurable: true });
  vi.resetModules();
  const { Editor } = await import("@tiptap/core");
  const { UndoRedo } = await import("@tiptap/extensions");
  const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
  const { BlockIdentity, BlockKeymap } = await import("@/components/editor/plugins");
  make = (content) => {
    const element = document.createElement("div");
    document.body.append(element);
    return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap], content: { type: "doc", content } });
  };
});
afterAll(() => {
  for (const [k, v] of Object.entries(was)) Object.defineProperty(navigator, k, { value: v, configurable: true });
  vi.resetModules();
});

const block = (type: string, text: string): JSONContent => ({ type, attrs: { id: `${type}-1`, depth: 0 }, content: [{ type: "text", text }] });
const lines = (e: TiptapEditor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};

/**
 * What WebKit does to the page for Return with the caret `at` characters into the block's text: a copy of the
 * text holder goes in after it, and the words after the caret move there (an empty line gets a <br>). Then
 * ProseMirror reads the change, as it does when the browser tells it the page changed.
 */
function webkitReturn(e: TiptapEditor, at: number) {
  e.commands.setTextSelection(1 + at);
  const holder = e.view.dom.querySelector<HTMLElement>(".fb-content")!;
  const row = holder.parentElement!;
  const view = e.view as unknown as { input: { lastIOSEnter: number; lastIOSEnterFallbackTimeout: ReturnType<typeof setTimeout> | number }; domObserver: { flush(): void } };
  view.input.lastIOSEnter = Date.now();
  const copy = holder.cloneNode(false) as HTMLElement;
  holder.after(copy);
  const text = holder.firstChild as Text;
  if (at < text.length) copy.append(text.splitText(at));
  else copy.append(document.createElement("br"));
  view.domObserver.flush();
  return { row, copy };
}

describe("Return on an iPhone or iPad", () => {
  test.each(["todo", "toggle"])("in the middle of a %s the words after the caret go to a new line of the note", (type) => {
    const e = make([block(type, "Buy milk")]);
    const { row, copy } = webkitReturn(e, 4);
    expect(lines(e)).toEqual(["Buy ", "milk"]);
    expect(e.state.doc.firstChild!.type.name).toBe(type);
    // WebKit's own line is gone from the page: each block holds its own parts only.
    expect(e.view.dom.contains(copy)).toBe(false);
    for (const drawn of e.view.dom.children) expect(drawn.children).toHaveLength(drawn.classList.contains("fb-todo") ? 3 : drawn.classList.contains("fb-toggle") ? 2 : 0);
    void row;
    e.destroy();
  });

  test.each(["todo", "toggle"])("at the end of a %s the new line is made at once, not 200 ms later", (type) => {
    const e = make([block(type, "Buy milk")]);
    const { row, copy } = webkitReturn(e, 8);
    expect(lines(e)).toEqual(["Buy milk", ""]);
    expect(e.view.dom.contains(copy)).toBe(false);
    void row;
    e.destroy();
  });

  test("something the browser left beside a task's text is taken out the next time the task is drawn", () => {
    const e = make([block("todo", "Buy milk")]);
    const row = e.view.dom.querySelector<HTMLElement>(".fb-todo")!;
    row.append(document.createElement("div"));
    e.view.dispatch(e.state.tr.insertText("!", 9));
    expect(e.view.dom.querySelector(".fb-todo")!.children).toHaveLength(3);
    expect(lines(e)).toEqual(["Buy milk!"]);
    e.destroy();
  });

  test("the block's own drawing is still left alone (a checked box, a task's date)", () => {
    const e = make([{ type: "todo", attrs: { id: "t1", depth: 0, dueDate: "2026-12-01" }, content: [{ type: "text", text: "Pay rent" }] }]);
    const view = e.view as unknown as { domObserver: { flush(): void } };
    e.view.dispatch(e.state.tr.setNodeMarkup(0, undefined, { ...e.state.doc.firstChild!.attrs, checked: true, priority: "high" }));
    view.domObserver.flush();
    expect(lines(e)).toEqual(["Pay rent"]);
    expect(e.state.doc.firstChild!.attrs.checked).toBe(true);
    expect(e.view.dom.querySelector(".fb-todo")!.getAttribute("data-checked")).toBe("true");
    e.destroy();
  });
});
