// How a freehand stroke is stored (the 2026-11-19 canvas audit, V13): the points that carry its shape, on
// whole units, so a whiteboard holds a page of handwriting instead of a paragraph. Same stored format.
import { describe, expect, test } from "vitest";
import { LIMITS, WHITEBOARD_INK_TOLERANCE, WHITEBOARD_MAX_POINTS, distanceToSegment, inkPoints, serializeWhiteboard, whiteboardDataIssue } from "../src";

type P = [number, number];
/** Looping handwriting across the sheet, sampled as a pen does: a point every unit and a half or so, one decimal each. */
function scribble(count: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / 14;
    out.push([Math.round((40 + t * 4.2 + 14 * Math.sin(t)) * 10) / 10, Math.round((200 + 18 * Math.cos(t) + 6 * Math.sin(t / 7)) * 10) / 10]);
  }
  return out;
}
/** How far `p` is from the line drawn through `line`. */
const off = (p: P, line: P[]) => Math.min(...line.slice(1).map((b, i) => distanceToSegment(p, line[i]!, b)));

describe("the points a stroke is stored with", () => {
  test("a 3,000 point scribble is stored in a fraction of the room, and still reads as a drawing", () => {
    const drawn = scribble(3000);
    const before = serializeWhiteboard({ strokes: [{ points: drawn, color: "ink", width: 2.5 }] }).length;
    const kept = inkPoints(drawn);
    const data = serializeWhiteboard({ strokes: [{ points: kept, color: "ink", width: 2.5 }] });
    expect(whiteboardDataIssue(data)).toBeNull();
    expect(data.length).toBeLessThan(12_000);
    expect(data.length).toBeLessThan(before / 3);
    // Whole units only.
    expect(kept.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))).toBe(true);
  });

  test("every point drawn stays within a unit and a half of the stored line", () => {
    const drawn = scribble(600);
    const kept = inkPoints(drawn);
    // (The tolerance, plus half a unit each way for the rounding.)
    for (const p of drawn) expect(off(p, kept)).toBeLessThanOrEqual(WHITEBOARD_INK_TOLERANCE + 0.75);
  });

  test("a straight line is its two ends; a dot stays a dot", () => {
    const line: P[] = Array.from({ length: 200 }, (_, i) => [10 + i * 1.5, 20 + i * 0.75]);
    expect(inkPoints(line)).toEqual([[10, 20], [309, 169]]);
    expect(inkPoints([[12.4, 7.6]])).toEqual([[12, 8]]);
    expect(inkPoints([])).toEqual([]);
  });

  test("a sharp corner keeps a point close by on each side, so it is still drawn sharp", () => {
    const corner: P[] = [...Array.from({ length: 60 }, (_, i): P => [10 + i * 2, 50]), ...Array.from({ length: 60 }, (_, i): P => [128, 52 + i * 2])];
    const kept = inkPoints(corner);
    const at = kept.findIndex(([x, y]) => x === 128 && y === 50);
    expect(at).toBeGreaterThan(0);
    expect(kept[at - 1]).toEqual([124, 50]);
    expect(kept[at + 1]).toEqual([128, 54]);
    // And nothing else along the straight runs.
    expect(kept).toHaveLength(5);
  });

  test("never more points than a stroke may have", () => {
    // A zigzag whose every turn is sharp and far from the last.
    const zigzag: P[] = Array.from({ length: 3000 }, (_, i) => [i * 6, i % 2 ? 40 : 0]);
    const kept = inkPoints(zigzag);
    expect(kept.length).toBeLessThanOrEqual(WHITEBOARD_MAX_POINTS);
    expect(whiteboardDataIssue(serializeWhiteboard({ strokes: [{ points: kept, color: "ink", width: 2.5 }] }))).toBeNull();
  });

  test("a full board now holds several times the handwriting", () => {
    let strokes = 0;
    let size = serializeWhiteboard({ strokes: [] }).length;
    const one = serializeWhiteboard({ strokes: [{ points: inkPoints(scribble(60)), color: "ink", width: 2.5 }] }).length - size + 1;
    while (size + one <= LIMITS.maxWhiteboardDataLength) {
      size += one;
      strokes += 1;
    }
    // (240 strokes of 60 points filled it before.)
    expect(strokes).toBeGreaterThan(700);
  });
});
