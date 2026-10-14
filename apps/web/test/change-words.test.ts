import { describe, expect, test } from "vitest";
import { changeCounts, whoChanged } from "@/lib/history/changeWords";

describe("describing changes", () => {
  test("who changed a note", () => {
    expect(whoChanged([])).toBe("Someone");
    expect(whoChanged(["Sam"])).toBe("Sam");
    expect(whoChanged(["Sam", "Ann"])).toBe("Sam and 1 other");
    expect(whoChanged(["Sam", "Ann", "Foli AI"])).toBe("Sam and 2 others");
  });

  test("what changed, counted by line", () => {
    expect(changeCounts({ added: 1, edited: 0, removed: 0 })).toBe("1 line added");
    expect(changeCounts({ added: 2, edited: 1, removed: 1 })).toBe("2 lines added, 1 edited, 1 removed");
    expect(changeCounts({ added: 0, edited: 3, removed: 0, more: true })).toBe("3 lines edited, and more");
  });
});
