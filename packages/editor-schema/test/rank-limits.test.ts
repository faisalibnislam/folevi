// Ranks that stay inside the server's limit (validate.ts MAX_ACCEPTED_RANK, twice maxRankLength before):
// many new blocks between the same two neighbours (a big paste) are spread over the gap instead of each going
// between the last one and the next (which passed 256 characters after about 1,280 blocks, and the server
// refused the rest: "rank: invalid rank"). And a block the server refused for its rank is given a valid one
// in its place and sent again, also from Retry, without losing what it says.
import { describe, expect, it } from "vitest";
import { assignTreePositions, isValidRank, LIMITS, MAX_ACCEPTED_RANK, rankBetween, SCHEMA_VERSION, sync, validateWireBlock, type WireBlock } from "../src/index";

const block = (id: string, rank: string, text = id): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: {} });
const accepted = (rank: string) => validateWireBlock(block("A1", rank)).length === 0;

describe("ranks for many blocks at once", () => {
  it("one after the other, the old way, ranks passed the old limit after about 1,280 blocks; the server now takes a whole note's worth", () => {
    const chain = (limit: number) => {
      let prev: string | null = null;
      let n = 0;
      while ((prev = rankBetween(prev, null)).length <= limit) n++;
      return n;
    };
    const old = chain(LIMITS.maxRankLength * 2);
    expect(old).toBeGreaterThan(1_200);
    expect(old).toBeLessThan(1_400);
    // Older builds still chain ranks like this until they update: a note's most blocks now fit.
    expect(MAX_ACCEPTED_RANK).toBeGreaterThan(LIMITS.maxRankLength * 2);
    expect(chain(MAX_ACCEPTED_RANK)).toBeGreaterThan(LIMITS.maxBlocksPerDocument);
    expect(accepted("V".repeat(MAX_ACCEPTED_RANK))).toBe(true);
    expect(accepted("V".repeat(MAX_ACCEPTED_RANK + 1))).toBe(false);
  });

  it("500 new blocks between the same two neighbours: short, valid, in order, the neighbours kept", () => {
    const flat = [{ id: "first", depth: 0, rank: "V", parentId: null }, ...Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, depth: 0 })), { id: "last", depth: 0, rank: "W", parentId: null }];
    const out = assignTreePositions(flat);
    const ranks = flat.map((f) => out.get(f.id)!.rank);
    expect(out.get("first")!.rank).toBe("V");
    expect(out.get("last")!.rank).toBe("W");
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]! < ranks[i]!).toBe(true);
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThanOrEqual(4);
    expect(ranks.every((r) => isValidRank(r) && accepted(r))).toBe(true);
  });

  it("a 2,000-block paste after the last block, and into an empty note, stays well inside the limit", () => {
    const after = assignTreePositions([{ id: "only", depth: 0, rank: "V", parentId: null }, ...Array.from({ length: 2_000 }, (_, i) => ({ id: `p${i}`, depth: 0 }))]);
    const empty = assignTreePositions(Array.from({ length: 2_000 }, (_, i) => ({ id: `p${i}`, depth: 0 })));
    for (const out of [after, empty]) {
      const ranks = [...out.values()].map((v) => v.rank);
      expect(Math.max(...ranks.map((r) => r.length))).toBeLessThanOrEqual(LIMITS.maxRankLength / 8);
      expect(new Set(ranks).size).toBe(ranks.length);
      expect(ranks.every(accepted)).toBe(true);
    }
  });

  it("nested blocks and existing ranks: only the new run moves; a sibling list whose ranks would be too long is spread out again", () => {
    const out = assignTreePositions([
      { id: "a", depth: 0, rank: "F", parentId: null },
      { id: "a1", depth: 1 },
      { id: "a2", depth: 1 },
      { id: "b", depth: 0, rank: "Z", parentId: null },
    ]);
    expect(out.get("a")).toEqual({ parentId: null, rank: "F" });
    expect(out.get("b")).toEqual({ parentId: null, rank: "Z" });
    expect(out.get("a1")!.parentId).toBe("a");
    expect(out.get("a1")!.rank < out.get("a2")!.rank).toBe(true);
    // Two kept ranks already almost at the limit with no room between: everything is spread anew.
    const tight = "V".repeat(LIMITS.maxRankLength - 1) + "1";
    const squeezed = assignTreePositions([{ id: "x", depth: 0, rank: tight, parentId: null }, { id: "new", depth: 0 }, { id: "y", depth: 0, rank: tight + "1", parentId: null }]);
    const ranks = ["x", "new", "y"].map((id) => squeezed.get(id)!.rank);
    expect(ranks.every((r) => r.length <= LIMITS.maxRankLength)).toBe(true);
    expect(ranks[0]! < ranks[1]! && ranks[1]! < ranks[2]!).toBe(true);
  });
});

