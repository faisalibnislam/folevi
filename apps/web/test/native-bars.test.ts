// @vitest-environment jsdom
// In the apps the page fills the screen under the native bars and the keyboard; the native frame says how
// much they cover and the page keeps what is being written clear of them (lib/native/bars.ts).
import { afterEach, describe, expect, test } from "vitest";
import { nativeBars, revealWriting, scrollToClear, setNativeBars } from "@/lib/native/bars";
import { DOCK_SCROLL_MARGIN, DOCK_SCROLL_THRESHOLD, setDockClearance } from "@/components/editor/scrollEdges";
import { visibleBottom } from "@/lib/hooks/useVisualViewport";

afterEach(() => {
  setNativeBars(0, 0);
  setDockClearance(0);
  document.body.innerHTML = "";
});

describe("the room the app's bars take", () => {
  test("is written for the stylesheets and kept for the editor's own scrolling", () => {
    setNativeBars(111, 392);
    expect(nativeBars()).toEqual({ top: 111, bottom: 392 });
    expect(document.documentElement.style.getPropertyValue("--native-inset-top")).toBe("111px");
    expect(document.documentElement.style.getPropertyValue("--native-inset-bottom")).toBe("392px");
    // The caret counts as out of view under the keyboard and under the top bar, and lands just clear of them.
    expect(DOCK_SCROLL_THRESHOLD.bottom).toBe(392);
    expect(DOCK_SCROLL_MARGIN.bottom).toBe(397);
    expect(DOCK_SCROLL_THRESHOLD.top).toBe(111);
    expect(DOCK_SCROLL_MARGIN.top).toBe(116);
  });

  test("the web's own page tools still count where they reach higher", () => {
    setNativeBars(0, 40);
    setDockClearance(96);
    expect(DOCK_SCROLL_THRESHOLD.bottom).toBe(96);
    setNativeBars(0, 300);
    expect(DOCK_SCROLL_THRESHOLD.bottom).toBe(300);
  });

  test("menus stop at the keyboard's top", () => {
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    expect(visibleBottom()).toBe(900);
    setNativeBars(100, 392);
    expect(visibleBottom()).toBe(508);
  });
});

describe("how far the page scrolls for the caret", () => {
  const box = { top: 0, bottom: 956 };
  const room = { top: 111, bottom: 392 };

  test("a caret behind the keyboard comes up to just above it", () => {
    // The keyboard's top is at 564; the caret's foot at 700 is 136 under it.
    expect(scrollToClear({ top: 680, bottom: 700 }, box, 956, room)).toBe(136 + 16);
  });
  test("a caret under the top bar comes down to just below it", () => {
    expect(scrollToClear({ top: 90, bottom: 110 }, box, 956, room)).toBe(90 - 111 - 16);
  });
  test("a caret in the clear moves nothing", () => {
    expect(scrollToClear({ top: 300, bottom: 320 }, box, 956, room)).toBe(0);
    expect(scrollToClear({ top: 540, bottom: 564 }, box, 956, room)).toBe(0);
  });
  test("a scroller that ends above the keyboard is its own limit", () => {
    expect(scrollToClear({ top: 480, bottom: 520 }, { top: 0, bottom: 500 }, 956, room)).toBe(20 + 16);
  });
});

describe("what is being written", () => {
  function page() {
    document.body.innerHTML = `<div id="scroll" style="overflow-y:auto"><input id="title"><div id="body" contenteditable="true"><p>one</p><p id="last">last line</p></div></div>`;
    const scroller = document.getElementById("scroll")!;
    Object.defineProperty(scroller, "scrollHeight", { value: 4000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 956, configurable: true });
    // (jsdom has no isContentEditable.)
    Object.defineProperty(document.getElementById("body")!, "isContentEditable", { value: true });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 956, left: 0, right: 440, width: 440, height: 956, x: 0, y: 0, toJSON: () => ({}) });
    Object.defineProperty(window, "innerHeight", { value: 956, configurable: true });
    return scroller;
  }
  // (jsdom lays nothing out: the caret's place on screen is given.)
  const caretAt = (rect: DOMRect) => {
    Object.assign(Range.prototype, { getClientRects: () => [rect], getBoundingClientRect: () => rect });
  };
  const at = (top: number, bottom: number) => ({ top, bottom, left: 20, right: 21, width: 1, height: bottom - top, x: 20, y: top, toJSON: () => ({}) }) as DOMRect;

  test("the caret is scrolled above the keyboard when it comes up", () => {
    const scroller = page();
    const body = document.getElementById("body")!;
    body.focus();
    const text = document.getElementById("last")!.firstChild!;
    getSelection()!.collapse(text, 4);
    caretAt(at(700, 720));
    setNativeBars(111, 392);
    revealWriting();
    expect(scroller.scrollTop).toBe(720 - 564 + 16);
  });

  test("a focused field (the title, a cell) is scrolled clear when the keyboard has just come up, not as the caret moves", () => {
    const scroller = page();
    const title = document.getElementById("title") as HTMLInputElement;
    title.getBoundingClientRect = () => at(600, 640);
    title.focus();
    setNativeBars(111, 392);
    revealWriting();
    expect(scroller.scrollTop).toBe(0);
    revealWriting(true);
    expect(scroller.scrollTop).toBe(640 - 564 + 16);
  });

  test("nothing moves outside the apps, or with a range selected", () => {
    const scroller = page();
    const body = document.getElementById("body")!;
    body.focus();
    const text = document.getElementById("last")!.firstChild!;
    getSelection()!.collapse(text, 4);
    caretAt(at(700, 720));
    revealWriting(true);
    expect(scroller.scrollTop).toBe(0);
    setNativeBars(111, 392);
    getSelection()!.setBaseAndExtent(text, 0, text, 4);
    revealWriting();
    expect(scroller.scrollTop).toBe(0);
  });
});
