import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTouchContextMenu, isLongPress } from "@/lib/touchContextMenu";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function touch(target: Element, type: string, at: { x: number; y: number } | null) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: at ? [{ clientX: at.x, clientY: at.y }] : [] });
  target.dispatchEvent(e);
  return e;
}

describe("press and hold opens the app's menus on iPhone and iPad", () => {
  let stop: () => void = () => undefined;
  let userAgent: PropertyDescriptor | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    userAgent = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
    Object.defineProperty(window.navigator, "userAgent", { value: IPHONE, configurable: true });
    document.body.innerHTML = `<div id="card">Card</div><input id="field" />`;
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    if (userAgent) Object.defineProperty(window.navigator, "userAgent", userAgent);
    else delete (window.navigator as { userAgent?: string }).userAgent;
  });

  const menus = () => {
    const seen: MouseEvent[] = [];
    document.addEventListener("contextmenu", (e) => {
      seen.push(e);
      e.preventDefault();
    });
    return seen;
  };

  test("a held finger opens the menu where it rests, and the lift isn't a tap", () => {
    stop = installTouchContextMenu();
    const seen = menus();
    const card = document.getElementById("card")!;
    touch(card, "touchstart", { x: 40, y: 60 });
    vi.advanceTimersByTime(300);
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.target).toBe(card);
    expect([seen[0]!.clientX, seen[0]!.clientY]).toEqual([40, 60]);
    expect(isLongPress(seen[0]!)).toBe(true);
    // No text selection starts under the finger while the menu is up.
    expect(document.documentElement.style.getPropertyValue("user-select")).toBe("none");
    expect(touch(card, "touchend", null).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(100);
    expect(document.documentElement.style.getPropertyValue("user-select")).toBe("");
  });

  test("a finger that moves (a scroll or a drag), lifts early, or rests in a text field opens nothing", () => {
    stop = installTouchContextMenu();
    const seen = menus();
    const card = document.getElementById("card")!;
    touch(card, "touchstart", { x: 40, y: 60 });
    touch(card, "touchmove", { x: 40, y: 80 });
    vi.advanceTimersByTime(1000);
    touch(card, "touchstart", { x: 40, y: 60 });
    vi.advanceTimersByTime(200);
    expect(touch(card, "touchend", null).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(1000);
    touch(document.getElementById("field")!, "touchstart", { x: 10, y: 10 });
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(0);
  });

  test("elsewhere (Android, desktop) the browser sends its own right-clicks: nothing is added", () => {
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile", configurable: true });
    stop = installTouchContextMenu();
    const seen = menus();
    touch(document.getElementById("card")!, "touchstart", { x: 40, y: 60 });
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(0);
  });
});
