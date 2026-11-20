// @vitest-environment jsdom
// Undo in and around a canvas when it is not the only one changing it (the 2026-11-19 canvas audit, V1 to
// V3, V9 to V11 and V15): the note's undo and the canvas's own never take away what another device or person
// did, a merge too large to store is not made, a label finished with nothing more typed ends its step, one
// canvas undo moves the note's history by at most one step, and a gesture is not merged under.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import { emptyStickies, parseFlowchart, parseStickies, parseWhiteboard, serializeFlowchart, serializeStickies, serializeWhiteboard, stickyFromIdea, voteOnSticky, type WhiteboardStroke } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { NoteHistory } from "@/components/editor/noteHistory";
import { setBlockAttrs, useBlockDataWriter, writeCanvasStep, type CanvasWrite } from "@/components/editor/canvas/leaveFlush";
import { asCanvasStep, canvasLedger, forgetCanvasSteps } from "@/components/editor/canvas/noteUndo";
import { useCanvasDoc, type CanvasHistory } from "@/components/editor/canvas/useCanvasDoc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const p = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const block = (type: string, id: string, data: string): JSONContent => ({ type, attrs: { id, depth: 0, data, height: 400 } });
const make = (content: JSONContent[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, NoteHistory.configure({ newGroupDelay: 600 }), BlockIdentity], content: { type: "doc", content } });
const dataOf = (e: Editor, id: string) => {
  let found = "";
  e.state.doc.forEach((n) => {
    if (n.attrs.id === id) found = String(n.attrs.data);
  });
  return found;
};
const textOf = (e: Editor) => e.state.doc.firstChild!.textContent;

/** A change from another device, as remoteApply.ts makes it: the whole block replaced, and no step of this note's undo. */
function remote(e: Editor, id: string, data: string) {
  let pos = -1;
  e.state.doc.forEach((n, off) => {
    if (n.attrs.id === id) pos = off;
  });
  const node = e.state.doc.nodeAt(pos)!;
  e.view.dispatch(e.state.tr.replaceWith(pos, pos + node.nodeSize, node.type.create({ ...node.attrs, data })).setMeta("remote", true).setMeta("addToHistory", false));
}
/** This device's own finished change to a canvas, as its writer saves it. */
const own = (e: Editor, id: string, data: string, me?: string) => setBlockAttrs(e, false, id, { data }, (tr) => asCanvasStep(e, tr, id, true, me));

const chart = (...shapes: string[]) =>
  serializeFlowchart(parseFlowchart(JSON.stringify({ v: 2, nodes: shapes.map((id, i) => ({ id, shape: "process", x: i * 200, y: 0, w: 120, h: 60, text: id.toUpperCase() })), edges: [] })));
const shapes = (data: string) => parseFlowchart(data).nodes.map((n) => n.id);

