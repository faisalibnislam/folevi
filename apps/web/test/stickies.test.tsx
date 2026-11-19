// The sticky notes board's editor logic (components/editor/stickies): board operations, arranging, the
// history, the export picture, and the board's own copy of its data, which merges other people's edits
// instead of dropping them and undoes only this person's own changes.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { emptyStickies, parseStickies, serializeStickies, stickyFromIdea, stickyGroupOf, voteOnSticky, type StickiesData } from "@folevi/editor-schema";
import { addIdeas, arrangeBuckets, arrangeBy, dragOrigin, duplicateNotes, freeSpot, initials, moveItems, rectsOverlap, StickyHistory } from "@/components/editor/stickies/ops";
import { stickiesSvg, wrapText } from "@/components/editor/stickies/svg";
import { noteLabel } from "@/components/editor/stickies/Board";
import { useStickiesDoc } from "@/components/editor/stickies/useStickiesDoc";
import { offsetFrom, resetServerClock, serverNow, serverOffset } from "@/components/editor/stickies/serverClock";

const board = (): StickiesData => ({
  ...emptyStickies(),
  notes: [
    stickyFromIdea({ text: "Faster sign up", color: "pink", tags: ["ux"] }, "s1", { x: 0, y: 0 }, "alice"),
    stickyFromIdea({ text: "Dark mode" }, "s2", { x: 200, y: 0 }, "bob"),
    stickyFromIdea({ text: "Offline" }, "s3", { x: 400, y: 0 }),
  ],
});

describe("board operations", () => {
  test("new notes go where they cover nothing, in a grid, written by the person", () => {
    const b = board();
    const res = addIdeas(b, [{ text: "A" }, { text: "B" }, { text: "C" }], { x: 100, y: 80 }, "carol");
    expect(res.ids).toHaveLength(3);
    const fresh = res.board.notes.filter((n) => res.ids.includes(n.id));
    for (const n of fresh) {
      expect(n.author).toBe("carol");
      for (const old of b.notes) expect(rectsOverlap(n, old)).toBe(false);
    }
    // A free spot is the point itself when nothing is there.
    expect(freeSpot(emptyStickies(), { x: 100, y: 100 }, 168, 168)).toEqual({ x: 16, y: 16 });
  });

  test("dragging a group moves the notes in it; copies leave the votes behind", () => {
    const b = { ...board(), groups: [{ id: "g1", label: "Ideas", x: -20, y: -60, w: 420, h: 300 }] };
    const origin = dragOrigin(b, { notes: [], groups: ["g1"] });
    expect([...origin.notes.keys()].sort()).toEqual(["s1", "s2"]);
    const moved = moveItems(b, origin, 100, 50);
    expect(moved.groups[0]).toMatchObject({ x: 80, y: -10 });
    expect(moved.notes.find((n) => n.id === "s1")).toMatchObject({ x: 100, y: 50 });
    expect(moved.notes.find((n) => n.id === "s3")).toMatchObject({ x: 400, y: 0 });
    const voted = voteOnSticky(b, "s1", "alice", 1);
    const copy = duplicateNotes(voted, ["s1"], "bob");
    expect(copy.board.notes.find((n) => n.id === copy.ids[0])).toMatchObject({ text: "Faster sign up", votes: {}, author: "bob" });
  });

  test("arranging by colour, tag, author and votes makes labelled groups in a sensible order", () => {
    let b = voteOnSticky(voteOnSticky(board(), "s2", "alice", 1), "s2", "bob", 1);
    b = voteOnSticky(b, "s1", "bob", 1);
    const names = (id: string) => ({ alice: "Alice", bob: "Bob" })[id] ?? null;
    expect(arrangeBuckets(b, "color", names).map((x) => x.label)).toEqual(["Yellow", "Pink"]);
    expect(arrangeBuckets(b, "tag", names).map((x) => x.label)).toEqual(["ux", "No tag"]);
    expect(arrangeBuckets(b, "author", names).map((x) => x.label)).toEqual(["Alice", "Bob", "Unknown"]);
    expect(arrangeBuckets(b, "votes", names)).toEqual([
      { label: "2 votes", ids: ["s2"] },
      { label: "1 vote", ids: ["s1"] },
      { label: "No votes", ids: ["s3"] },
    ]);
    const arranged = arrangeBy(b, "votes", names);
    expect(stickyGroupOf(arranged.notes.find((n) => n.id === "s2")!, arranged.groups)?.label).toBe("2 votes");
  });

  test("history coalesces repeated nudges into one step", () => {
    const h = new StickyHistory();
    const a = board();
    const b1 = { ...a, voteLimit: 3 };
    const b2 = { ...a, voteLimit: 4 };
    h.push({ before: a, after: b1 }, "nudge", 1000);
    h.push({ before: b1, after: b2 }, "nudge", 1200);
    const step = h.undo()!;
    expect(step.before).toBe(a);
    expect(step.after).toBe(b2);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toEqual({ before: a, after: b2 });
  });

  test("initials and read-out labels", () => {
    expect(initials("Sam Rivera")).toBe("SR");
    expect(initials("ada")).toBe("A");
    const n = voteOnSticky(board(), "s1", "bob", 1).notes[0]!;
    expect(noteLabel(n, new Map([["alice", { name: "Alice", isYou: false }]]), "bob")).toBe("Faster sign up, pink note, by Alice, tagged ux, 1 vote, 1 yours");
  });
});

