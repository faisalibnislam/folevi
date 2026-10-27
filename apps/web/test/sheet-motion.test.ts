// The iPhone sheet's drag and release (components/iphone/sheetMotion.ts, docs/IOS_POLISH_PLAN.md §2.4): the pose
// a finger draws, where a released sheet goes, how dark the screen behind gets, and the spring's keyframes.
import { describe, expect, test } from "vitest";
import { dimAt, poseFor, releaseTarget, restingDetent, settlePose, springFrames, springStart } from "@/components/iphone/sheetMotion";
import { SPRINGS, rubberBand } from "@/lib/native/physics";

const MEDIUM = 470;
const LARGE = 790;
const BOTH = [MEDIUM, LARGE];

describe("the pose under the finger", () => {
  test("between detents the sheet grows and shrinks with the finger, 1:1", () => {
    expect(poseFor(600, BOTH)).toEqual({ height: 600, offset: 0 });
    expect(poseFor(MEDIUM, BOTH)).toEqual({ height: MEDIUM, offset: 0 });
  });

  test("below the smallest detent it slides down whole", () => {
    expect(poseFor(400, BOTH)).toEqual({ height: MEDIUM, offset: 70 });
    expect(poseFor(-10, [300])).toEqual({ height: 300, offset: 310 });
  });

  test("past the largest it stretches on the rubber band, never more than 120 points", () => {
    const p = poseFor(LARGE + 100, BOTH);
    expect(p.offset).toBe(0);
    expect(p.height).toBeCloseTo(LARGE + rubberBand(100), 6);
    expect(p.height - LARGE).toBeLessThan(100);
    expect(poseFor(LARGE + 100_000, BOTH).height - LARGE).toBeLessThan(120);
    // (1 - 1 / (x * 0.55 / d + 1)) * d with d = 120
    expect(poseFor(LARGE + 120, BOTH).height - LARGE).toBeCloseTo((1 - 1 / (0.55 + 1)) * 120, 6);
  });

  test("a settling spring may pass a detent a little, without the rubber band", () => {
    expect(settlePose(LARGE + 4, BOTH)).toEqual({ height: LARGE + 4, offset: 0 });
    expect(settlePose(MEDIUM - 3, BOTH)).toEqual({ height: MEDIUM, offset: 3 });
  });
});

describe("where a released sheet goes", () => {
  test("to the detent nearest where its fling would carry it (0.2 s of velocity)", () => {
    expect(releaseTarget(600, 0, BOTH)).toBe(MEDIUM);
    expect(releaseTarget(650, 0, BOTH)).toBe(LARGE);
    // Slow, but upward: 600 + 0.2 * 300 = 660, nearer large.
    expect(releaseTarget(600, 300, BOTH)).toBe(LARGE);
    // Downward from 700: 700 - 0.2 * 600 = 580, nearer medium.
    expect(releaseTarget(700, -600, BOTH)).toBe(MEDIUM);
  });

  test("away below 30 % of its smallest detent", () => {
    expect(releaseTarget(MEDIUM * 0.25, 0, BOTH)).toBe("dismiss");
    expect(releaseTarget(MEDIUM * 0.35, 0, BOTH)).toBe(MEDIUM);
    // The fling counts: 200 - 0.2 * 600 = 80, under 30 % of 300.
    expect(releaseTarget(200, -600, [300])).toBe("dismiss");
  });

  test("flung down faster than 800 points a second: the next detent down, then away", () => {
    expect(releaseTarget(LARGE, -1200, BOTH)).toBe(MEDIUM);
    expect(releaseTarget(MEDIUM, -900, BOTH)).toBe("dismiss");
    expect(releaseTarget(300, -801, [300])).toBe("dismiss");
    // Not quite that fast, from its only detent: it stays.
    expect(releaseTarget(300, -400, [300])).toBe(300);
  });

  test("flung up it goes up, never away", () => {
    expect(releaseTarget(MEDIUM, 2000, BOTH)).toBe(LARGE);
    expect(releaseTarget(100, 3000, [300])).toBe(300);
  });

  test("rests on its largest detent when expanded, else its smallest", () => {
    expect(restingDetent(BOTH, true)).toBe(LARGE);
    expect(restingDetent(BOTH, false)).toBe(MEDIUM);
    expect(restingDetent([300], true)).toBe(300);
  });
});

describe("the dim behind", () => {
  const dims = [0.1, 0.25];
  test("0.1 at medium, 0.25 at large, in step between", () => {
    expect(dimAt(MEDIUM, BOTH, dims)).toBeCloseTo(0.1);
    expect(dimAt(LARGE, BOTH, dims)).toBeCloseTo(0.25);
    expect(dimAt((MEDIUM + LARGE) / 2, BOTH, dims)).toBeCloseTo(0.175);
    expect(dimAt(LARGE + 40, BOTH, dims)).toBeCloseTo(0.25);
  });
  test("fading out as the sheet goes below its smallest detent", () => {
    expect(dimAt(MEDIUM / 2, BOTH, dims)).toBeCloseTo(0.05);
    expect(dimAt(0, [300], [0.25])).toBe(0);
    expect(dimAt(-20, [300], [0.25])).toBe(0);
  });
});

describe("the spring as keyframes", () => {
  test("one a ProMotion frame (120 a second), from 0 to exactly 1, for as long as the spring takes to settle", () => {
    const { progress, ms } = springFrames(SPRINGS.sheet);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(ms).toBeGreaterThan(300);
    expect(ms).toBeLessThan(1200);
    expect(progress.length).toBeCloseTo(Math.round((ms / 1000) * 120) + 1, -1);
    // Damping 0.92 passes its end only a hair.
    expect(Math.max(...progress)).toBeLessThan(1.01);
  });

  test("a finger's fling starts the spring moving", () => {
    const still = springFrames(SPRINGS.sheet).progress;
    const flung = springFrames(SPRINGS.sheet, springStart(1500, 300)).progress;
    expect(flung[2]!).toBeGreaterThan(still[2]!);
    expect(springStart(1500, 300)).toBe(5);
    expect(springStart(1500, 0.2)).toBe(0);
  });
});
