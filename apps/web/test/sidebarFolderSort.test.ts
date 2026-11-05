import { describe, expect, test } from "vitest";
import { applySidebarOrder, planSidebarDrop, sidebarOrderAfterMove, sortSidebarFolders } from "@/lib/app/sidebarFolderSort";
import { resolveFolderDrop } from "@/lib/app/folderDrop";

const f = (id: string, name: string, parentFolderId: string | null = null) => ({ id, name, parentFolderId });
// In rank order (the Folders page's).
const manual = [f("a", "Zebra"), f("b", "apple"), f("c", "Mango"), f("b1", "Kiwi", "b"), f("b2", "Fig", "b")];
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);

describe("the sidebar's folder sort", () => {
  test("Manual keeps the folders' own order", () => {
    expect(ids(sortSidebarFolders(manual, "manual"))).toEqual(["a", "b", "c", "b1", "b2"]);
  });
  test("Name sorts A to Z, ignoring case, at every level", () => {
    expect(ids(sortSidebarFolders(manual, "name"))).toEqual(["b", "b2", "b1", "c", "a"]);
  });
  test("Recent puts the last changed first, unknown ones after in their manual order", () => {
    const changed = new Map([["c", 300], ["a", 100]]);
    expect(ids(sortSidebarFolders(manual, "recent", changed))).toEqual(["c", "a", "b", "b1", "b2"]);
  });
});

describe("the sidebar's own order", () => {
  test("none saved: rank order", () => {
    expect(ids(applySidebarOrder(manual, null))).toEqual(["a", "b", "c", "b1", "b2"]);
    expect(ids(applySidebarOrder(manual, []))).toEqual(["a", "b", "c", "b1", "b2"]);
  });
  test("each level sorts by its place in the list; folders it doesn't name come last, in rank order", () => {
    // "a" isn't named (a new folder): after c and b. b2 before b1 inside b. Unknown ids are ignored.
    expect(ids(applySidebarOrder(manual, ["c", "gone", "b", "b2", "b1"]))).toEqual(["c", "b", "b2", "b1", "a"]);
    const d = f("d", "New");
    expect(ids(applySidebarOrder([...manual, d], ["c", "b", "a"])).filter((x) => !x.startsWith("b"))).toEqual(["c", "a", "d"]);
  });
  test("a move gives every id, depth first, with the folder at its new spot", () => {
    expect(sidebarOrderAfterMove(manual, "c", null, null)).toEqual(["c", "a", "b", "b1", "b2"]);
    expect(sidebarOrderAfterMove(manual, "b2", "b", null)).toEqual(["a", "b", "b2", "b1", "c"]);
    expect(sidebarOrderAfterMove(manual, "a", "b", "b1")).toEqual(["b", "b1", "a", "b2", "c"]);
  });
});

describe("a drop on the sidebar's tree", () => {
  const plan = (o: { order?: string[] | null; sort?: "manual" | "name" | "recent"; id: string; target: string | null; zone: "before" | "inside" | "after" }) => {
    const order = o.order ?? null;
    const sort = o.sort ?? "manual";
    const shown = sortSidebarFolders(applySidebarOrder(manual, order), sort);
    const drop = resolveFolderDrop(shown, o.id, o.target, o.zone);
    if (!drop.ok) throw new Error(drop.problem);
    return planSidebarDrop({ rank: manual, order, shown, sort, id: o.id, place: drop, nest: o.zone === "inside" || o.target === null });
  };

  test("between two folders of its own level: the sidebar order only, rank untouched", () => {
    expect(plan({ id: "c", target: "a", zone: "before" })).toEqual({ order: ["c", "a", "b", "b1", "b2"], move: null, adopt: false });
  });
  test("onto a folder: nested for real, last by rank; no order saved stays none", () => {
    expect(plan({ id: "c", target: "b", zone: "inside" })).toEqual({ order: null, move: { parentFolderId: "b", afterFolderId: "b2" }, adopt: false });
  });
  test("onto a folder with an order saved: last among its new siblings there too", () => {
    expect(plan({ order: ["b", "b2", "b1", "a", "c"], id: "c", target: "b", zone: "inside" })).toEqual({
      order: ["b", "b2", "b1", "c", "a"],
      move: { parentFolderId: "b", afterFolderId: "b2" },
      adopt: false,
    });
  });
  test("between rows of another level: moved there for real, and placed at that spot in the sidebar", () => {
    expect(plan({ id: "a", target: "b1", zone: "after" })).toEqual({ order: ["b", "b1", "a", "b2", "c"], move: { parentFolderId: "b", afterFolderId: "b2" }, adopt: false });
  });
  test("to the top level's space: out of its parent, last", () => {
    expect(plan({ id: "b1", target: null, zone: "inside" })).toEqual({ order: null, move: { parentFolderId: null, afterFolderId: "c" }, adopt: false });
  });
  test("sorted by Name: the order shown becomes the sidebar's, never the rank", () => {
    // Shown: apple (b) [Fig b2, Kiwi b1], Mango (c), Zebra (a). Zebra goes first.
    expect(plan({ sort: "name", id: "a", target: "b", zone: "before" })).toEqual({ order: ["a", "b", "b2", "b1", "c"], move: null, adopt: true });
  });
});
