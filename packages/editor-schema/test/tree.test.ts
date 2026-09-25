import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { assignTreePositions, checkTreeInvariants, flattenTree, rankForPosition, descendantIds, type TreeNodeLike } from "../src";

function node(id: string, parentId: string | null, rank: string): TreeNodeLike {
  return { id, parentId, rank };
}

describe("tree", () => {
  it("flattens in document order with depth", () => {
    const blocks = [node("b", null, "l"), node("a", null, "V"), node("a1", "a", "V"), node("a2", "a", "l"), node("a1x", "a1", "V")];
    expect(flattenTree(blocks).map((e) => `${e.block.id}:${e.depth}`)).toEqual(["a:0", "a1:1", "a1x:2", "a2:1", "b:0"]);
    expect(descendantIds(blocks, "a")).toEqual(["a1", "a1x", "a2"]);
  });

  it("surfaces orphans and cycles instead of hiding content", () => {
    const blocks = [node("a", "missing", "V"), node("x", "y", "V"), node("y", "x", "l")];
    const flat = flattenTree(blocks).map((e) => e.block.id);
    expect(flat.sort()).toEqual(["a", "x", "y"]);
    const issues = checkTreeInvariants(blocks).map((i) => i.code);
    expect(issues).toContain("missing_parent");
    expect(issues).toContain("cycle");
  });

  it("rankForPosition places blocks between neighbours", () => {
    const blocks = [node("a", null, "V"), node("b", null, "l")];
    const r = rankForPosition(blocks, null, "a");
    expect(r > "V" && r < "l").toBe(true);
    expect(rankForPosition(blocks, null, null) < "V").toBe(true);
    expect(rankForPosition(blocks, null, "b") > "l").toBe(true);
  });

  it("assignTreePositions keeps stable ranks and preserves order (property)", () => {
    const opArb = fc.array(fc.tuple(fc.nat(30), fc.nat(3)), { minLength: 1, maxLength: 40 });
    fc.assert(
      fc.property(opArb, (ops) => {
        // Build a flat list with arbitrary depths, then check the resulting tree flattens back to it.
        const flat: { id: string; depth: number; rank?: string; parentId?: string | null }[] = [];
        ops.forEach(([, d], i) => {
          const prevDepth = flat.length ? flat[flat.length - 1]!.depth : -1;
          flat.push({ id: `n${i}`, depth: Math.min(d, prevDepth + 1) });
        });
        const assigned = assignTreePositions(flat);
        const tree = flat.map((f) => ({ id: f.id, ...assigned.get(f.id)! }));
        expect(checkTreeInvariants(tree)).toEqual([]);
        const back = flattenTree(tree);
        expect(back.map((e) => e.block.id)).toEqual(flat.map((f) => f.id));
        expect(back.map((e) => e.depth)).toEqual(flat.map((f) => f.depth));

        // Re-run with the assigned ranks after moving one item: untouched siblings keep their ranks.
        const withRanks = flat.map((f) => ({ ...f, rank: assigned.get(f.id)!.rank, parentId: assigned.get(f.id)!.parentId }));
        const again = assignTreePositions(withRanks);
        for (const f of withRanks) expect(again.get(f.id)!.rank).toBe(f.rank);
      }),
      { numRuns: 300 },
    );
  });

  it("assignTreePositions only re-ranks the moved block on a reorder", () => {
    const flat = [
      { id: "a", depth: 0, rank: "1", parentId: null },
      { id: "b", depth: 0, rank: "2", parentId: null },
      { id: "c", depth: 0, rank: "3", parentId: null },
      { id: "d", depth: 0, rank: "4", parentId: null },
    ];
    const moved = [flat[0]!, flat[3]!, flat[1]!, flat[2]!];
    const r = assignTreePositions(moved);
    const changed = moved.filter((f) => r.get(f.id)!.rank !== f.rank).map((f) => f.id);
    expect(changed).toEqual(["d"]);
  });
});