describe("the note's undo of a canvas step, when someone else changed the canvas since (V1)", () => {
  beforeEach(() => forgetCanvasSteps());

  test("a flowchart: only this device's shape goes, and redo brings only that back", () => {
    const e = make([p("a", "one"), block("flowchart", "w", chart("a"))]);
    own(e, "w", chart("a", "mine"));
    remote(e, "w", chart("a", "mine", "theirs"));
    e.commands.undo();
    expect(shapes(dataOf(e, "w"))).toEqual(["a", "theirs"]);
    e.commands.redo();
    expect(shapes(dataOf(e, "w")).sort()).toEqual(["a", "mine", "theirs"]);
    // And once more each way, on what the redo left.
    e.commands.undo();
    expect(shapes(dataOf(e, "w"))).toEqual(["a", "theirs"]);
    e.destroy();
  });

  test("with nothing changed in between it is the plain undo, to the letter", () => {
    const e = make([p("a", "one"), block("flowchart", "w", chart("a"))]);
    const before = dataOf(e, "w");
    own(e, "w", chart("a", "mine"));
    e.commands.undo();
    expect(dataOf(e, "w")).toBe(before);
    e.commands.redo();
    expect(dataOf(e, "w")).toBe(chart("a", "mine"));
    e.destroy();
  });

  test("two of this device's steps, then theirs: each undo takes back one of them and theirs stays", () => {
    const e = make([p("a", "one"), block("flowchart", "w", chart("a"))]);
    own(e, "w", chart("a", "m1"));
    own(e, "w", chart("a", "m1", "m2"));
    remote(e, "w", chart("a", "m1", "m2", "theirs"));
    e.commands.undo();
    expect(shapes(dataOf(e, "w"))).toEqual(["a", "m1", "theirs"]);
    e.commands.undo();
    expect(shapes(dataOf(e, "w"))).toEqual(["a", "theirs"]);
    expect(undoDepth(e.state)).toBe(0);
    e.destroy();
  });

  test("sticky notes: the other person's note and votes stay", () => {
    const board = (ids: string[]) => ({ ...emptyStickies(), notes: ids.map((id, i) => stickyFromIdea({ text: id }, id, { x: i * 200, y: 0 }, "alice")) });
    const d0 = serializeStickies(board(["s1"]));
    const mine = serializeStickies(board(["s1", "s2"]));
    const theirs = serializeStickies(voteOnSticky(board(["s1", "s2", "s3"]), "s1", "bob", 1));
    const e = make([p("a", "one"), block("stickies", "w", d0)]);
    own(e, "w", mine, "alice");
    remote(e, "w", theirs);
    e.commands.undo();
    const now = parseStickies(dataOf(e, "w"));
    expect(now.notes.map((n) => n.id)).toEqual(["s1", "s3"]);
    expect(now.notes[0]!.votes).toEqual({ bob: 1 });
    e.destroy();
  });

  test("a whiteboard: the stroke drawn here goes, the one drawn there stays", () => {
    const stroke = (x: number): WhiteboardStroke => ({ points: [[x, 10], [x + 40, 60]], color: "ink", width: 3 });
    const sheet = (...xs: number[]) => serializeWhiteboard({ strokes: xs.map(stroke) });
    const e = make([p("a", "one"), block("whiteboard", "w", sheet(100))]);
    // (As the whiteboard itself writes a stroke.)
    writeCanvasStep(e, false, "w", { data: sheet(100, 200) });
    remote(e, "w", sheet(100, 200, 300));
    e.commands.undo();
    expect(parseWhiteboard(dataOf(e, "w")).strokes.map((s) => s.points![0]![0])).toEqual([100, 300]);
    e.commands.redo();
    expect(parseWhiteboard(dataOf(e, "w")).strokes.map((s) => s.points![0]![0]).sort()).toEqual([100, 200, 300]);
    e.destroy();
  });

  test("data no reader here understands is put back as it was, never merged into an empty canvas", () => {
    const e = make([p("a", "one"), block("flowchart", "w", "from a newer app")]);
    own(e, "w", chart("a"));
    remote(e, "w", chart("a", "theirs"));
    e.commands.undo();
    expect(dataOf(e, "w")).toBe("from a newer app");
    e.destroy();
  });

  test("text typed in the note between is undone as before, and the canvas step after it still keeps theirs", () => {
    const e = make([p("a", "one"), block("flowchart", "w", chart("a"))]);
    own(e, "w", chart("a", "mine"));
    e.commands.insertContentAt(4, "!");
    remote(e, "w", chart("a", "mine", "theirs"));
    e.commands.undo();
    expect(textOf(e)).toBe("one");
    expect(shapes(dataOf(e, "w"))).toEqual(["a", "mine", "theirs"]);
    e.commands.undo();
    expect(shapes(dataOf(e, "w"))).toEqual(["a", "theirs"]);
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
const parse = (s: string): Doc => (s ? (JSON.parse(s) as Doc) : { nodes: [] });
const serialize = (d: Doc) => JSON.stringify(d);
const nodes = (...pairs: [string, string][]): Doc => ({ nodes: pairs.map(([id, text]) => ({ id, text })) });
const said = (data: string) => parse(data).nodes.map((n) => `${n.id}:${n.text}`);

/** A canvas block's document hook with nothing behind it: what it writes is listed. */
function openBare(initial: Doc, maxLength = 10_000, parseFn = parse) {
  const written: { data: string; how?: CanvasWrite }[] = [];
  const result = { current: null as unknown as ReturnType<typeof useCanvasDoc<Doc>> };
  function Probe({ data }: { data: string }) {
    result.current = useCanvasDoc<Doc>({ data, write: (data, how) => written.push({ data, how }), parse: parseFn, serialize, maxLength, newHistory: () => new History() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (data: string) => act(() => root.render(<Probe data={data} />));
  render(serialize(initial));
  /** What was saved, without the "this change is finished" notes that write nothing. */
  const saves = () => written.filter((w) => w.how?.kind !== "end");
  return { result, written, saves, render, unmount: () => act(() => root.unmount()) };
}
const settle = () => act(() => void vi.advanceTimersByTime(500));

describe("a canvas's own document while someone else changes the block", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("the canvas's undo after a merge takes back only its own change (V2)", () => {
    const { result, saves, render, unmount } = openBare(nodes(["n0", "a"], ["n1", "b"]));
    // Mine, not saved yet; then theirs arrives: n1 changed and n2 added.
    act(() => result.current.commit(nodes(["n0", "A-mine"], ["n1", "b"])));
    render(serialize(nodes(["n0", "a"], ["n1", "B-theirs"], ["n2", "new-theirs"])));
    settle();
    expect(said(saves().at(-1)!.data)).toEqual(["n0:A-mine", "n1:B-theirs", "n2:new-theirs"]);
    render(saves().at(-1)!.data);
    act(() => void result.current.undo());
    settle();
    expect(said(saves().at(-1)!.data)).toEqual(["n0:a", "n1:B-theirs", "n2:new-theirs"]);
    // And its redo puts only that change back.
    render(saves().at(-1)!.data);
    act(() => void result.current.redo());
    settle();
    expect(said(saves().at(-1)!.data)).toEqual(["n0:A-mine", "n1:B-theirs", "n2:new-theirs"]);
    unmount();
  });

  test("an edit that began before their change, finished after it: its undo keeps theirs too (V2)", () => {
    const { result, saves, render, unmount } = openBare(nodes(["n0", "a"], ["n1", "b"]));
    // An edit begins: the view keeps the canvas as it was, to undo to.
    const before = result.current.docRef.current;
    act(() => result.current.setLive(nodes(["n0", "ab"], ["n1", "b"])));
    render(serialize(nodes(["n0", "a"], ["n1", "B-theirs"])));
    // A pause in the typing: their change is merged in.
    act(() => void vi.advanceTimersByTime(1600));
    expect(said(saves().at(-1)!.data)).toEqual(["n0:ab", "n1:B-theirs"]);
    render(saves().at(-1)!.data);
    act(() => result.current.commit({ nodes: result.current.docRef.current.nodes.map((n) => (n.id === "n0" ? { ...n, text: "abc" } : n)) }, { before }));
    settle();
    render(saves().at(-1)!.data);
    act(() => void result.current.undo());
    settle();
    expect(said(saves().at(-1)!.data)).toEqual(["n0:a", "n1:B-theirs"]);
    unmount();
  });

  test("an edit cancelled after their change puts back only what the edit did", () => {
    const { result, saves, render, unmount } = openBare(nodes(["n0", "a"], ["n1", "b"]));
    const before = result.current.docRef.current;
    act(() => result.current.setLive(nodes(["n0", "ab"], ["n1", "b"])));
    render(serialize(nodes(["n0", "a"], ["n1", "B-theirs"])));
    act(() => void vi.advanceTimersByTime(1600));
    render(saves().at(-1)!.data);
    // Escape: the view hands back the canvas it kept.
    act(() => result.current.setLive(before));
    act(() => void vi.advanceTimersByTime(900));
    expect(said(saves().at(-1)!.data)).toEqual(["n0:a", "n1:B-theirs"]);
    unmount();
  });

  test("saving with nothing changed writes nothing, even when the stored text is spelled another way", () => {
    // (Found 2026-11-19: a flowchart saves as it loses focus, and one stored with a default this reader leaves
    // out was rewritten every time it was only looked at or presented: e2e/flowchart-present.spec.ts.)
    const { result, written, render, unmount } = openBare(nodes(["n0", "a"]));
    const spelled = '{ "nodes": [ { "id": "n0", "text": "a" }, { "id": "n1", "text": "b" } ] }';
    render(spelled);
    expect(said(serialize(result.current.docRef.current))).toEqual(["n0:a", "n1:b"]);
    act(() => result.current.flush());
    expect(written).toEqual([]);
    // A change made here is saved as before, in this reader's spelling.
    act(() => result.current.commit(nodes(["n0", "a"], ["n1", "b"], ["n2", "c"])));
    act(() => result.current.flush());
    expect(written.map((w) => said(w.data))).toEqual([["n0:a", "n1:b", "n2:c"]]);
    unmount();
  });

  test("a merge too large to store is not made, and nothing is written (V3)", () => {
    const big = (n: number) => "x".repeat(n);
    const limit = 400;
    // (As the real readers do: over the limit, an empty canvas.)
    const parseLimited = (s: string): Doc => (!s || s.length > limit ? { nodes: [] } : (JSON.parse(s) as Doc));
    const base = nodes(["n0", big(100)]);
    const { result, written, render, unmount } = openBare(base, limit, parseLimited);
    act(() => result.current.commit({ nodes: [...base.nodes, { id: "m1", text: big(120) }] }));
    render(serialize({ nodes: [...base.nodes, { id: "t1", text: big(120) }] }));
    settle();
    act(() => void vi.advanceTimersByTime(5000));
    expect(written).toEqual([]);
    expect(result.current.tooLarge).toBe(true);
    expect(result.current.docRef.current.nodes.map((n) => n.id)).toEqual(["n0", "m1"]);
    // Room is made here: now both fit, and both are saved.
    act(() => result.current.commit({ nodes: [base.nodes[0]!, { id: "m1", text: "short" }] }));
    settle();
    expect(written).toHaveLength(1);
    expect(parseLimited(written[0]!.data).nodes.map((n) => n.id)).toEqual(["n0", "t1", "m1"]);
    expect(result.current.tooLarge).toBe(false);
    unmount();
  });

  test("a canvas already too large to save keeps its work when the block changes from outside (V3)", () => {
    const limit = 200;
    const parseLimited = (s: string): Doc => (!s || s.length > limit ? { nodes: [] } : (JSON.parse(s) as Doc));
    const base = nodes(["n0", "a"]);
    const { result, written, render, unmount } = openBare(base, limit, parseLimited);
    act(() => result.current.commit({ nodes: [...base.nodes, { id: "m1", text: "y".repeat(300) }] }));
    settle();
    expect(result.current.tooLarge).toBe(true);
    render(serialize(nodes(["n0", "a"], ["t1", "theirs"])));
    act(() => void vi.advanceTimersByTime(5000));
    expect(written).toEqual([]);
    expect(result.current.docRef.current.nodes.map((n) => n.id)).toEqual(["n0", "m1"]);
    unmount();
  });

  /** A press and its release anywhere on the page, as the canvas's document hook hears them. */
  const press = (type: string, id = 1) => act(() => void document.dispatchEvent(new PointerEvent("pointerdown", { pointerId: id, pointerType: "mouse", isPrimary: true, bubbles: true })));
  const lift = (id = 1) => {
    act(() => void window.dispatchEvent(new PointerEvent("pointerup", { pointerId: id, pointerType: "mouse", isPrimary: true })));
    act(() => void vi.advanceTimersByTime(1));
  };

  test("a change from elsewhere waits for the gesture under way, then is merged with it (V11)", () => {
    const { result, saves, render, unmount } = openBare(nodes(["n0", "a"], ["n1", "b"]));
    press("mouse");
    // The gesture works from the canvas as it was at the press.
    const before = result.current.docRef.current;
    act(() => result.current.setLive({ nodes: [{ id: "n0", text: "drag1" }, before.nodes[1]!] }));
    render(serialize(nodes(["n0", "a"], ["n1", "B-theirs"])));
    // The finger holds still, well past the time a waiting change is otherwise merged in.
    act(() => void vi.advanceTimersByTime(4000));
    expect(saves()).toEqual([]);
    expect(said(serialize(result.current.docRef.current))).toEqual(["n0:drag1", "n1:b"]);
    // The next frame of the drag, still from the canvas as it was at the press, and its end.
    act(() => result.current.setLive({ nodes: [{ id: "n0", text: "drag2" }, before.nodes[1]!] }));
    lift();
    act(() => result.current.commit(result.current.docRef.current, { before }));
    settle();
    expect(said(saves().at(-1)!.data)).toEqual(["n0:drag2", "n1:B-theirs"]);
    // And the canvas's undo of the drag leaves theirs in place.
    render(saves().at(-1)!.data);
    act(() => void result.current.undo());
    settle();
    expect(said(saves().at(-1)!.data)).toEqual(["n0:a", "n1:B-theirs"]);
    unmount();
  });

  test("a press that changes nothing: what arrived during it shows on release (V11)", () => {
    const { result, written, render, unmount } = openBare(nodes(["n0", "a"]));
    press("mouse");
    render(serialize(nodes(["n0", "a"], ["n1", "theirs"])));
    expect(result.current.docRef.current.nodes).toHaveLength(1);
    lift();
    expect(said(serialize(result.current.docRef.current))).toEqual(["n0:a", "n1:theirs"]);
    expect(written).toEqual([]);
    unmount();
  });

  test("a press whose release is never heard does not hold changes back for good (V11)", () => {
    const { result, render, unmount } = openBare(nodes(["n0", "a"]));
    press("mouse");
    render(serialize(nodes(["n0", "a"], ["n1", "theirs"])));
    act(() => void vi.advanceTimersByTime(70_000));
    expect(result.current.docRef.current.nodes).toHaveLength(2);
    unmount();
  });

  test("hold and release do the same for a gesture no pointer shows (V11)", () => {
    const { result, render, unmount } = openBare(nodes(["n0", "a"]));
    act(() => result.current.hold());
    render(serialize(nodes(["n0", "a"], ["n1", "theirs"])));
    act(() => void vi.advanceTimersByTime(4000));
    expect(result.current.docRef.current.nodes).toHaveLength(1);
    act(() => result.current.release());
    expect(result.current.docRef.current.nodes).toHaveLength(2);
    unmount();
  });
});

describe("a canvas in a real note: steps that line up, and ones that do not", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    forgetCanvasSteps();
  });
  afterEach(() => vi.useRealTimers());
  const one = (text: string): Doc => ({ nodes: [{ id: "n0", text }] });
  const saidIn = (e: Editor) => parse(dataOf(e, "w")).nodes.map((n) => n.text).join("|");

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

  test("a label saved while it was typed, then finished with nothing more typed, is a step that has ended (V9)", () => {
    const e = make([p("a", "one"), block("whiteboard", "w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    const before = result.current.docRef.current;
    act(() => result.current.setLive(one("Plan")));
    act(() => void vi.advanceTimersByTime(900));
    render();
    // The edit ends with nothing typed since that save.
    act(() => result.current.commit(result.current.docRef.current, { before }));
    settle();
    render();
    expect(undoDepth(e.state)).toBe(1);
    // Ten minutes later: another change in the same canvas.
    act(() => void vi.advanceTimersByTime(600_000));
    act(() => result.current.commit({ nodes: [{ id: "n0", text: "Plan" }, { id: "n1", text: "moved" }] }));
    settle();
    render();
    expect(undoDepth(e.state)).toBe(2);
    expect(canvasLedger(e).done).toEqual(["w", "w"]);
    // One Cmd+Z in the note takes back the later change only.
    e.commands.undo();
    expect(saidIn(e)).toBe("Plan");
    unmount();
    e.destroy();
  });

  test("an edit given up after it was saved on the way leaves no step for the next change to join (V9)", () => {
    const e = make([p("a", "one"), block("whiteboard", "w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    const before = result.current.docRef.current;
    act(() => result.current.setLive(one("Pl")));
    act(() => void vi.advanceTimersByTime(900));
    render();
    // Escape: back to what it was, saved a moment later like any change being made.
    act(() => result.current.setLive(before));
    act(() => void vi.advanceTimersByTime(900));
    render();
    act(() => void vi.advanceTimersByTime(600_000));
    act(() => result.current.commit(one("Later")));
    settle();
    render();
    expect(canvasLedger(e).done).toEqual(["w", "w"]);
    e.commands.undo();
    expect(saidIn(e)).toBe("");
    expect(redoDepth(e.state)).toBe(1);
    unmount();
    e.destroy();
  });

  test("one canvas undo is one step of the note's undo, never more (V10)", () => {
    const e = make([p("a", "one"), block("whiteboard", "w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    for (const text of ["x", "xy"]) {
      act(() => result.current.commit(one(text)));
      settle();
      render();
    }
    const before = result.current.docRef.current;
    act(() => result.current.setLive(one("xyz")));
    act(() => void vi.advanceTimersByTime(900));
    render();
    act(() => result.current.commit(result.current.docRef.current, { before }));
    settle();
    render();
    act(() => result.current.commit(one("xyz!")));
    settle();
    render();
    expect(undoDepth(e.state)).toBe(4);
    act(() => void result.current.undo());
    render();
    expect(saidIn(e)).toBe("xyz");
    expect(undoDepth(e.state)).toBe(3);
    expect(redoDepth(e.state)).toBe(1);
    unmount();
    e.destroy();
  });

  test("two changes saved as one step: the canvas's undo of the second leaves the note's history where it is (V10)", () => {
    const e = make([p("a", "one"), block("whiteboard", "w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    act(() => result.current.commit(one("first")));
    settle();
    render();
    // Two changes inside one save: one step of the note's, two of the canvas's.
    act(() => result.current.commit(one("second")));
    act(() => result.current.commit(one("third")));
    settle();
    render();
    expect(undoDepth(e.state)).toBe(2);
    act(() => void result.current.undo());
    render();
    expect(saidIn(e)).toBe("second");
    // Not unwound: both steps are still the note's to undo, and nothing is waiting to be redone.
    expect(undoDepth(e.state)).toBe(2);
    expect(redoDepth(e.state)).toBe(0);
    // The note's own undo then takes that step back whole, and the one before it.
    e.commands.undo();
    expect(saidIn(e)).toBe("first");
    e.commands.undo();
    expect(saidIn(e)).toBe("");
    unmount();
    e.destroy();
  });

  test("the canvas's undo does not ask the note to scroll to its caret (V15)", () => {
    const e = make([p("a", "one"), block("whiteboard", "w", serialize(one("")))]);
    const { result, render, unmount } = open(e);
    act(() => result.current.commit(one("Plan")));
    settle();
    render();
    const scrolled: boolean[] = [];
    e.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) scrolled.push(transaction.scrolledIntoView);
    });
    act(() => void result.current.undo());
    render();
    act(() => void result.current.redo());
    expect(undoDepth(e.state)).toBe(1);
    expect(scrolled).toEqual([false, false]);
    unmount();
    e.destroy();
  });
});
