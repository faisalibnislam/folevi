import { describe, expect, test } from "vitest";
import { rankBetween } from "@folevi/editor-schema";
import { applyOrderMoves, byFolderRank, cardZone, folderSortOf, gapChangesOrder, orderMoves, reorderIds, sortFolders } from "@/lib/app/folderOrder";
import { placeFolder } from "@/lib/app/folderDrop";

describe("folderSortOf", () => {
  test("keeps Name, turns Last updated into Recent, and everything else into Manual", () => {
    expect(folderSortOf("name")).toBe("name");
    expect(folderSortOf("updated")).toBe("recent");
    expect(folderSortOf("recent")).toBe("recent");
    expect(folderSortOf("manual")).toBe("manual");
    expect(folderSortOf("count")).toBe("manual");
    expect(folderSortOf("created")).toBe("manual");
    expect(folderSortOf(null)).toBe("manual");
    expect(folderSortOf(42)).toBe("manual");
  });
});

describe("sortFolders", () => {
  const folders = [
    { id: "a", name: "beta", updatedAt: 10 },
    { id: "b", name: "Alpha", updatedAt: 30 },
    { id: "c", name: "gamma", updatedAt: 20 },
  ];
  test("Manual keeps the order given", () => {
    expect(sortFolders(folders, "manual").map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
  test("Name is A to Z, ignoring case", () => {
    expect(sortFolders(folders, "name").map((f) => f.id)).toEqual(["b", "a", "c"]);
  });
  test("Recent is the last changed first", () => {
    expect(sortFolders(folders, "recent").map((f) => f.id)).toEqual(["b", "c", "a"]);
  });
  test("never changes the list it's given", () => {
    sortFolders(folders, "name");
    expect(folders.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});

test("byFolderRank orders by rank, by plain byte order", () => {
  const r1 = rankBetween(null, null);
  const r2 = rankBetween(r1, null);
  const r3 = rankBetween(r2, null);
  expect(byFolderRank([{ id: "c", rank: r3 }, { id: "a", rank: r1 }, { id: "b", rank: r2 }]).map((f) => f.id)).toEqual(["a", "b", "c"]);
});

describe("reorderIds", () => {
  const ids = ["a", "b", "c", "d"];
  test("puts the folder in the gap counted among the others", () => {
    expect(reorderIds(ids, "a", 0)).toEqual(["a", "b", "c", "d"]);
    expect(reorderIds(ids, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(reorderIds(ids, "a", 3)).toEqual(["b", "c", "d", "a"]);
    expect(reorderIds(ids, "d", 0)).toEqual(["d", "a", "b", "c"]);
  });
  test("a folder from elsewhere joins the list", () => {
    expect(reorderIds(ids, "x", 1)).toEqual(["a", "x", "b", "c", "d"]);
  });
  test("a gap past either end is clamped", () => {
    expect(reorderIds(ids, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(reorderIds(ids, "b", -3)).toEqual(["b", "a", "c", "d"]);
  });
  test("gapChangesOrder: back in its own place changes nothing", () => {
    expect(gapChangesOrder(ids, "b", 1)).toBe(false);
    expect(gapChangesOrder(ids, "b", 2)).toBe(true);
    expect(gapChangesOrder(ids, "x", 0)).toBe(true);
  });
});

describe("orderMoves", () => {
  const cases: [string[], string[]][] = [
    [["a", "b", "c", "d"], ["a", "b", "c", "d"]],
    [["a", "b", "c", "d"], ["b", "c", "a", "d"]],
    [["a", "b", "c", "d"], ["d", "a", "b", "c"]],
    [["a", "b", "c", "d"], ["d", "c", "b", "a"]],
    [["a", "b", "c", "d", "e"], ["c", "a", "e", "b", "d"]],
  ];
  test.each(cases)("%j becomes %j", (current, target) => {
    expect(applyOrderMoves(current, orderMoves(current, target))).toEqual(target);
  });
  test("nothing to do when the order is already right", () => {
    expect(orderMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });
  test("a drag in manual order is one move", () => {
    expect(orderMoves(["a", "b", "c", "d"], ["b", "c", "a", "d"])).toEqual([{ id: "a", afterId: "c" }]);
    expect(orderMoves(["a", "b", "c", "d"], ["d", "a", "b", "c"])).toEqual([{ id: "d", afterId: null }]);
  });
  test("takes the fewest moves (the longest run in order stays)", () => {
    // Name order on screen (c, a, b) with a moved to the end: from manual a, b, c to c, b, a.
    expect(orderMoves(["a", "b", "c"], ["c", "b", "a"])).toHaveLength(2);
    expect(orderMoves(["a", "b", "c", "d", "e"], ["b", "c", "d", "e", "a"])).toEqual([{ id: "a", afterId: "e" }]);
  });
  test("a folder that wasn't in the list moves in", () => {
    const moves = orderMoves(["a", "b"], ["a", "x", "b"]);
    expect(moves).toEqual([{ id: "x", afterId: "a" }]);
  });
  test("the moves, sent through the outbox overlay, give the folders ranks in the new order", () => {
    // Manual order a, b, c, d; the page shows them by name as d, c, b, a and c is dragged to the front.
    let last: string | null = null;
    let folders = ["a", "b", "c", "d"].map((id) => ({ id, parentFolderId: null as string | null, rank: (last = rankBetween(last, null)) }));
    const target = reorderIds(["d", "c", "b", "a"], "c", 0);
    for (const m of orderMoves(["a", "b", "c", "d"], target)) folders = placeFolder(folders, m.id, null, m.afterId)!;
    expect(byFolderRank(folders).map((f) => f.id)).toEqual(target);
  });
});

test("cardZone: a card's left quarter is before it, the right quarter after, the middle inside", () => {
  expect(cardZone(105, 100, 200)).toBe("before");
  expect(cardZone(200, 100, 200)).toBe("inside");
  expect(cardZone(290, 100, 200)).toBe("after");
  expect(cardZone(10, 0, 0)).toBe("inside");
});
