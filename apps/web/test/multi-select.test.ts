import { describe, expect, test } from "vitest";
import { NO_SELECTION, bulkActions, clickIntent, planFolderMoves, selectAll, selectRange, selectedInOrder, selectionNoun, toggleSelection, type SelectedItem } from "@/lib/app/multiSelect";

const order = ["f1", "f2", "n1", "n2", "n3", "n4"];
const ids = (s: { picked: ReadonlySet<string> }) => selectedInOrder({ picked: s.picked, anchor: null }, order);

describe("multi-select: toggle, range, select all, clear", () => {
  test("⌘-click adds an item, a second ⌘-click takes it out; the anchor follows the click", () => {
    let s = toggleSelection(NO_SELECTION, "n2");
    expect(ids(s)).toEqual(["n2"]);
    s = toggleSelection(s, "f1");
    expect(ids(s)).toEqual(["f1", "n2"]);
    expect(s.anchor).toBe("f1");
    s = toggleSelection(s, "n2");
    expect(ids(s)).toEqual(["f1"]);
    expect(s.anchor).toBe("n2");
  });

  test("⇧-click selects the run from the anchor, either way, folders and notes alike", () => {
    let s = toggleSelection(NO_SELECTION, "f2");
    s = selectRange(s, order, "n3");
    expect(ids(s)).toEqual(["f2", "n1", "n2", "n3"]);
    s = toggleSelection(NO_SELECTION, "n4");
    s = selectRange(s, order, "n1");
    expect(ids(s)).toEqual(["n1", "n2", "n3", "n4"]);
  });

  test("a range adds to what was picked, and keeps its anchor", () => {
    let s = toggleSelection(NO_SELECTION, "f1");
    s = toggleSelection(s, "n3");
    s = selectRange(s, order, "n4");
    expect(ids(s)).toEqual(["f1", "n3", "n4"]);
    expect(s.anchor).toBe("n3");
  });

  test("⇧-click with nothing picked selects that item and makes it the anchor", () => {
    const s = selectRange(NO_SELECTION, order, "n2");
    expect(ids(s)).toEqual(["n2"]);
    expect(s.anchor).toBe("n2");
    // An item not shown changes nothing.
    expect(selectRange(s, order, "gone")).toBe(s);
  });

  test("⌘A selects everything shown; clearing is the empty selection", () => {
    expect(ids(selectAll(order))).toEqual(order);
    expect(ids(NO_SELECTION)).toEqual([]);
  });

  test("items no longer shown drop out of the selection", () => {
    const s = selectAll(order);
    expect(selectedInOrder(s, ["n1", "n9"])).toEqual(["n1"]);
  });
});

describe("multi-select: which clicks select", () => {
  const click = (o: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, ...o });
  test("a plain click opens", () => {
    expect(clickIntent(click({}), true)).toBeNull();
    expect(clickIntent(click({}), false)).toBeNull();
  });
  test("⌘ on the Mac, Ctrl elsewhere, toggles; ⇧ selects a range", () => {
    expect(clickIntent(click({ metaKey: true }), true)).toBe("toggle");
    expect(clickIntent(click({ ctrlKey: true }), true)).toBeNull();
    expect(clickIntent(click({ ctrlKey: true }), false)).toBe("toggle");
    expect(clickIntent(click({ metaKey: true }), false)).toBeNull();
    expect(clickIntent(click({ shiftKey: true }), true)).toBe("range");
  });
  test("a middle-click (a background tab) and ⌥-click aren't selection", () => {
    expect(clickIntent(click({ button: 1, metaKey: true }), true)).toBeNull();
    expect(clickIntent(click({ altKey: true, metaKey: true }), true)).toBeNull();
  });
});

describe("multi-select: mixed selections offer what every item can take", () => {
  const note = (o: Partial<SelectedItem> = {}): SelectedItem => ({ kind: "note", ...o });
  const folder: SelectedItem = { kind: "folder" };
  const ctx = { canEdit: true, canCopy: true, tabs: true };

  test("notes: tabs, move, copy, bookmark, tags, archive, trash", () => {
    expect(bulkActions([note(), note()], ctx)).toEqual(["openTabs", "move", "copy", "bookmark", "tags", "archive", "trash"]);
  });
  test("folders: tabs, move, colour, delete", () => {
    expect(bulkActions([folder, folder], ctx)).toEqual(["openTabs", "move", "color", "deleteFolders"]);
  });
  test("folders and notes together: only tabs and move", () => {
    expect(bulkActions([folder, note()], ctx)).toEqual(["openTabs", "move"]);
  });
  test("bookmark and archive flip when every note already has them", () => {
    expect(bulkActions([note({ starred: true, archived: true }), note({ starred: true, archived: true })], ctx)).toEqual(["openTabs", "move", "copy", "unbookmark", "tags", "unarchive", "trash"]);
    expect(bulkActions([note({ starred: true }), note()], ctx)).toContain("bookmark");
  });
  test("a template in the selection can't be moved", () => {
    expect(bulkActions([note({ template: true }), note()], ctx)).not.toContain("move");
  });
  test("without editing rights folders can't be moved, coloured or deleted", () => {
    expect(bulkActions([folder], { canEdit: false, tabs: true })).toEqual(["openTabs"]);
    expect(bulkActions([folder, note()], { canEdit: false, tabs: true })).toEqual(["openTabs"]);
  });
  test("no tab strip (the phone layout): no Open in new tabs; no Copy to without somewhere to copy", () => {
    expect(bulkActions([note()], { canEdit: true })).toEqual(["move", "bookmark", "tags", "archive", "trash"]);
  });
  test("Trash: restore or delete for good", () => {
    expect(bulkActions([note(), note()], { ...ctx, trash: true })).toEqual(["restore", "deleteForever"]);
  });
  test("nothing selected, nothing offered", () => {
    expect(bulkActions([], ctx)).toEqual([]);
  });
  test("moving several folders: those already there stay, a folder can't go into itself, a selected folder's subfolder goes with it", () => {
    const tree = [
      { id: "a", parentFolderId: null },
      { id: "a1", parentFolderId: "a" },
      { id: "b", parentFolderId: null },
      { id: "c", parentFolderId: "t" },
      { id: "t", parentFolderId: null },
    ];
    expect(planFolderMoves(tree, ["a", "a1", "b", "c"], "t")).toEqual({ move: ["a", "b"], unchanged: ["c"], refused: [] });
    expect(planFolderMoves(tree, ["a", "b"], "a1")).toEqual({ move: ["b"], unchanged: [], refused: [{ id: "a", problem: "descendant" }] });
    expect(planFolderMoves(tree, ["a1", "c"], null)).toEqual({ move: ["a1", "c"], unchanged: [], refused: [] });
  });
  test("what's selected, in words", () => {
    expect(selectionNoun(1, 0)).toBe("1 note");
    expect(selectionNoun(0, 2)).toBe("2 folders");
    expect(selectionNoun(3, 1)).toBe("1 folder and 3 notes");
  });
});