describe("the export picture", () => {
  test("nothing to draw on an empty board; text is wrapped and escaped", () => {
    expect(stickiesSvg("", 400)).toBeNull();
    const b = board();
    b.notes[0]!.text = "Fish & <chips> for the \"team\" lunch on Friday";
    const svg = stickiesSvg(serializeStickies(voteOnSticky(b, "s1", "alice", 1)), 400)!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain("Fish &amp; &lt;chips&gt;");
    expect(svg).not.toContain("<chips>");
    expect(svg).toContain('aria-label="Sticky notes, 3 notes"');
    expect(svg).toContain("#fbdde0");
    expect(wrapText("one two three four five six seven", 60, 14, 2)).toHaveLength(2);
    expect(wrapText("one two three four five six seven", 60, 14, 2)[1]!.endsWith("…")).toBe(true);
  });
});

describe("the board's copy of its data", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  type Doc = ReturnType<typeof useStickiesDoc>;
  function mount(initial: string, me: string) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const writes: string[] = [];
    let api: Doc | null = null;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    function Host({ data }: { data: string }) {
      const d = useStickiesDoc({ data, write: (s) => writes.push(s), me, blockId: null, engine: null });
      useEffect(() => {
        api = d;
      });
      return null;
    }
    const render = (data: string) => act(() => root.render(<Host data={data} />));
    render(initial);
    return { writes, render, doc: () => api!, unmount: () => act(() => root.unmount()) };
  }

  test("someone else's change arriving while this person has unsaved changes is merged, not dropped", () => {
    vi.useFakeTimers();
    const start = serializeStickies(board());
    const h = mount(start, "alice");
    // Alice recolours s2 (not saved yet: the save waits a moment).
    act(() => h.doc().commit({ ...h.doc().docRef.current, notes: h.doc().docRef.current.notes.map((n) => (n.id === "s2" ? { ...n, color: "blue" as const } : n)) }));
    // Bob's vote arrives first.
    h.render(serializeStickies(voteOnSticky(board(), "s1", "bob", 1)));
    const now = h.doc().docRef.current;
    expect(now.notes.find((n) => n.id === "s2")!.color).toBe("blue");
    expect(now.notes.find((n) => n.id === "s1")!.votes).toEqual({ bob: 1 });
    act(() => vi.advanceTimersByTime(500));
    const saved = parseStickies(h.writes.at(-1)!);
    expect(saved.notes.find((n) => n.id === "s2")!.color).toBe("blue");
    expect(saved.notes.find((n) => n.id === "s1")!.votes).toEqual({ bob: 1 });
    h.unmount();
  });

  test("undo takes back only this person's own change", () => {
    vi.useFakeTimers();
    const h = mount(serializeStickies(board()), "alice");
    act(() => h.doc().commit(voteOnSticky(h.doc().docRef.current, "s2", "alice", 1)));
    act(() => vi.advanceTimersByTime(500));
    // Bob adds a note and votes; it arrives, then Alice undoes her vote.
    const theirs = voteOnSticky({ ...parseStickies(h.writes.at(-1)!), notes: [...parseStickies(h.writes.at(-1)!).notes, stickyFromIdea({ text: "Bob's idea" }, "s9", { x: 0, y: 400 }, "bob")] }, "s1", "bob", 1);
    h.render(serializeStickies(theirs));
    act(() => void h.doc().undo());
    const now = h.doc().docRef.current;
    expect(now.notes.find((n) => n.id === "s2")!.votes).toEqual({});
    expect(now.notes.find((n) => n.id === "s1")!.votes).toEqual({ bob: 1 });
    expect(now.notes.some((n) => n.id === "s9")).toBe(true);
    h.unmount();
  });
});

