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

  /** A menu as Menu.tsx draws one (role="menu" in <body>), opened by the right-click a hold sends. */
  const opensMenu = () => {
    const seen: MouseEvent[] = [];
    document.addEventListener("contextmenu", (e) => {
      seen.push(e);
      e.preventDefault();
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<button id="delete">Delete folder…</button>`;
      document.body.append(menu);
    });
    return seen;
  };
  const click = (el: Element) => {
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  test("the lift of a held finger opens neither what was held nor the menu item under it; a later tap does", async () => {
    document.body.innerHTML = `<div data-ctx-host id="tile"><a href="/folders/1" id="link">Brainstorming</a></div>`;
    stop = installTouchContextMenu();
    opensMenu();
    const link = document.getElementById("link")!;
    const opened: string[] = [];
    document.addEventListener("click", (e) => opened.push((e.target as Element).id));
    touch(link, "touchstart", { x: 40, y: 60 });
    vi.advanceTimersByTime(500);
    // What was held lifts while its menu is open.
    expect(document.getElementById("tile")!.hasAttribute("data-held-lift")).toBe(true);
    touch(link, "touchend", null);
    // WebKit's mouse press for the lift doesn't close the menu it opened.
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    link.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    // WebKit's click for the lift, on the tile or on the item under the finger: swallowed.
    expect(click(link).defaultPrevented).toBe(true);
    expect(click(document.getElementById("delete")!).defaultPrevented).toBe(true);
    expect(opened).toEqual([]);
    // A tap of its own, a moment later, chooses the item.
    vi.advanceTimersByTime(600);
    expect(click(document.getElementById("delete")!).defaultPrevented).toBe(false);
    expect(opened).toEqual(["delete"]);
    // The menu closes: the lift goes.
    document.querySelector('[role="menu"]')!.remove();
    await Promise.resolve();
    expect(document.getElementById("tile")!.hasAttribute("data-held-lift")).toBe(false);
  });

  test("pressing something tappable holds off text selection; text and notes keep theirs", () => {
    document.body.innerHTML = `<a href="/x" id="row">Templates</a><div contenteditable="true"><a href="/y" id="inside">a link in a note</a></div>`;
    stop = installTouchContextMenu();
    const root = document.documentElement.style;
    touch(document.getElementById("row")!, "touchstart", { x: 10, y: 10 });
    expect(root.getPropertyValue("user-select")).toBe("none");
    touch(document.getElementById("row")!, "touchend", null);
    vi.advanceTimersByTime(100);
    expect(root.getPropertyValue("user-select")).toBe("");
    touch(document.getElementById("inside")!, "touchstart", { x: 10, y: 10 });
    expect(root.getPropertyValue("user-select")).toBe("");
    // A scroll during the press: no menu, and selection is back.
    touch(document.getElementById("row")!, "touchstart", { x: 10, y: 10 });
    touch(document.getElementById("row")!, "touchmove", { x: 10, y: 60 });
    vi.advanceTimersByTime(1000);
    expect(root.getPropertyValue("user-select")).toBe("");
  });

  test("on Android the browser's own right-click opens the menu, and the lift after it is no tap", () => {
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile", configurable: true });
    document.body.innerHTML = `<div data-ctx-host id="tile"><a href="/folders/1" id="link">Brainstorming</a></div>`;
    stop = installTouchContextMenu();
    opensMenu();
    const link = document.getElementById("link")!;
    touch(link, "touchstart", { x: 40, y: 60 });
    link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
    expect(document.getElementById("tile")!.hasAttribute("data-held-lift")).toBe(true);
    touch(link, "touchend", null);
    expect(click(link).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(600);
    expect(click(link).defaultPrevented).toBe(false);
  });
});
