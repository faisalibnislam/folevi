// lib/native/physics.ts: the springs, rubber band, detents and velocities of docs/IOS_POLISH_PLAN.md §2.4.
import { describe, expect, test } from "vitest";
import { SPRINGS, VelocityTracker, pastFullSwipe, pickDetent, rubberBand, shouldDismiss, springAt, springCss, springDuration } from "@/lib/native/physics";

describe("springs", () => {
  test("start at 0 and end at 1; critically damped never overshoots, an under-damped one does", () => {
    for (const s of Object.values(SPRINGS)) {
      expect(springAt(0, s)).toBe(0);
      expect(springAt(3, s)).toBeCloseTo(1, 4);
    }
    const peak = (s: { response: number; damping: number }) => Math.max(...Array.from({ length: 200 }, (_, i) => springAt(i / 200, s)));
    expect(peak(SPRINGS.push)).toBeLessThanOrEqual(1);
    expect(peak(SPRINGS.lift)).toBeGreaterThan(1.03);
  });

  test("settle in about the response, a little more for bouncier ones", () => {
    expect(springDuration(SPRINGS.push)).toBeGreaterThan(0.4);
    expect(springDuration(SPRINGS.push)).toBeLessThan(1);
    expect(springDuration(SPRINGS.sheet)).toBeLessThan(1);
  });

  test("as CSS: a linear() curve that ends at 1, with its duration", () => {
    const css = springCss(SPRINGS.sheet);
    expect(css.easing).toMatch(/^linear\(0, /);
    expect(css.easing.endsWith(", 1)")).toBe(true);
    expect(css.ms).toBe(Math.round(springDuration(SPRINGS.sheet) * 1000));
  });

  test("a fling's velocity carries it further at first", () => {
    expect(springAt(0.05, SPRINGS.swipe, 8)).toBeGreaterThan(springAt(0.05, SPRINGS.swipe, 0));
  });
});

describe("the sheet", () => {
  test("rubber band: gives less and less, never past its limit, and keeps the direction", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(50)).toBeLessThan(50);
    expect(rubberBand(1000)).toBeLessThan(120);
    expect(rubberBand(200)).toBeGreaterThan(rubberBand(100));
    expect(rubberBand(-50)).toBeCloseTo(-rubberBand(50));
    expect(rubberBand(120)).toBeCloseTo((1 - 1 / (0.55 + 1)) * 120);
  });

  test("detents: the nearest to where a fling would carry it", () => {
    const detents = [400, 780];
    expect(pickDetent(600, 0, detents)).toBe(780);
    expect(pickDetent(560, 0, detents)).toBe(400);
    expect(pickDetent(560, 1200, detents)).toBe(780);
    expect(pickDetent(700, -1000, detents)).toBe(400);
  });

  test("dismiss: below 30 % of the smallest detent, or flung down past 800 pt/s", () => {
    expect(shouldDismiss(100, 0, 400)).toBe(true);
    expect(shouldDismiss(300, 0, 400)).toBe(false);
    expect(shouldDismiss(300, -900, 400)).toBe(true);
  });
});

test("rows: the full swipe is at 60 % of the width, either way", () => {
  expect(pastFullSwipe(230, 390)).toBe(false);
  expect(pastFullSwipe(-240, 390)).toBe(true);
});

test("velocity: over the last 100 ms only", () => {
  const v = new VelocityTracker();
  v.add(0, 0, 0);
  v.add(0, 50, 50);
  v.add(0, 100, 100);
  expect(v.velocity(100).y).toBeCloseTo(1000);
  // Held still for a moment before lifting: no fling.
  expect(v.velocity(400)).toEqual({ x: 0, y: 0 });
});