describe("a block refused for its rank", () => {
  const long = (base: string) => base + "z".repeat(300);

  it("is given a valid rank in its place and sent again with a new op id; its text is kept", () => {
    let s = sync.emptySyncState();
    s = sync.localUpsert(s, { opId: "o1", documentId: "d", block: block("b1", "F"), fields: ["content", "position"] });
    s = sync.localUpsert(s, { opId: "o2", documentId: "d", block: block("b2", long("G"), "Kept words"), fields: ["content", "position"] });
    s = sync.localUpsert(s, { opId: "o3", documentId: "d", block: block("b3", long("H")), fields: ["content", "position"] });
    s = sync.localUpsert(s, { opId: "o4", documentId: "d", block: block("b4", "Z"), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    s = sync.applyResults(s, [
      { opId: "o1", status: "applied", revision: 1 },
      { opId: "o2", status: "rejected", error: { code: "invalid_block", message: "rank: invalid rank" } },
      { opId: "o3", status: "rejected", error: { code: "invalid_block", message: "rank: invalid rank" } },
      { opId: "o4", status: "applied", revision: 1 },
    ]);
    expect(s.errors).toEqual([]);
    expect(sync.syncStatus(s)).toBe("saving");
    const again = s.pending.filter((p) => p.kind === "block.upsert") as Extract<sync.SyncOp, { kind: "block.upsert" }>[];
    expect(again.map((p) => [p.opId, p.block.id, p.baseRevision, p.fields])).toEqual([
      ["o2-rerank", "b2", null, ["content", "position"]],
      ["o3-rerank", "b3", null, ["content", "position"]],
    ]);
    const r2 = again[0]!.block.rank;
    const r3 = again[1]!.block.rank;
    expect("F" < r2 && r2 < r3 && r3 < "Z").toBe(true);
    expect(accepted(r2) && accepted(r3)).toBe(true);
    expect(again[0]!.block.text).toEqual([{ type: "text", text: "Kept words" }]);
    expect(s.blocks.b2!.block.rank).toBe(r2);
    // Accepted the second time: saved.
    s = sync.takeBatch(s);
    s = sync.applyResults(s, [
      { opId: "o2-rerank", status: "applied", revision: 1 },
      { opId: "o3-rerank", status: "applied", revision: 1 },
    ]);
    expect(sync.syncStatus(s)).toBe("saved");
  });

  it("isn't repaired twice: a repaired op refused again is listed, with its content kept for Retry", () => {
    let s = sync.emptySyncState();
    s = sync.localUpsert(s, { opId: "o1", documentId: "d", block: block("b1", long("G")), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    s = sync.applyResults(s, [{ opId: "o1", status: "rejected", error: { code: "invalid_block", message: "rank: invalid rank" } }]);
    s = sync.takeBatch(s);
    s = sync.applyResults(s, [{ opId: "o1-rerank", status: "rejected", error: { code: "invalid_block", message: "rank: invalid rank" } }]);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatchObject({ opId: "o1-rerank", documentId: "d", block: { id: "b1" } });
    expect(s.pending).toEqual([]);
  });

  it("Retry sends refused blocks again (re-ranked when needed), restores ones no longer held, and keeps other refusals listed", () => {
    let s = sync.emptySyncState();
    s = sync.localUpsert(s, { opId: "k", documentId: "d", block: block("keep", "M"), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    s = sync.applyResults(s, [{ opId: "k", status: "applied", revision: 3 }]);
    // Refused earlier for something else (a new block: dropped from what's held), its content in the error.
    s = sync.localUpsert(s, { opId: "x", documentId: "d", block: block("new", "N", "Typed text"), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    s = sync.applyResults(s, [{ opId: "x", status: "rejected", error: { code: "invalid_block", message: "text: too long" } }]);
    expect(s.blocks.new).toBeUndefined();
    expect(s.errors.map((e) => [e.opId, e.block?.text])).toEqual([["x", [{ type: "text", text: "Typed text" }]]]);
    // An error from an older build, without content: it stays listed (nothing to send).
    s = { ...s, errors: [...s.errors, { opId: "old", code: "invalid_block", message: "rank: invalid rank", blockType: "paragraph" }] };
    // And one refused for its rank whose rank is still too long.
    s = { ...s, errors: [...s.errors, { opId: "r", code: "invalid_block", message: "rank: invalid rank", documentId: "d", block: block("ranked", long("P"), "Pasted") }] };
    s = sync.retryRejected(s);
    expect(s.errors.map((e) => e.opId)).toEqual(["old"]);
    expect(s.blocks.new!.block.text).toEqual([{ type: "text", text: "Typed text" }]);
    const ops = s.pending as Extract<sync.SyncOp, { kind: "block.upsert" }>[];
    expect(ops.map((p) => [p.opId, p.block.id])).toEqual([
      ["x-retry", "new"],
      ["r-retry-rerank", "ranked"],
    ]);
    expect(ops[0]!.block.rank).toBe("N");
    expect(accepted(ops[1]!.block.rank) && ops[1]!.block.rank > "N").toBe(true);
    // Retrying again sends nothing twice.
    expect(sync.retryRejected(s).pending).toHaveLength(2);
  });
});
