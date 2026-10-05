import { expect, test } from "vitest";
import { highlightRanges } from "../src/search";
test("highlights match curly apostrophes either way", () => {
  expect(highlightRanges("don’t stop", "don't")).toEqual([{ start: 0, end: 5 }]);
  expect(highlightRanges("don’t stop", "don’t")).toEqual([{ start: 0, end: 5 }]);
});
