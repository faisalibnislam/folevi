import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity } from "@/components/editor/plugins";
import { blocksToDoc } from "@/components/editor/convert";
import { RemoteCarets, cursorToRange, pointAt, remoteCaretsOf, selectionToCursor, setRemoteCarets, type RemoteCursor } from "@/components/editor/remoteCarets";
import { throttle } from "@/lib/throttle";

const para = (id: string, text: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: {} });
const divider = (id: string, rank: string): WireBlock => ({ id, type: "divider", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: {} });

function makeEditor(blocks: WireBlock[] = [para("b1", "Hello world", "a"), divider("d1", "b"), para("b2", "Second line", "c")]) {
  return new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockIdentity, RemoteCarets], content: blocksToDoc(blocks) });
}

/** The position of a block's start, by id. */
function startOf(editor: Editor, id: string): number {
  let at = -1;
  editor.state.doc.forEach((n, pos) => {
    if (n.attrs.id === id) at = pos;
  });
  return at;
}

const remote = (over: Partial<RemoteCursor>): RemoteCursor => ({ key: "s1", name: "Sam Rivera", color: "moss", anchor: { blockId: "b1", offset: 0 }, head: { blockId: "b1", offset: 0 }, ...over });

describe("live carets: (block id, offset) and positions", () => {
  test("a position becomes its block's id and the offset into its text, and back", () => {
    const editor = makeEditor();
    const b2 = startOf(editor, "b2");
    expect(pointAt(editor.state.doc, b2 + 1 + 6)).toEqual({ blockId: "b2", offset: 6 });
    expect(pointAt(editor.state.doc, 1)).toEqual({ blockId: "b1", offset: 0 });
    // The end of a line is its length.
    expect(pointAt(editor.state.doc, 1 + "Hello world".length)).toEqual({ blockId: "b1", offset: 11 });
    const range = cursorToRange(editor.state.doc, { anchor: { blockId: "b2", offset: 0 }, head: { blockId: "b2", offset: 6 } });
    expect(range).toEqual({ anchor: b2 + 1, head: b2 + 7, block: false });
    expect(editor.state.doc.textBetween(range!.anchor, range!.head)).toBe("Second");
    editor.destroy();
  });

  test("this editor's selection goes out as a cursor, ranges across lines included", () => {
    const editor = makeEditor();
    const b2 = startOf(editor, "b2");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, b2 + 4)));
    expect(selectionToCursor(editor.state)).toEqual({ anchor: { blockId: "b1", offset: 6 }, head: { blockId: "b2", offset: 3 } });
    // A block with no text is sent whole.
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, startOf(editor, "d1"))));
    expect(selectionToCursor(editor.state)).toEqual({ anchor: { blockId: "d1", offset: 0 }, head: { blockId: "d1", offset: 0 }, block: true });
    editor.destroy();
  });

  test("an offset past the end of the line lands at its end; a block that isn't here drops the caret", () => {
    const editor = makeEditor();
    const range = cursorToRange(editor.state.doc, { anchor: { blockId: "b1", offset: 500 }, head: { blockId: "b1", offset: 500 } });
    expect(range).toEqual({ anchor: 12, head: 12, block: false });
    expect(cursorToRange(editor.state.doc, { anchor: { blockId: "gone", offset: 0 }, head: { blockId: "b1", offset: 1 } })).toBeNull();
    // Pointing into a block without text selects it whole.
    expect(cursorToRange(editor.state.doc, { anchor: { blockId: "d1", offset: 3 }, head: { blockId: "d1", offset: 3 } })).toMatchObject({ block: true, head: startOf(editor, "d1") });
    editor.destroy();
  });

  test("carets are drawn from a meta transaction and move with edits; deleted lines take theirs away", () => {
    const editor = makeEditor();
    setRemoteCarets(editor.view, [remote({ head: { blockId: "b1", offset: 5 }, anchor: { blockId: "b1", offset: 5 } }), remote({ key: "s2", name: "Ann", color: "plum", head: { blockId: "zzz", offset: 1 } })]);
    // The one in a block that isn't here is dropped quietly.
    expect(remoteCaretsOf(editor.state)).toEqual([expect.objectContaining({ key: "s1", head: 6, anchor: 6, block: false })]);
    const caret = editor.view.dom.querySelector("[data-remote-caret]");
    expect(caret?.getAttribute("data-remote-caret")).toBe("Sam");
    expect(caret?.textContent).toBe("Sam");
    expect(editor.view.dom.classList.contains("fb-has-carets")).toBe(true);
    // Typing before it moves it along; the document isn't changed by the caret.
    editor.view.dispatch(editor.state.tr.insertText("Oh, ", 1));
    expect(remoteCaretsOf(editor.state)[0]).toMatchObject({ head: 10 });
    expect(editor.state.doc.firstChild!.textContent).toBe("Oh, Hello world");
    // A range is highlighted.
    setRemoteCarets(editor.view, [remote({ anchor: { blockId: "b2", offset: 0 }, head: { blockId: "b2", offset: 6 } })]);
    expect(editor.view.dom.querySelector(".fb-remote-range")?.textContent).toBe("Second");
    // Whole blocks: deleting the block removes the caret.
    setRemoteCarets(editor.view, [remote({ anchor: { blockId: "d1", offset: 0 }, head: { blockId: "d1", offset: 0 }, block: true })]);
    expect(editor.view.dom.querySelectorAll(".fb-remote-block")).toHaveLength(1);
    const d1 = startOf(editor, "d1");
    editor.view.dispatch(editor.state.tr.delete(d1, d1 + editor.state.doc.nodeAt(d1)!.nodeSize));
    expect(remoteCaretsOf(editor.state)).toEqual([]);
    // An empty list clears them.
    setRemoteCarets(editor.view, [remote({})]);
    setRemoteCarets(editor.view, []);
    expect(editor.view.dom.querySelector("[data-remote-caret]")).toBeNull();
    editor.destroy();
  });

  test("a caret that stays put keeps its widget (its name isn't shown again); one that moves gets a new one", () => {
    const editor = makeEditor();
    setRemoteCarets(editor.view, [remote({ head: { blockId: "b1", offset: 2 } })]);
    const first = editor.view.dom.querySelector("[data-remote-caret]");
    setRemoteCarets(editor.view, [remote({ head: { blockId: "b1", offset: 2 } })]);
    expect(editor.view.dom.querySelector("[data-remote-caret]")).toBe(first);
    setRemoteCarets(editor.view, [remote({ head: { blockId: "b1", offset: 3 } })]);
    expect(editor.view.dom.querySelector("[data-remote-caret]")).not.toBe(first);
    editor.destroy();
  });
});

describe("throttle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("sends at once, then at most once per wait with the latest value", () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const send = throttle((n: number) => sent.push(n), 250);
    send(1);
    expect(sent).toEqual([1]);
    send(2);
    send(3);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(249);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([1, 3]);
    // Quiet for longer than the wait: the next one goes at once again.
    vi.advanceTimersByTime(1000);
    send(4);
    expect(sent).toEqual([1, 3, 4]);
    // 10 calls over a second: no more than 5 sends (one per 250 ms), ending with the last value.
    for (let i = 0; i < 10; i++) {
      send(10 + i);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(250);
    expect(sent.length - 3).toBeLessThanOrEqual(5);
    expect(sent[sent.length - 1]).toBe(19);
  });

  test("cancel drops what's waiting; flush sends it now", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const send = throttle((s: string) => sent.push(s), 250);
    send("a");
    send("b");
    send.cancel();
    vi.advanceTimersByTime(500);
    expect(sent).toEqual(["a"]);
    send("c");
    send("d");
    send.flush();
    expect(sent).toEqual(["a", "c", "d"]);
  });
});