describe("a board's work in progress (the 2026-11-19 canvas audit, V11 and V18)", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  type Doc = ReturnType<typeof useStickiesDoc>;
  function mount(initial: string, me: string) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const writes: { data: string; kind: string }[] = [];
    let api: Doc | null = null;
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    function Host({ data }: { data: string }) {
      const d = useStickiesDoc({ data, write: (s, how) => writes.push({ data: s, kind: how?.kind ?? "change" }), me, blockId: null, engine: null });
      useEffect(() => {
        api = d;
      });
      return null;
    }
    const render = (data: string) => act(() => root.render(<Host data={data} />));
    render(initial);
    return { writes, render, doc: () => api!, unmount: () => act(() => root.unmount()) };
  }
  const say = (b: StickiesData, id: string, text: string): StickiesData => ({ ...b, notes: b.notes.map((n) => (n.id === id ? { ...n, text } : n)) });
  const textOf = (data: string, id: string) => parseStickies(data).notes.find((n) => n.id === id)?.text;

  test("text being typed is written 800 ms after the last key, as part of the change being made", () => {
    vi.useFakeTimers();
    const h = mount(serializeStickies(board()), "alice");
    const before = h.doc().docRef.current;
    for (const text of ["A", "A long", "A long note"]) {
      act(() => h.doc().setLive(say(h.doc().docRef.current, "s3", text)));
      act(() => vi.advanceTimersByTime(300));
    }
    // Still typing: nothing yet.
    expect(h.writes).toEqual([]);
    act(() => vi.advanceTimersByTime(600));
    expect(h.writes.map((w) => [textOf(w.data, "s3"), w.kind])).toEqual([["A long note", "live"]]);
    h.render(h.writes.at(-1)!.data);
    // More typing, then the edit ends: the finished change is written as such (and joins that same step).
    act(() => h.doc().setLive(say(h.doc().docRef.current, "s3", "A long note, done")));
    act(() => h.doc().commit(h.doc().docRef.current, { before }));
    act(() => vi.advanceTimersByTime(500));
    expect(h.writes.map((w) => [textOf(w.data, "s3"), w.kind])).toEqual([
      ["A long note", "live"],
      ["A long note, done", "change"],
    ]);
    h.unmount();
  });

  test("an edit finished with nothing typed since it was last written says the change is over", () => {
    vi.useFakeTimers();
    const h = mount(serializeStickies(board()), "alice");
    const before = h.doc().docRef.current;
    act(() => h.doc().setLive(say(before, "s3", "Typed")));
    act(() => vi.advanceTimersByTime(900));
    h.render(h.writes.at(-1)!.data);
    act(() => h.doc().commit(h.doc().docRef.current, { before }));
    act(() => vi.advanceTimersByTime(500));
    expect(h.writes.map((w) => w.kind)).toEqual(["live", "end"]);
    h.unmount();
  });

  test("a drag cancelled after someone else's change puts back only what the drag moved", () => {
    vi.useFakeTimers();
    const h = mount(serializeStickies(board()), "alice");
    // The press: the view keeps the board as it was, to go back to.
    const before = h.doc().docRef.current;
    act(() => h.doc().setLive({ ...before, notes: before.notes.map((n) => (n.id === "s1" ? { ...n, x: 300 } : n)) }));
    // Bob's note arrives during the drag.
    h.render(serializeStickies({ ...board(), notes: [...board().notes, stickyFromIdea({ text: "Bob's idea" }, "s9", { x: 0, y: 400 }, "bob")] }));
    expect(h.doc().docRef.current.notes.some((n) => n.id === "s9")).toBe(true);
    // The browser takes the touch away: the view hands back the board it kept.
    act(() => h.doc().setLive(before));
    const now = h.doc().docRef.current;
    expect(now.notes.find((n) => n.id === "s1")!.x).toBe(0);
    expect(now.notes.some((n) => n.id === "s9")).toBe(true);
    h.unmount();
  });
});

describe("the timer's server clock", () => {
  afterEach(() => resetServerClock());

  test("the offset is the server's time less the middle of the round trip; a slow trip tells too little", () => {
    expect(offsetFrom(1_000_000, 1_150_100, 1_000_200)).toBe(150_000);
    expect(offsetFrom(1_000_000, 999_900 - 60_000, 1_000_000)).toBe(-60_100);
    expect(offsetFrom(1_000_000, 1_100_000, 1_010_000)).toBeNull();
    expect(offsetFrom(1_000_000, Number.NaN, 1_000_100)).toBeNull();
    expect(offsetFrom(1_000_100, 1_000_000, 1_000_000)).toBeNull();
  });

  test("server time is the device's clock plus the offset kept for the session (none until it's known)", () => {
    expect(serverOffset()).toBe(0);
    resetServerClock();
    sessionStorage.setItem("folevi:server-clock", "-90000");
    expect(serverOffset()).toBe(-90_000);
    expect(Math.abs(serverNow() - (Date.now() - 90_000))).toBeLessThan(50);
  });
});
