// lib/native/lift.ts placeAroundLift: a held thing's menu goes below it, else above, else beside it, on screen
// and never over it (iPhone and iPad, portrait, landscape and Split View widths).
import { describe, expect, test } from "vitest";
import { placeAroundLift, type Box } from "@/lib/native/lift";

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });
const screen = (w: number, h: number, safeTop = 0): Box => ({ left: 8, top: 8 + safeTop, right: w - 8, bottom: h - 8 });
const overlapsBox = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function check(lift: Box, menu: { width: number; height: number }, view: Box, align: "start" | "end" = "start") {
  const p = placeAroundLift(lift, menu, view, align);
  const h = Math.min(menu.height, p.maxHeight);
  const placed = box(p.left, p.top, Math.min(menu.width, view.right - view.left), h);
  expect(placed.left).toBeGreaterThanOrEqual(view.left - 0.01);
  expect(placed.right).toBeLessThanOrEqual(view.right + 0.01);
  expect(placed.top).toBeGreaterThanOrEqual(view.top - 0.01);
  expect(placed.bottom).toBeLessThanOrEqual(view.bottom + 0.01);
  if (!p.overlaps) expect(overlapsBox(placed, lift)).toBe(false);
  return p;
}

describe("a held thing's menu", () => {
  const menu = { width: 250, height: 460 };

  test("iPhone: below a tile with room, above one near the bottom", () => {
    const view = screen(402, 874, 62);
    expect(check(box(16, 120, 148, 164), menu, view).side).toBe("below");
    expect(check(box(16, 560, 148, 164), menu, view).side).toBe("above");
  });

  test("iPhone: a tile in the middle with no whole room above or below: the roomier side, scrolling", () => {
    const view = screen(402, 874, 62);
    const p = check(box(16, 330, 148, 164), menu, view);
    expect(p.overlaps).toBe(false);
    expect(["below", "above"]).toContain(p.side);
    expect(p.maxHeight).toBeLessThan(menu.height);
  });

  test("iPad portrait and landscape: a card in the grid, the menu below, above or beside, never over it", () => {
    for (const [w, h] of [
      [1032, 1376],
      [1376, 1032],
    ] as const) {
      const view = screen(w, h, 24);
      for (const [x, y] of [
        [340, 120],
        [340, 500],
        [340, 820],
        [1032 - 300, 300],
      ] as const) {
        const p = check(box(Math.min(x, w - 260), Math.min(y, h - 330), 240, 300), menu, view);
        expect(p.overlaps).toBe(false);
      }
    }
  });

  test("iPad landscape: a tall card with no room above or below goes beside, the side with room", () => {
    const view = screen(1376, 1032, 24);
    expect(check(box(100, 250, 300, 560), menu, view).side).toBe("right");
    expect(check(box(1376 - 400, 250, 300, 560), menu, view).side).toBe("left");
  });

  test("Split View widths (a third, a half): on screen, clear of the card", () => {
    for (const w of [320, 507, 678]) {
      const view = screen(w, 1032, 24);
      for (const y of [80, 400, 700]) check(box(16, y, w - 32, 220), menu, view, "end");
    }
  });

  test("a held thing nearly the whole screen: the menu may cover it, and says so", () => {
    const view = screen(402, 874, 62);
    const p = check(box(8, 70, 386, 780), menu, view);
    expect(p.overlaps).toBe(true);
  });

  test("aligned with the leading or trailing edge when below", () => {
    const view = screen(1032, 1376, 24);
    const lift = box(600, 200, 300, 200);
    expect(check(lift, menu, view, "start").left).toBe(600);
    expect(check(lift, menu, view, "end").left).toBe(900 - 250);
  });
});
