// Ways the editor used to lose work (docs/EDITOR_AUDIT_2026-11-12.md, section 3), each held here.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap, MarkdownShortcuts } from "@/components/editor/plugins";
import { turnInto } from "@/components/editor/commands";
import { mergeCanvasData } from "@/components/editor/canvas/canvasMerge";
import { setBlockAttrs } from "@/components/editor/canvas/leaveFlush";
import { useCanvasDoc, type CanvasHistory } from "@/components/editor/canvas/useCanvasDoc";

const p = (text: string): JSONContent => ({ type: "paragraph", attrs: { depth: 0 }, content: text ? [{ type: "text", text }] : [] });
function make(content: JSONContent[]) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap, MarkdownShortcuts], content: { type: "doc", content } });
}

describe("text", () => {
  test("Tab with a selection that runs from code into the next block indents the code and deletes nothing", () => {
    const e = make([{ type: "codeBlock", attrs: { depth: 0, language: "plaintext" }, content: [{ type: "text", text: "one\ntwo" }] }, p("after")]);
    // From inside "one" to inside "after".
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, e.state.doc.content.size - 2)));
    e.commands.keyboardShortcut("Tab");
    expect(e.state.doc.child(0).textContent).toBe("  one\n  two");
    expect(e.state.doc.child(1).textContent).toBe("after");
    e.destroy();
  });

  test("turning a to-do into a to-do keeps its date, reminder, assignee and tick", () => {
    const details = { checked: true, dueDate: "2026-12-01", dueTime: "09:00", priority: "high", assigneeId: "u1", reminderAt: 123, repeat: "weekly" };
    const e = make([{ type: "todo", attrs: { id: "T1", depth: 0, ...details }, content: [{ type: "text", text: "call" }] }]);
    e.commands.setTextSelection(2);
    turnInto(e, "todo");
    expect(e.state.doc.child(0).type.name).toBe("todo");
    for (const [k, v] of Object.entries(details)) expect(e.state.doc.child(0).attrs[k]).toBe(v);
    e.destroy();
  });

  test("a block's attributes can still be set by its id once its view no longer knows where it is", () => {
    const e = make([p("a"), { type: "flowchart", attrs: { id: "F1", depth: 0, data: "", height: 440 } }]);
    expect(setBlockAttrs(e, () => undefined, "F1", { data: "x" })).toBe(true);
    expect(e.state.doc.child(1).attrs.data).toBe("x");
    expect(setBlockAttrs(e, () => undefined, "nope", { data: "y" })).toBe(false);
    e.destroy();
  });
});

type Item = { id: string; text: string };
type Doc = { nodes: Item[]; layout?: string };
const doc = (...nodes: [string, string][]): Doc => ({ nodes: nodes.map(([id, text]) => ({ id, text })) });

describe("merging a canvas", () => {
  test("each side's change to a different item is kept", () => {
    const base = doc(["a", "A"], ["b", "B"]);
    expect(mergeCanvasData(base, doc(["a", "A2"], ["b", "B"]), doc(["a", "A"], ["b", "B2"]))).toEqual(doc(["a", "A2"], ["b", "B2"]));
  });
  test("additions from both sides stay, and what this side removed stays removed", () => {
    const base = doc(["a", "A"], ["b", "B"]);
    expect(mergeCanvasData(base, doc(["a", "A"], ["b", "B"], ["t", "T"]), doc(["b", "B"], ["m", "M"]))).toEqual(doc(["b", "B"], ["t", "T"], ["m", "M"]));
  });
  test("an item this side changed survives the other side removing it; one it left alone goes", () => {
    const base = doc(["a", "A"], ["b", "B"]);
    expect(mergeCanvasData(base, doc(), doc(["a", "A!"], ["b", "B"]))).toEqual(doc(["a", "A!"]));
  });
  test("a plain field is this side's when it changed it, else theirs", () => {
    const base: Doc = { nodes: [], layout: "both" };
    expect(mergeCanvasData(base, { nodes: [], layout: "right" }, { nodes: [], layout: "both" }).layout).toBe("right");
    expect(mergeCanvasData(base, { nodes: [], layout: "right" }, { nodes: [], layout: "left" }).layout).toBe("left");
  });
});

