"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { nativeApp } from "@/lib/nativeApp";

/**
 * What the iPhone app's floating chrome needs to know: whether the on-screen keyboard is up, and which
 * screens want the tab bar out of the way (a note being edited, Select mode with its own bar).
 */
interface IphoneChrome {
  keyboard: boolean;
  /** Hides the tab bar while `key` asks for it (several screens can ask at once). */
  hideTabBar: (key: string, hidden: boolean) => void;
  tabBarHidden: boolean;
}

const Ctx = createContext<IphoneChrome | null>(null);

/** Whether something that raises the keyboard has focus (a field, the editor). */
function editableFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(el.type);
  return false;
}

/**
 * The keyboard: Capacitor's Keyboard plugin tells the page when it shows and hides (window events); focus on
 * a text field is the same signal a moment earlier, and the only one in a browser (the e2e tests).
 */
function useKeyboardOpen(): boolean {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState<boolean | null>(null);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setFocused(editableFocused()));
    };
    const show = () => setShown(true);
    const hide = () => setShown(false);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    window.addEventListener("keyboardWillShow", show);
    window.addEventListener("keyboardWillHide", hide);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      window.removeEventListener("keyboardWillShow", show);
      window.removeEventListener("keyboardWillHide", hide);
    };
  }, []);
  // A hardware keyboard keeps the on-screen one away: the plugin says hidden while a field has focus.
  return focused && shown !== false;
}

/** The scrolling view around a node (a note's page, a list), if any. */
function scrollerAround(node: Node | null): HTMLElement | null {
  for (let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null); el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/** Where the caret is on screen in the text being written (the editor), or null. */
function caretRect(): DOMRect | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isContentEditable) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !active.contains(sel.focusNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (rect && (rect.height || rect.top)) return rect;
  // An empty line has no box of its own: its block's.
  const block = (sel.focusNode instanceof HTMLElement ? sel.focusNode : sel.focusNode?.parentElement)?.closest("p, li, h1, h2, h3, h4, div");
  return block?.getBoundingClientRect() ?? null;
}

/**
 * Keeps the line being written in sight while the keyboard is up, as iOS does for its own text views: the
 * page scrolls inside a view (not as a page), so the web view's own avoidance doesn't reach it. The caret
 * stays above the bar of writing tools and below the top bar.
 */
function useCaretInView(keyboard: boolean) {
  useEffect(() => {
    if (!keyboard) return;
    let frame = 0;
    const keep = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = caretRect();
        if (!rect) return;
        const scroller = scrollerAround(window.getSelection()?.focusNode ?? null);
        if (!scroller) return;
        const box = scroller.getBoundingClientRect();
        // The bar of writing tools over the keyboard (in a note it may be a moment from showing: its room).
        const bar = document.querySelector<HTMLElement>("[data-iphone-keyboard-bar]")?.getBoundingClientRect();
        const screen = window.visualViewport?.height ?? window.innerHeight;
        const inNote = Boolean((document.activeElement as HTMLElement | null)?.closest(".fb-editor"));
        const barTop = bar && bar.height ? bar.top : inNote ? screen - 56 : Infinity;
        const bottom = Math.min(box.bottom, screen, barTop) - 16;
        const top = Math.max(box.top, 0) + 96;
        // At once, not smoothly: WebKit reveals the caret itself as the web view shrinks, and a smooth
        // scroll would be cut short by it.
        if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
        else if (rect.top < top && scroller.scrollTop > 0) scroller.scrollTop += rect.top - top;
      });
    };
    // Now (the keyboard came up), when the web view settles at its new height (and WebKit has done its
    // own scrolling), and as the caret moves.
    let settle = 0;
    const resized = () => {
      keep();
      window.clearTimeout(settle);
      settle = window.setTimeout(keep, 250);
    };
    resized();
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);
    document.addEventListener("selectionchange", keep);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
      document.removeEventListener("selectionchange", keep);
    };
  }, [keyboard]);
}

/** The first opaque colour on screen at a point, as [r, g, b], or null. */
function colourAt(x: number, y: number): [number, number, number] | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?/);
    if (m && (m[4] === undefined || Number(m[4]) >= 0.9)) return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

/**
 * Behind the keyboard: while it's up the web view ends at its top, and the keyboard's rounded corners show
 * what's behind the web view (iOS 26), black unless told otherwise. It's painted the colour on screen just
 * above the keyboard (the note's paper, an open sheet, the page), so what's there seems to carry on behind.
 */
function useKeyboardBackdrop(keyboard: boolean) {
  useEffect(() => {
    const app = nativeApp();
    if (!keyboard || !app?.setBackdrop) return;
    let last = "";
    let frame = 0;
    const paint = () => {
      frame = 0;
      const y = window.innerHeight - 2;
      // The middle first: what fills most of the strip above the keyboard (a note's paper, a sheet).
      const colour = colourAt(window.innerWidth / 2, y) ?? colourAt(2, y) ?? colourAt(1, 1);
      // (Only a change goes to iOS: typing changes the page all the time, its colours seldom.)
      if (!colour || colour.join() === last) return;
      last = colour.join();
      app.setBackdrop?.(...colour);
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    // When the web view has settled at its new height, again when what's on screen changes (a sheet opening
    // or closing), and as the page resizes.
    const settle = window.setTimeout(paint, 320);
    const changes = new MutationObserver(soon);
    changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "class", "style"] });
    window.addEventListener("resize", soon);
    paint();
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
      changes.disconnect();
      window.removeEventListener("resize", soon);
    };
  }, [keyboard]);
}

export function IphoneChromeProvider({ children }: { children: ReactNode }) {
  const keyboard = useKeyboardOpen();
  useCaretInView(keyboard);
  useKeyboardBackdrop(keyboard);
  const [hiders, setHiders] = useState<ReadonlySet<string>>(() => new Set());
  const hideTabBar = useCallback((key: string, hidden: boolean) => {
    setHiders((prev) => {
      if (prev.has(key) === hidden) return prev;
      const next = new Set(prev);
      if (hidden) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  // A field with focus: the bars step aside for the keyboard (and CSS knows, for toasts).
  useEffect(() => {
    const root = document.documentElement;
    if (keyboard) root.dataset.iphoneKeyboard = "";
    else delete root.dataset.iphoneKeyboard;
    return () => {
      delete root.dataset.iphoneKeyboard;
    };
  }, [keyboard]);
  const value = useMemo(() => ({ keyboard, hideTabBar, tabBarHidden: hiders.size > 0 }), [keyboard, hideTabBar, hiders]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIphoneChrome(): IphoneChrome {
  const ctx = useContext(Ctx);
  if (!ctx) return { keyboard: false, hideTabBar: () => undefined, tabBarHidden: false };
  return ctx;
}

/** Keeps the tab bar hidden while `hidden` (and while the component is on screen). */
export function useHideTabBar(key: string, hidden: boolean) {
  const { hideTabBar } = useIphoneChrome();
  useEffect(() => {
    hideTabBar(key, hidden);
    return () => hideTabBar(key, false);
  }, [key, hidden, hideTabBar]);
}

/** Asks the current screen to scroll back to its top (tapping the tab you're on, as on iOS). */
export const SCROLL_TOP_EVENT = "folevi:iphone-scroll-top";
