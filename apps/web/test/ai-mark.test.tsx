// The launcher's living Foli AI mark (components/ai/AiMark.tsx): a bloom now and then, petals drifting while
// Foli AI works, a burst when an answer lands, and the still mark with reduced motion.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiMark } from "@/components/ai/AiMark";

type Call = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

let calls: Call[];
let cancelled: number;
let root: Root;
let host: HTMLElement;
let reduce = false;

beforeEach(() => {
  calls = [];
  cancelled = 0;
  reduce = false;
  Element.prototype.animate = function (keyframes, options) {
    calls.push({ el: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions });
    return { cancel: () => cancelled++ } as unknown as Animation;
  };
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const draw = (props: Parameters<typeof AiMark>[0]) => act(() => root.render(<AiMark {...props} />));

describe("AiMark", () => {
  test("draws the eight petals of the mark, still at rest", () => {
    draw({});
    expect(host.querySelectorAll("path")).toHaveLength(8);
    expect(calls).toHaveLength(0);
  });

  test("thinking: every petal drifts, for as long as it lasts", () => {
    draw({ thinking: true });
    expect(calls).toHaveLength(8);
    expect(calls.every((c) => c.options.iterations === Infinity)).toBe(true);
    draw({ thinking: false });
    expect(cancelled).toBe(8);
  });

  test("a reply: one burst per new count, none on the first draw", () => {
    draw({ replied: 0 });
    expect(calls).toHaveLength(0);
    draw({ replied: 1 });
    expect(calls).toHaveLength(8);
    expect(calls.every((c) => c.options.duration === 700 && c.options.iterations === undefined)).toBe(true);
    draw({ replied: 1 });
    expect(calls).toHaveLength(8);
  });

  test("surprises: a bloom only after a quiet spell, never while someone is typing", () => {
    vi.useFakeTimers();
    // Each chance comes after the shortest wait (90 s).
    vi.spyOn(Math, "random").mockReturnValue(0);
    draw({ surprises: true });
    // Someone types just before the first chance: no bloom then.
    vi.advanceTimersByTime(85_000);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    vi.advanceTimersByTime(5_000);
    expect(calls).toHaveLength(0);
    // Left alone, the next chance blooms (eight petals, one after another).
    vi.advanceTimersByTime(90_000);
    expect(calls).toHaveLength(8);
    expect(calls.map((c) => c.options.delay)).toEqual([0, 70, 140, 210, 280, 350, 420, 490]);
  });

  test("reduced motion: nothing moves", () => {
    reduce = true;
    vi.useFakeTimers();
    draw({ thinking: true, surprises: true });
    draw({ thinking: true, surprises: true, replied: 1 });
    vi.advanceTimersByTime(400_000);
    expect(calls).toHaveLength(0);
  });
});
