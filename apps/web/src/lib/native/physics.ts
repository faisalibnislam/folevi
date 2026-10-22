// The motion maths of the iPhone and iPad layout (docs/IOS_POLISH_PLAN.md §2.4), in one place for every screen
// that moves with a finger: springs as UIKit describes them (response and damping ratio), the sheet's rubber
// band, picking a detent from where a drag let go and how fast, the full-swipe point of a row, and the release
// velocity of a drag. Pure functions (no DOM), so they're tested on their own (test/native-physics.test.ts).

/** A spring as UIKit's `UISpringTimingParameters(dampingRatio:response:)`: seconds per cycle, and 1 = no overshoot. */
export interface Spring {
  response: number;
  damping: number;
}

/** The springs §2.4 names. */
export const SPRINGS = {
  /** A screen pushed or popped (critically damped). */
  push: { response: 0.42, damping: 1 },
  /** A sheet coming up, or settling on a detent. */
  sheet: { response: 0.4, damping: 0.92 },
  /** A menu growing out of what opened it. */
  menu: { response: 0.32, damping: 0.82 },
  /** What a long press lifted (the web's own lift; the app's preview uses the same numbers). */
  lift: { response: 0.25, damping: 0.7 },
  /** A swiped row settling open or shut. */
  swipe: { response: 0.3, damping: 0.86 },
} as const satisfies Record<string, Spring>;

/** Where a spring is after `t` seconds, moving from 0 to 1 with a starting velocity `v0` (in units of the distance per second). */
export function springAt(t: number, { response, damping }: Spring, v0 = 0): number {
  if (t <= 0) return 0;
  const w0 = (2 * Math.PI) / response;
  const x0 = -1;
  if (damping < 1) {
    const wd = w0 * Math.sqrt(1 - damping * damping);
    const a = x0;
    const b = (v0 + damping * w0 * x0) / wd;
    return 1 + Math.exp(-damping * w0 * t) * (a * Math.cos(wd * t) + b * Math.sin(wd * t));
  }
  // Critically (or over-) damped: treated as critical, as UIKit does for a ratio of 1.
  return 1 + Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
}

/** How long until the spring stays within `epsilon` of its end (seconds, to the nearest frame). */
export function springDuration(spring: Spring, v0 = 0, epsilon = 0.001): number {
  const frame = 1 / 120;
  let settledSince = -1;
  for (let t = 0; t < 4; t += frame) {
    if (Math.abs(springAt(t, spring, v0) - 1) < epsilon) {
      if (settledSince < 0) settledSince = t;
      // Settled for a tenth of a second: it's there.
      if (t - settledSince > 0.1) return Math.round(settledSince * 1000) / 1000;
    } else settledSince = -1;
  }
  return 4;
}

/**
 * The spring as a CSS timing function (`linear()`, Safari 17.2 and later) with its duration in milliseconds,
 * so a transition moves exactly as the spring does: `transition: transform ${ms}ms ${easing}`.
 */
export function springCss(spring: Spring, v0 = 0): { easing: string; ms: number } {
  const duration = springDuration(spring, v0);
  const steps = Math.min(60, Math.max(12, Math.round(duration * 50)));
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    const y = i === steps ? 1 : springAt(t, spring, v0);
    points.push(String(Math.round(y * 10000) / 10000));
  }
  return { easing: `linear(${points.join(", ")})`, ms: Math.round(duration * 1000) };
}

/**
 * The rubber band past an edge (a sheet pulled above its top detent): `overshoot` points of finger give
 * this many points of movement, never more than `limit`. (1 - 1 / (x * c / d + 1)) * d, §2.4.
 */
export function rubberBand(overshoot: number, limit = 120, coefficient = 0.55): number {
  if (overshoot === 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const x = Math.abs(overshoot);
  return sign * (1 - 1 / ((x * coefficient) / limit + 1)) * limit;
}

/** Where a fling would end: the position plus the velocity over `projection` seconds (UIKit's 0.2 s). */
export const project = (position: number, velocity: number, projection = 0.2): number => position + velocity * projection;

/**
 * The detent a released sheet goes to: the one nearest where the fling would carry it. `position` and the
 * detents are the sheet's visible height in points; `velocity` is in points per second, up positive.
 */
export function pickDetent(position: number, velocity: number, detents: readonly number[]): number {
  if (!detents.length) return position;
  const target = project(position, velocity);
  let best = detents[0]!;
  for (const d of detents) if (Math.abs(d - target) < Math.abs(best - target)) best = d;
  return best;
}

/**
 * Whether a released sheet goes away: below 30 % of its smallest detent's height, or flung down faster than
 * 800 points per second (`velocity` up positive, as pickDetent).
 */
export function shouldDismiss(position: number, velocity: number, smallestDetent: number): boolean {
  return velocity < -800 || position < smallestDetent * 0.3;
}

/** Whether a row swiped `offset` points (either way) of its `width` is past the full swipe (60 %). */
export const pastFullSwipe = (offset: number, width: number): boolean => width > 0 && Math.abs(offset) >= width * 0.6;

/**
 * The velocity of a finger from its last moves (points per second), as UIKit's pan gesture reports it at
 * release: over the last 100 ms, so a finger that stopped before lifting has no fling.
 */
export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = [];

  add(x: number, y: number, t: number = typeof performance !== "undefined" ? performance.now() : Date.now()): void {
    this.samples.push({ t, x, y });
    const since = t - 100;
    while (this.samples.length > 2 && this.samples[0]!.t < since) this.samples.shift();
  }

  /** Points per second, { x, y } (y down positive, as the screen). */
  velocity(now: number = typeof performance !== "undefined" ? performance.now() : Date.now()): { x: number; y: number } {
    const recent = this.samples.filter((s) => now - s.t <= 100);
    if (recent.length < 2) return { x: 0, y: 0 };
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  reset(): void {
    this.samples = [];
  }
}

/** The release velocity as a spring's starting velocity: points per second over the distance left to go. */
export const relativeVelocity = (velocity: number, distance: number): number => (distance === 0 ? 0 : velocity / distance);

/** Reduce Motion: every spring becomes a 150 ms cross-fade (§2.4). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
