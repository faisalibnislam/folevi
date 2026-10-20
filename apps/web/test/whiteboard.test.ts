// Whiteboard editing helpers (components/editor/whiteboard/ops.ts): moving, measuring and finding strokes for
// Select, its marquee and the stroke menu.
import { describe, expect, test } from "vitest";
import { strokeD, whiteboardDataIssue, serializeWhiteboard, type WhiteboardStroke } from "@folevi/editor-schema";
import { clampMove, isHighlight, strokeAt, strokeInBox, strokeKey, strokesBounds, translatePath, translateStroke } from "@/components/editor/whiteboard/ops";

const pen: WhiteboardStroke = { points: [[100, 100], [200, 150], [300, 120]], color: "ink", width: 4 };
const mark: WhiteboardStroke = { points: [[400, 300], [500, 300]], color: "yellow", width: 18, opacity: 0.4 };
const path: WhiteboardStroke = { d: "M10 20L30 40Q50 60 70 80Z", color: "red", width: 2 };

describe("whiteboard strokes", () => {
  test("moving a stroke moves every point, keeps its style, and gives it a new identity", () => {
    const moved = translateStroke(pen, 15, -5);
    expect(moved.points).toEqual([[115, 95], [215, 145], [315, 115]]);
    expect(moved.color).toBe("ink");
    expect(strokeKey(moved)).not.toBe(strokeKey(pen));
    expect(whiteboardDataIssue(serializeWhiteboard({ strokes: [pen, moved] }))).toBeNull();
  });

  test("a stored path moves its absolute pairs; relative ones stay, except an opening m", () => {
    expect(translatePath("M10 20L30 40Q50 60 70 80Z", 5, 10)).toBe("M15 30L35 50Q55 70 75 90Z");
    expect(translatePath("m10 20l5 5 5 5", 1, 2)).toBe("m11 22l5 5 5 5");
    const moved = translateStroke(path, 5, 10);
    expect(strokeD(moved)).toBe("M15 30L35 50Q55 70 75 90Z");
    expect(whiteboardDataIssue(serializeWhiteboard({ strokes: [moved] }))).toBeNull();
  });

  test("bounds include the line's width; moves stay on the sheet", () => {
    expect(strokesBounds([pen])).toEqual({ x: 98, y: 98, w: 204, h: 54 });
    expect(strokesBounds([])).toBeNull();
    const box = strokesBounds([pen])!;
    expect(clampMove(box, -500, 0, 1000, 400)).toEqual([-98, 0]);
    expect(clampMove(box, 900, 900, 1000, 400)).toEqual([698, 248]);
    expect(clampMove(box, 20, 20, 1000, 400)).toEqual([20, 20]);
    // Drawn over the edge: staying put is fine, and it can't go further out.
    expect(clampMove({ x: -5, y: 0, w: 20, h: 20 }, 0, 0, 1000, 400)).toEqual([0, 0]);
    expect(clampMove({ x: -5, y: 0, w: 20, h: 20 }, -10, 0, 1000, 400)).toEqual([0, 0]);
  });

  test("the topmost stroke near a point; the marquee picks strokes it touches", () => {
    const strokes = [pen, mark, translateStroke(pen, 0, 2)];
    expect(strokeAt(strokes, [200, 151], 6)).toBe(2);
    expect(strokeAt(strokes, [450, 305], 4)).toBe(1);
    expect(strokeAt(strokes, [800, 50], 6)).toBe(-1);
    expect(strokeInBox(pen, { x: 190, y: 140, w: 20, h: 20 })).toBe(true);
    expect(strokeInBox(mark, { x: 0, y: 0, w: 100, h: 100 })).toBe(false);
    expect(strokeInBox(path, { x: 25, y: 35, w: 10, h: 10 })).toBe(true);
    expect(isHighlight(mark)).toBe(true);
    expect(isHighlight(pen)).toBe(false);
  });
});
