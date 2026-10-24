// How a sheet moves with a finger and where it goes when let go (docs/IOS_POLISH_PLAN.md §2.4 "Sheet drag"),
// in the sheet's own terms: how much of it shows (its visible height, in points) and the detents it rests at.
// The springs and the rubber band are lib/native/physics.ts's; this file turns them into a pose (the panel's
// height and how far it's pushed down) and a destination. Pure functions, tested in test/sheet-motion.test.ts.

import { pickDetent, project, rubberBand, shouldDismiss, springAt, springDuration, type Spring } from "@/lib/native/physics";

/** How the panel is drawn: its height, and how far below its resting place it's pushed (down positive). */
export interface SheetPose {
  height: number;
  offset: number;
}

const sorted = (detents: readonly number[]) => [...detents].sort((a, b) => a - b);

/**
 * The pose for a sheet showing `visible` points (where the finger has taken it). Between detents the sheet
 * grows and shrinks with the finger 1:1, as UIKit lays a sheet out at its height; below the smallest it slides
 * down whole (on its way out); above the largest it stretches, rubber-banded.
 */
export function poseFor(visible: number, detents: readonly number[]): SheetPose {
  const d = sorted(detents);
  const min = d[0] ?? visible;
  const max = d[d.length - 1] ?? visible;
  if (visible > max) return { height: max + rubberBand(visible - max), offset: 0 };
  if (visible < min) return { height: min, offset: min - visible };
  return { height: visible, offset: 0 };
}

/** The pose while settling (a spring may pass its end a little): the same as poseFor, without the rubber band. */
export function settlePose(visible: number, detents: readonly number[]): SheetPose {
  const min = sorted(detents)[0] ?? visible;
  return visible < min ? { height: min, offset: min - visible } : { height: visible, offset: 0 };
}

/**
 * Where a sheet let go at `visible` points, moving at `velocity` points per second (up positive), goes: a
 * detent's height, or away. It goes to the detent nearest where the fling would carry it (0.2 s of its
 * velocity), and away below 30 % of its smallest detent. A fling down (faster than 800 points per second) takes
 * it to the next detent down, as iOS does (a large sheet flung down stops at medium), and away from the smallest.
 */
export function releaseTarget(visible: number, velocity: number, detents: readonly number[]): number | "dismiss" {
  const d = sorted(detents);
  const min = d[0];
  if (min === undefined) return "dismiss";
  if (velocity < -800) {
    const below = d.filter((h) => h < visible - 1);
    return below.length ? below[below.length - 1]! : "dismiss";
  }
  if (shouldDismiss(project(visible, velocity), velocity, min)) return "dismiss";
  return pickDetent(visible, velocity, d);
}

/** A spring's starting velocity for a move of `distance` points begun at `velocity` points per second (same direction positive). */
export const springStart = (velocity: number, distance: number): number => (Math.abs(distance) < 0.5 ? 0 : velocity / distance);

/**
 * A spring sampled for the Web Animations API (one keyframe a ProMotion frame, 120 a second, played linearly), so it runs on the
 * compositor even while the page is busy mounting the sheet's content: the progress at each frame from 0 to 1
 * and the duration in milliseconds. (CSS `linear()` would do the same, but iOS 17.0 and 17.1 don't have it.)
 */
export function springFrames(spring: Spring, v0 = 0, epsilon = 0.001): { progress: number[]; ms: number } {
  const duration = Math.max(1 / 60, springDuration(spring, v0, epsilon));
  const steps = Math.max(2, Math.round(duration * 120));
  const progress: number[] = [];
  for (let i = 0; i <= steps; i++) progress.push(i === steps ? 1 : springAt((i / steps) * duration, spring, v0));
  return { progress, ms: Math.round(duration * 1000) };
}

/**
 * How dark the screen behind gets for a sheet showing `visible` points: `dims[i]` at `detents[i]` (both from
 * the smallest up), in between in step with the sheet, fading to nothing as the sheet goes below its smallest.
 */
export function dimAt(visible: number, detents: readonly number[], dims: readonly number[]): number {
  const d = sorted(detents);
  if (!d.length || !dims.length) return 0;
  const dim = (i: number) => dims[Math.min(i, dims.length - 1)]!;
  if (visible <= d[0]!) return d[0]! > 0 ? Math.max(0, visible / d[0]!) * dim(0) : 0;
  for (let i = 0; i < d.length - 1; i++) {
    const lo = d[i]!;
    const hi = d[i + 1]!;
    if (visible <= hi) return dim(i) + ((visible - lo) / Math.max(1, hi - lo)) * (dim(i + 1) - dim(i));
  }
  return dim(d.length - 1);
}

/** The detent a sheet rests at when nothing moves it: its largest when expanded (or it has one), else its smallest. */
export const restingDetent = (detents: readonly number[], expanded: boolean): number => {
  const d = sorted(detents);
  return (expanded ? d[d.length - 1] : d[0]) ?? 0;
};
