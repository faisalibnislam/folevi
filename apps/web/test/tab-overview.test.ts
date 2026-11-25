import { describe, expect, it } from "vitest";
import { nextTile } from "@/components/app/TabOverview";

// Show all tabs (the owner's redesign, 2026-11-25): a tab of notes side by side is two tiles wide, so the arrow
// keys move by where the tiles are, not by a fixed column count.
const tile = (x: number, y: number, w = 100) => ({ x, y, w, h: 120 });

describe("Show all tabs: arrow keys", () => {
  // Row 1: three tiles; row 2: a double-wide tile, then one; row 3: one.
  const rects = [tile(0, 0), tile(120, 0), tile(240, 0), tile(0, 150, 230), tile(240, 150), tile(0, 300)];

  it("Left and Right step through the tiles in order, stopping at the ends", () => {
    expect(nextTile(rects, 0, "ArrowLeft")).toBe(0);
    expect(nextTile(rects, 2, "ArrowRight")).toBe(3);
    expect(nextTile(rects, 5, "ArrowRight")).toBe(5);
  });

  it("Down goes to the tile below whose middle is closest", () => {
    expect(nextTile(rects, 0, "ArrowDown")).toBe(3);
    expect(nextTile(rects, 1, "ArrowDown")).toBe(3);
    expect(nextTile(rects, 2, "ArrowDown")).toBe(4);
    expect(nextTile(rects, 4, "ArrowDown")).toBe(5);
    expect(nextTile(rects, 5, "ArrowDown")).toBe(5);
  });

  it("Up goes to the tile above whose middle is closest", () => {
    expect(nextTile(rects, 3, "ArrowUp")).toBe(1);
    expect(nextTile(rects, 4, "ArrowUp")).toBe(2);
    expect(nextTile(rects, 0, "ArrowUp")).toBe(0);
  });
});
