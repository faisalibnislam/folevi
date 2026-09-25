import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { compareRank, isValidRank, rankBetween, rankSequence } from "../src/rank";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePath = resolve(__dirname, "../fixtures/ranks.json");

const cases: [string | null, string | null][] = [
  [null, null],
  [null, "V"],
  ["V", null],
  ["V", "l"],
  ["V", "W"],
  ["0V", "1"],
  [null, "1"],
  [null, "01"],
  ["z", null],
  ["zz", null],
  ["a", "a1"],
  ["a0V", "a1"],
  ["Az", "B"],
  ["abc", "abd"],
  ["y", "z"],
];

describe("rank", () => {
  it("matches the golden fixture shared with Swift", () => {
    const actual = cases.map(([a, b]) => ({ before: a, after: b, result: rankBetween(a, b) }));
    if (process.env.UPDATE_FIXTURES) {
      writeFileSync(
        fixturePath,
        JSON.stringify(
          { $description: "rankBetween golden cases, shared with Swift RankTests.", cases: actual, sequence10: rankSequence(10) },
          null,
          2,
        ) + "\n",
      );
    }
    const golden = JSON.parse(readFileSync(fixturePath, "utf8"));
    expect(actual).toEqual(golden.cases);
    expect(rankSequence(10)).toEqual(golden.sequence10);
  });

  it("always produces a valid rank strictly between its bounds", () => {
    const rankArb = fc
      .array(fc.constantFrom(..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("")), { minLength: 1, maxLength: 6 })
      .map((c) => c.join(""))
      .filter(isValidRank);
    fc.assert(
      fc.property(rankArb, rankArb, (x, y) => {
        if (x === y) return;
        const [a, b] = x < y ? [x, y] : [y, x];
        const r = rankBetween(a, b);
        expect(isValidRank(r)).toBe(true);
        expect(compareRank(a, r)).toBe(-1);
        expect(compareRank(r, b)).toBe(-1);
      }),
      { numRuns: 2000 },
    );
  });

  it("keeps growth bounded when repeatedly inserting at the same spot", () => {
    let lo: string | null = null;
    let hi: string | null = null;
    let last = "";
    for (let i = 0; i < 200; i++) {
      last = rankBetween(lo, hi);
      if (i % 2) lo = last;
      else hi = last;
    }
    expect(last.length).toBeLessThan(80);
  });

  it("appending 1000 items stays sortable", () => {
    const ranks: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 1000; i++) {
      prev = rankBetween(prev, null);
      ranks.push(prev);
    }
    expect([...ranks].sort()).toEqual(ranks);
  });

  it("rankSequence is strictly increasing within bounds", () => {
    const seq = rankSequence(257, "B", "C");
    for (let i = 1; i < seq.length; i++) expect(seq[i - 1]! < seq[i]!).toBe(true);
    expect(seq[0]! > "B" && seq[seq.length - 1]! < "C").toBe(true);
  });

  it("rejects invalid ranks", () => {
    expect(() => rankBetween("a0", null)).toThrow();
    expect(() => rankBetween("b", "a")).toThrow();
    expect(isValidRank("")).toBe(false);
    expect(isValidRank("a!")).toBe(false);
  });
});
