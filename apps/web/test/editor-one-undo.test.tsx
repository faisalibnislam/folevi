// @vitest-environment jsdom
// Undo across the note and its canvases (docs/EDITOR_AUDIT_2026-11-12.md: B5, B11, F10, M4): a canvas's own
// undo is never a step the note's undo then reverses, the note's undo passes over steps with nothing left to
// change, Cmd+Z in a label being typed takes back the typing first, and a note's history outlives its editor.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { NoteHistory } from "@/components/editor/noteHistory";
import { setBlockAttrs, useBlockDataWriter, type CanvasWrite } from "@/components/editor/canvas/leaveFlush";
import { canvasLedger } from "@/components/editor/canvas/noteUndo";
import { useCanvasDoc, type CanvasHistory } from "@/components/editor/canvas/useCanvasDoc";
import { TypingHistory, typingUndoKey } from "@/components/editor/canvas/typingHistory";
import { forgetNoteHistories, keepNoteHistory, restoreNoteHistory } from "@/components/editor/historyKeep";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const p = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const board = (id: string, data: string): JSONContent => ({ type: "whiteboard", attrs: { id, depth: 0, data, height: 240 } });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, NoteHistory.configure({ newGroupDelay: 600 }), BlockIdentity], content: { type: "doc", content } });
const dataOf = (e: Editor, id: string) => {
  let found = "";
  e.state.doc.forEach((n) => {
    if (n.attrs.id === id) found = String(n.attrs.data);
  });
  return found;
};
const textOf = (e: Editor) => e.state.doc.firstChild!.textContent;

describe("the note's undo and a canvas's own", () => {
  test("a canvas write is a step of the note's undo by itself", () => {
    const e = make([p("a", "one"), board("w", "d0")]);
    e.commands.insertContentAt(4, "!");
    setBlockAttrs(e, false, "w", { data: "d1" }, "step");
    setBlockAttrs(e, false, "w", { data: "d2" }, "step");
    expect(undoDepth(e.state)).toBe(3);
    e.commands.undo();
    expect(dataOf(e, "w")).toBe("d1");
    expect(textOf(e)).toBe("one!");
    e.destroy();
  });

  test("the canvas's own undo is no step: the note's Cmd+Z does not put the change back", () => {
    const e = make([p("a", "one"), board("w", "d0")]);
    e.commands.insertContentAt(4, "!");
    setBlockAttrs(e, false, "w", { data: "d1" }, "step");
    // The canvas takes its change back itself.
    setBlockAttrs(e, false, "w", { data: "d0" }, "none");
    expect(undoDepth(e.state)).toBe(2);
    // One press in the note: the canvas's step has nothing left to change, so it is passed over and the
    // typing before it goes.
    e.commands.undo();
    expect(dataOf(e, "w")).toBe("d0");
    expect(textOf(e)).toBe("one");
    expect(undoDepth(e.state)).toBe(0);
    e.destroy();
  });

  test("redo passes over the same empty step on the way back", () => {
    const e = make([p("a", "one"), board("w", "d0")]);
    e.commands.insertContentAt(4, "!");
    setBlockAttrs(e, false, "w", { data: "d1" }, "step");
    setBlockAttrs(e, false, "w", { data: "d0" }, "none");
    e.commands.undo();
    e.commands.redo();
    expect(textOf(e)).toBe("one!");
    // (The canvas took its change back itself, so only the canvas's own redo brings it back: for the note
    // there is nothing more to redo.)
    e.commands.redo();
    expect(dataOf(e, "w")).toBe("d0");
    expect(textOf(e)).toBe("one!");
    expect(redoDepth(e.state)).toBe(0);
    e.destroy();
  });

  test("asking whether there is something to undo changes nothing", () => {
    const e = make([p("a", "one")]);
    expect(e.can().undo()).toBe(false);
    e.commands.insertContentAt(4, "!");
    expect(e.can().undo()).toBe(true);
    expect(textOf(e)).toBe("one!");
    e.destroy();
  });
});

