// Where each note was left in a window (lib/app/noteViewState.ts): kept per note, the newest thirty, and an address
// that names a place in the note (a block, a comment, a new note) wins over it.
import { beforeEach, describe, expect, it } from "vitest";
import { hasExplicitTarget, readNoteView, saveNoteView } from "@/lib/app/noteViewState";

const place = (at: number, scrollTop = 120) => ({ scrollTop, anchor: 12, head: 15, focused: true, at });

describe("note view state", () => {
  beforeEach(() => sessionStorage.clear());

  it("keeps each note's place", () => {
    saveNoteView("a", place(1));
    saveNoteView("b", place(2, 900));
    expect(readNoteView("a")).toEqual(place(1));
    expect(readNoteView("b")?.scrollTop).toBe(900);
    expect(readNoteView("c")).toBeNull();
  });

  it("keeps the thirty newest", () => {
    for (let i = 0; i < 35; i++) saveNoteView(`n${i}`, place(i));
    expect(readNoteView("n0")).toBeNull();
    expect(readNoteView("n4")).toBeNull();
    expect(readNoteView("n5")).not.toBeNull();
    expect(readNoteView("n34")).not.toBeNull();
  });

  it("ignores anything malformed", () => {
    sessionStorage.setItem("folevi:note-view", "{nope");
    expect(readNoteView("a")).toBeNull();
    sessionStorage.setItem("folevi:note-view", JSON.stringify({ a: { scrollTop: -1, anchor: 0, head: 0, focused: false, at: 1 }, b: { scrollTop: 5 } }));
    expect(readNoteView("a")).toBeNull();
    expect(readNoteView("b")).toBeNull();
  });

  it("an address naming a place wins", () => {
    expect(hasExplicitTarget({ hash: "#block-x", search: "" })).toBe(true);
    expect(hasExplicitTarget({ hash: "", search: "?new=1" })).toBe(true);
    expect(hasExplicitTarget({ hash: "", search: "?find=word" })).toBe(true);
    expect(hasExplicitTarget({ hash: "", search: "" })).toBe(false);
    expect(hasExplicitTarget({ hash: "", search: "?tab=2" })).toBe(false);
  });
});