class History implements CanvasHistory<Doc> {
  past: Doc[] = [];
  push(before: Doc) {
    this.past.push(before);
  }
  undo() {
    return this.past.pop() ?? null;
  }
  redo() {
    return null;
  }
  clear() {
    this.past = [];
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return false;
  }
}

describe("a canvas block's saving", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const parse = (s: string): Doc => (s ? (JSON.parse(s) as Doc) : { nodes: [] });
  const serialize = (d: Doc) => JSON.stringify(d);
  function open(initial: Doc) {
    const written: string[] = [];
    const result = { current: null as unknown as ReturnType<typeof useCanvasDoc<Doc>> };
    function Probe({ data }: { data: string }) {
      result.current = useCanvasDoc<Doc>({ data, write: (s) => written.push(s), parse, serialize, maxLength: 10_000, newHistory: () => new History() });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const hook = {
      result,
      rerender: ({ data }: { data: string }) => act(() => root.render(<Probe data={data} />)),
      unmount: () => act(() => root.unmount()),
    };
    hook.rerender({ data: serialize(initial) });
    return { hook, written, last: () => parse(written.at(-1) ?? "") };
  }

  test("text still being typed is saved by itself, without waiting for the edit to end", () => {
    const { hook, written, last } = open(doc(["a", ""]));
    act(() => hook.result.current.setLive(doc(["a", "hel"])));
    act(() => hook.result.current.setLive(doc(["a", "hello"])));
    expect(written).toEqual([]);
    act(() => void vi.advanceTimersByTime(900));
    expect(last()).toEqual(doc(["a", "hello"]));
  });

  test("the page closing writes what is unsaved at once", () => {
    const { hook, last } = open(doc(["a", ""]));
    act(() => hook.result.current.setLive(doc(["a", "typed"])));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(last()).toEqual(doc(["a", "typed"]));
  });

  test("so does the block going away", () => {
    const { hook, last } = open(doc(["a", ""]));
    act(() => hook.result.current.commit(doc(["a", "done"])));
    hook.unmount();
    expect(last()).toEqual(doc(["a", "done"]));
  });

  test("a change from elsewhere that finds unsaved work here is merged with it, and undo is kept", () => {
    const { hook, last } = open(doc(["a", "A"], ["b", "B"]));
    act(() => hook.result.current.commit(doc(["a", "mine"], ["b", "B"])));
    hook.rerender({ data: serialize(doc(["a", "A"], ["b", "theirs"])) });
    // Still this device's own view until it saves.
    expect(hook.result.current.doc).toEqual(doc(["a", "mine"], ["b", "B"]));
    act(() => void vi.advanceTimersByTime(500));
    expect(last()).toEqual(doc(["a", "mine"], ["b", "theirs"]));
    expect(hook.result.current.doc).toEqual(doc(["a", "mine"], ["b", "theirs"]));
    expect(hook.result.current.canUndo).toBe(true);
  });

  test("a drag in progress is never rewritten from under the gesture, and the other side's change survives it", () => {
    const start = doc(["a", "A"], ["b", "B"]);
    const { hook, last } = open(start);
    const drag = (text: string) => ({ nodes: [{ id: "a", text }, start.nodes[1]!] });
    act(() => hook.result.current.setLive(drag("moving")));
    hook.rerender({ data: serialize(doc(["a", "A"], ["b", "theirs"])) });
    act(() => void vi.advanceTimersByTime(900));
    // The gesture goes on from the chart as it was when it started.
    expect(hook.result.current.doc).toEqual(drag("moving"));
    act(() => hook.result.current.commit(drag("moved"), { before: start }));
    act(() => void vi.advanceTimersByTime(500));
    expect(last()).toEqual(doc(["a", "moved"], ["b", "theirs"]));
  });

  test("with nothing unsaved here, a change from elsewhere is simply shown", () => {
    const { hook, written } = open(doc(["a", "A"]));
    hook.rerender({ data: serialize(doc(["a", "theirs"])) });
    expect(hook.result.current.doc).toEqual(doc(["a", "theirs"]));
    expect(written).toEqual([]);
  });
});
