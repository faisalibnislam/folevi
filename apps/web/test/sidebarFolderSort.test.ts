import { describe, expect, test } from "vitest";
import { adoptMoves, sortSidebarFolders } from "@/lib/app/sidebarFolderSort";

const f = (id: string, name: string, parentFolderId: string | null = null) => ({ id, name, parentFolderId });
const manual = [f("a", "Zebra"), f("b", "apple"), f("c", "Mango"), f("b1", "Kiwi", "b"), f("b2", "Fig", "b")];

describe("the sidebar's folder sort", () => {
  test("Manual keeps the folders' own order", () => {
    expect(sortSidebarFolders(manual, "manual").map((x) => x.id)).toEqual(["a", "b", "c", "b1", "b2"]);
  });
  test("Name sorts A to Z, ignoring case, at every level", () => {
    expect(sortSidebarFolders(manual, "name").map((x) => x.id)).toEqual(["b", "b2", "b1", "c", "a"]);
  });
  test("Recent puts the last changed first, unknown ones after in their manual order", () => {
    const changed = new Map([["c", 300], ["a", 100]]);
    expect(sortSidebarFolders(manual, "recent", changed).map((x) => x.id)).toEqual(["c", "a", "b", "b1", "b2"]);
  });
  test("adopting an order moves only the levels that differ", () => {
    const shown = sortSidebarFolders(manual, "name");
    expect(adoptMoves(manual, shown)).toEqual([
      { id: "b", parentFolderId: null, afterFolderId: null },
      { id: "c", parentFolderId: null, afterFolderId: "b" },
      { id: "a", parentFolderId: null, afterFolderId: "c" },
      { id: "b2", parentFolderId: "b", afterFolderId: null },
      { id: "b1", parentFolderId: "b", afterFolderId: "b2" },
    ]);
    expect(adoptMoves(manual, manual)).toEqual([]);
  });
});