interface Doc {
  nodes: { id: string; text: string }[];
}
class History implements CanvasHistory<Doc> {
  past: Doc[] = [];
  future: Doc[] = [];
  push(before: Doc) {
    this.past.push(before);
    this.future = [];
  }
  undo(current: Doc) {
    const prev = this.past.pop() ?? null;
    if (prev) this.future.push(current);
    return prev;
  }
  redo(current: Doc) {
    const next = this.future.pop() ?? null;
    if (next) this.past.push(current);
    return next;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}

describe("what a canvas tells the note about each write", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const parse = (s: string): Doc => (s ? (JSON.parse(s) as Doc) : { nodes: [] });
  const serialize = (d: Doc) => JSON.stringify(d);
  const doc = (...texts: string[]): Doc => ({ nodes: texts.map((text, i) => ({ id: `n${i}`, text })) });
  function open(initial: Doc) {
    const written: { data: string; how?: CanvasWrite }[] = [];
    const result = { current: null as unknown as ReturnType<typeof useCanvasDoc<Doc>> };
    function Probe({ data }: { data: string }) {
      result.current = useCanvasDoc<Doc>({ data, write: (data, how) => written.push({ data, how }), parse, serialize, maxLength: 10_000, newHistory: () => new History() });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = (data: string) => act(() => root.render(<Probe data={data} />));
    render(serialize(initial));
    return { result, written, render, unmount: () => act(() => root.unmount()) };
  }
  const settle = () => act(() => void vi.advanceTimersByTime(500));

  test("a change, the text typed on the way, and the canvas's own undo and redo are each told apart", () => {
    const { result, written, render, unmount } = open(doc("a"));
    // Typing (saved while it is still being typed), then the edit ends.
    act(() => result.current.setLive(doc("ab")));
    act(() => void vi.advanceTimersByTime(900));
    render(written.at(-1)!.data);
    act(() => result.current.commit(doc("abc"), { before: doc("a") }));
    settle();
    render(written.at(-1)!.data);
    // The canvas's own undo and redo are written at once.
    act(() => void result.current.undo());
    render(written.at(-1)!.data);
    act(() => void result.current.redo());
    expect(written.map((w) => [parse(w.data).nodes[0]!.text, w.how?.kind ?? "change"])).toEqual([
      ["ab", "live"],
      ["abc", "change"],
      ["a", "undo"],
      ["abc", "redo"],
    ]);
    unmount();
  });

  test("an undo mixed with a change not yet saved is written as a change like any other", () => {
    const { result, written, render, unmount } = open(doc("a"));
    act(() => result.current.commit(doc("b")));
    settle();
    render(written.at(-1)!.data);
    act(() => result.current.commit(doc("c")));
    act(() => result.current.commit(doc("d")));
    act(() => void result.current.undo());
    settle();
    expect(parse(written.at(-1)!.data).nodes[0]!.text).toBe("c");
    expect(written.at(-1)!.how?.kind).toBeUndefined();
    unmount();
  });

  test("a change undone before it was ever saved writes nothing", () => {
    const { result, written, unmount } = open(doc("a"));
    act(() => result.current.commit(doc("b")));
    act(() => void result.current.undo());
    settle();
    expect(written).toEqual([]);
    unmount();
  });
});

describe("a canvas in a real note: one undo for both", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const parse = (s: string): Doc => (s ? (JSON.parse(s) as Doc) : { nodes: [] });
  const serialize = (d: Doc) => JSON.stringify(d);
  const one = (text: string): Doc => ({ nodes: [{ id: "n0", text }] });
  const said = (e: Editor) => parse(dataOf(e, "w")).nodes[0]?.text ?? "";

  /** A canvas block's own document hook writing into a real note, as the flowchart, mind map and wireframe do. */
  function open(e: Editor) {
    const result = { current: null as unknown as ReturnType<typeof useCanvasDoc<Doc>> };
    function Probe({ data }: { data: string }) {
      const write = useBlockDataWriter({ editor: e, getPos: false, node: { attrs: { id: "w" } } });
      result.current = useCanvasDoc<Doc>({ data, write, parse, serialize, maxLength: 10_000, newHistory: () => new History() });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = () => act(() => root.render(<Probe data={dataOf(e, "w")} />));
    render();
    return { result, render, unmount: () => act(() => root.unmount()) };
  }
  const settle = () => act(() => void vi.advanceTimersByTime(500));

  test("text saved while it was typed and the finished edit are one step of the note's undo", () => {
    const e = make([p("a", "one"), board("w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    const before = result.current.docRef.current;
    for (const text of ["Pl", "Plan", "Plan for"]) {
      act(() => result.current.setLive(one(text)));
      act(() => void vi.advanceTimersByTime(900));
      render();
    }
    act(() => result.current.commit(one("Plan for launch"), { before }));
    settle();
    expect(said(e)).toBe("Plan for launch");
    expect(undoDepth(e.state)).toBe(1);
    expect(canvasLedger(e).done).toEqual(["w"]);
    // The note's own Cmd+Z: all of it, not back to a half-typed "Plan for".
    e.commands.undo();
    expect(said(e)).toBe("");
    unmount();
    e.destroy();
  });

  test("the canvas's Cmd+Z takes the note's step with it, so the note's Cmd+Z then undoes what came before", () => {
    const e = make([p("a", "one"), board("w", serialize(one("")))]);
    e.commands.insertContentAt(4, "!");
    const { result, render, unmount } = open(e);
    const before = result.current.docRef.current;
    act(() => result.current.setLive(one("Plan")));
    act(() => void vi.advanceTimersByTime(900));
    render();
    act(() => result.current.commit(one("Plan for"), { before }));
    settle();
    render();
    expect(undoDepth(e.state)).toBe(2);
    act(() => void result.current.undo());
    expect(said(e)).toBe("");
    expect(undoDepth(e.state)).toBe(1);
    expect(redoDepth(e.state)).toBe(1);
    render();
    expect(result.current.canRedo).toBe(true);
    // Cmd+Z in the note: the typing from before the canvas was touched. Nothing of the canvas comes back.
    e.commands.undo();
    expect(textOf(e)).toBe("one");
    expect(said(e)).toBe("");
    unmount();
    e.destroy();
  });

  test("and its redo brings the same step back in both places", () => {
    const e = make([p("a", "one"), board("w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    act(() => result.current.commit(one("Plan")));
    settle();
    render();
    act(() => result.current.commit(one("Plan B")));
    settle();
    render();
    act(() => void result.current.undo());
    render();
    act(() => void result.current.undo());
    render();
    expect(said(e)).toBe("");
    expect(undoDepth(e.state)).toBe(0);
    act(() => void result.current.redo());
    render();
    expect(said(e)).toBe("Plan");
    expect(undoDepth(e.state)).toBe(1);
    expect(redoDepth(e.state)).toBe(1);
    expect(canvasLedger(e)).toEqual({ done: ["w"], undone: ["w"] });
    unmount();
    e.destroy();
  });

  test("with something else done in the note since, the canvas's undo is no step, and the note's passes over what it took back", () => {
    const e = make([p("a", "one"), board("w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    act(() => result.current.commit(one("Plan")));
    settle();
    render();
    e.commands.insertContentAt(4, "!");
    expect(undoDepth(e.state)).toBe(2);
    act(() => void result.current.undo());
    expect(said(e)).toBe("");
    // (Not through the note's history: its last step is the typing.)
    expect(undoDepth(e.state)).toBe(2);
    expect(textOf(e)).toBe("one!");
    e.commands.undo();
    expect(textOf(e)).toBe("one");
    // One more: the canvas's step has nothing left to change, so nothing comes back.
    e.commands.undo();
    expect(said(e)).toBe("");
    expect(undoDepth(e.state)).toBe(0);
    unmount();
    e.destroy();
  });

  test("the note's own Cmd+Z on a canvas step is known to the canvas's list too", () => {
    const e = make([p("a", "one"), board("w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    act(() => result.current.commit(one("Plan")));
    settle();
    render();
    e.commands.undo();
    expect(said(e)).toBe("");
    expect(canvasLedger(e)).toEqual({ done: [], undone: ["w"] });
    e.commands.redo();
    expect(said(e)).toBe("Plan");
    expect(canvasLedger(e)).toEqual({ done: ["w"], undone: [] });
    unmount();
    e.destroy();
  });
});

describe("Cmd+Z in a label being typed", () => {
  const z = { key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
  const redo = { ...z, shiftKey: true };

  test("takes the typing back a step at a time, then has nothing left", () => {
    const h = new TypingHistory("Idea");
    let now = 1000;
    for (const text of ["Idea ", "Idea o", "Idea on", "Idea one"]) h.record(text, (now += 100));
    // A pause, then more.
    now += 2000;
    for (const text of ["Idea one ", "Idea one t", "Idea one tw", "Idea one two"]) h.record(text, (now += 100));
    expect(typingUndoKey(z, h)).toBe("Idea one ");
    expect(typingUndoKey(z, h)).toBe("Idea one");
    expect(typingUndoKey(z, h)).toBe("Idea ");
    expect(typingUndoKey(z, h)).toBe("Idea");
    expect(typingUndoKey(z, h)).toBeNull();
    expect(typingUndoKey(redo, h)).toBe("Idea ");
  });

  test("deleting after typing is a step of its own, and so is a paste", () => {
    const h = new TypingHistory("");
    let now = 0;
    for (const text of ["a", "ab", "abc"]) h.record(text, (now += 50));
    for (const text of ["ab", "a"]) h.record(text, (now += 50));
    h.record("a pasted line", now + 50);
    expect(h.undo()).toBe("a");
    expect(h.undo()).toBe("abc");
    expect(h.undo()).toBe("");
    expect(h.undo()).toBeNull();
  });

  test("typing after an undo ends what could be redone; other keys are not its business", () => {
    const h = new TypingHistory("x");
    h.record("xy", 10);
    h.undo();
    h.record("xz", 20);
    expect(h.redo()).toBeNull();
    expect(typingUndoKey({ ...z, key: "b" }, h)).toBeNull();
    expect(typingUndoKey(z, null)).toBeNull();
  });
});

describe("a note's history after its editor is gone", () => {
  beforeEach(() => forgetNoteHistories());

  test("the note's next editor has it when the note reads the same", () => {
    const first = make([p("a", "one"), p("b", "two")]);
    first.commands.insertContentAt(4, "!");
    keepNoteHistory("me:note", first.state);
    const content = first.getJSON().content!;
    first.destroy();

    const second = make(content);
    expect(second.can().undo()).toBe(false);
    expect(restoreNoteHistory("me:note", second)).toBe(true);
    second.commands.undo();
    expect(textOf(second)).toBe("one");
    second.commands.redo();
    expect(textOf(second)).toBe("one!");
    second.destroy();
  });

  test("each step comes back as its own, in order, with changes from elsewhere left in place", () => {
    const first = make([p("a", "one"), board("w", "d0"), p("b", "two")]);
    first.commands.insertContentAt(4, "!");
    setBlockAttrs(first, false, "w", { data: "d1" }, "step");
    // Another device changes the last line (never a step of this note's undo).
    const end = first.state.doc.content.size - 1;
    first.view.dispatch(first.state.tr.insertText(" (theirs)", end).setMeta("addToHistory", false));
    setBlockAttrs(first, false, "w", { data: "d2" }, "step");
    keepNoteHistory("me:note", first.state);
    const content = first.getJSON().content!;
    first.destroy();

    const second = make(content);
    expect(restoreNoteHistory("me:note", second)).toBe(true);
    expect(undoDepth(second.state)).toBe(3);
    second.commands.undo();
    expect(dataOf(second, "w")).toBe("d1");
    second.commands.undo();
    expect(dataOf(second, "w")).toBe("d0");
    expect(textOf(second)).toBe("one!");
    second.commands.undo();
    expect(textOf(second)).toBe("one");
    expect(second.state.doc.lastChild!.textContent).toBe("two (theirs)");
    second.destroy();
  });

  test("a note that changed in between starts with none", () => {
    const first = make([p("a", "one")]);
    first.commands.insertContentAt(4, "!");
    keepNoteHistory("me:note", first.state);
    first.destroy();
    const second = make([p("a", "one! and more from another device")]);
    expect(restoreNoteHistory("me:note", second)).toBe(false);
    expect(second.can().undo()).toBe(false);
    // (And it is not offered again.)
    expect(restoreNoteHistory("me:note", second)).toBe(false);
    second.destroy();
  });

  test("a note with nothing to undo keeps nothing, and another note's history is not this one's", () => {
    const first = make([p("a", "one")]);
    keepNoteHistory("me:note", first.state);
    const second = make([p("a", "one")]);
    expect(restoreNoteHistory("me:note", second)).toBe(false);
    first.commands.insertContentAt(4, "!");
    keepNoteHistory("me:other", first.state);
    expect(restoreNoteHistory("me:note", second)).toBe(false);
    first.destroy();
    second.destroy();
  });
});
