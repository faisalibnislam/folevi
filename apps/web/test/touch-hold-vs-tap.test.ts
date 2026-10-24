// A quick tap never opens a menu on iPhone and iPad, only a still 500 ms hold does (lib/touchContextMenu.ts):
// moving, scrolling or lifting cancels it, and a hold timer that runs late (the page was busy) lets the queued
// lift of a tap arrive before it opens anything.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, LATE_MS, RECHECK_MS, holdTimerVerdict, installTouchContextMenu } from "@/lib/touchContextMenu";

describe("holdTimerVerdict", () => {
  it("fires on time, and rechecks once when the timer ran late", () => {
    expect(holdTimerVerdict(0, HOLD_MS, false)).toBe("fire");
    expect(holdTimerVerdict(0, HOLD_MS + LATE_MS, false)).toBe("fire");
    expect(holdTimerVerdict(0, HOLD_MS + LATE_MS + 1, false)).toBe("recheck");
    expect(holdTimerVerdict(0, HOLD_MS + 2000, true)).toBe("fire");
  });
});

function touch(type: string, target: Element, x = 10, y = 10) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y, target }];
  Object.defineProperty(e, "touches", { value: touches });
  target.dispatchEvent(e);
}

function pointer(type: string) {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: "touch" });
  window.dispatchEvent(e);
}

describe("installTouchContextMenu (iPhone)", () => {
  let stop: () => void;
  let card: HTMLAnchorElement;
  let menus: number;
  const onMenu = (e: Event) => {
    menus++;
    e.preventDefault();
  };
  let now = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148");
    document.body.innerHTML = '<div data-ctx-host=""><a href="/folders/1">Brainstorming</a></div>';
    card = document.querySelector("a")!;
    menus = 0;
    document.addEventListener("contextmenu", onMenu);
    stop = installTouchContextMenu();
  });
  afterEach(() => {
    stop();
    document.removeEventListener("contextmenu", onMenu);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Advances the clock and the timers together (the page isn't busy). */
  const wait = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it("never opens the menu for quick taps", () => {
    for (let i = 0; i < 20; i++) {
      touch("touchstart", card);
      wait(120 + (i % 5) * 60); // 120 to 360 ms
      touch("touchend", card);
      wait(600);
    }
    expect(menus).toBe(0);
  });

  it("opens it after a still hold of HOLD_MS", () => {
    touch("touchstart", card);
    wait(HOLD_MS - 20);
    expect(menus).toBe(0);
    wait(40);
    expect(menus).toBe(1);
    touch("touchend", card);
  });

  it("a finger that moves, a scroll, or a lift seen only as a pointer event cancels it", () => {
    touch("touchstart", card, 10, 10);
    wait(100);
    touch("touchmove", card, 40, 10);
    wait(HOLD_MS);
    touch("touchend", card);

    touch("touchstart", card);
    wait(100);
    window.dispatchEvent(new Event("scroll"));
    wait(HOLD_MS);
    touch("touchend", card);

    touch("touchstart", card);
    wait(100);
    pointer("pointerup"); // (its touchend never reached the document)
    wait(HOLD_MS);

    touch("touchstart", card);
    wait(100);
    pointer("pointercancel"); // the browser took the finger for a scroll
    wait(HOLD_MS);
    expect(menus).toBe(0);
  });

  it("a late timer lets a queued lift arrive first, and still opens for a real hold", () => {
    // The page was busy for 800 ms from the touch: the timer runs late, and the tap's lift is queued behind it.
    touch("touchstart", card);
    now += 800;
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toBe(0);
    touch("touchend", card);
    wait(RECHECK_MS + 10);
    expect(menus).toBe(0);

    // Busy too, but the finger really is still down: the menu opens once the recheck passes.
    touch("touchstart", card);
    now += 800;
    vi.advanceTimersByTime(HOLD_MS);
    expect(menus).toBe(0);
    wait(RECHECK_MS);
    expect(menus).toBe(1);
    touch("touchend", card);
  });
});
