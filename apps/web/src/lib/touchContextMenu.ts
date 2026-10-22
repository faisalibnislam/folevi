// Press and hold opens Folevi's own menus on iPhone and iPad, as right-click does elsewhere. Safari on iOS
// never fires `contextmenu` for a long press (Android does), so a held touch sends one: everything that
// listens for right-clicks (the editor, note cards, tabs, AppContextMenu) works unchanged.
//
// On every phone and tablet (Android's browser does send its own right-click) a press on something tappable is
// also kept tidy: iOS doesn't start selecting the words next to it, what was held lifts while its menu is open
// (and is felt), the lift of the finger doesn't also open what was held or tap the menu item under it, and
// what opened the menu doesn't keep a "…" showing once it closes.

import { haptic } from "./nativeApp";

/** How long a finger rests before the menu opens; just under iOS's own text selection, so the menu wins. */
const HOLD_MS = 450;
/** A finger that moves further than this is scrolling or dragging, not holding. */
const SLOP = 10;

const fromHold = new WeakSet<Event>();

/** Tappable things: pressing one mustn't start iOS's text selection on the words around it. */
const PRESSABLE = "[data-ctx-host], [data-lift], a[href], button, [role=button], [role=link], [role=menuitem], summary, label";
/** Where text is written: selection there is the person's (iOS's loupe, select, paste). */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable=false])";
/** What lifts while a held finger's menu is open: a card or row with its own menu first, else the link or button. */
const liftable = (target: Element) => target.closest<HTMLElement>("[data-ctx-host], [data-lift]") ?? target.closest<HTMLElement>("a[href], button, [role=button], li");
/** A click this soon after a held finger lifts belongs to the hold (WebKit can send one), not to a new tap. */
const AFTER_HOLD_MS = 450;
/** Marks what a held finger lifted (globals.css draws the lift). */
export const LIFT_ATTR = "data-held-lift";

/**
 * Sent to what was held when, with its menu open, the finger moves on instead of lifting: as on iOS, the
 * menu gives way and the thing itself can be moved (a block in a note). `detail` has where the finger
 * started and where it is; a listener that takes it over calls preventDefault().
 */
export const HOLD_MOVE_EVENT = "folevi:hold-move";
export type HoldMoveDetail = { startX: number; startY: number; x: number; y: number };

/** The view that scrolls around an element (what a held finger mustn't scroll). */
function scrollerOf(el: Element): HTMLElement | null {
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
  }
  return null;
}

/** Whether a `contextmenu` event came from pressing and holding (no mouse: menus shouldn't raise the keyboard). */
export function isLongPress(e: Event): boolean {
  return fromHold.has(e);
}

/** iOS and iPadOS (which reports itself as a Mac with a touch screen). */
function needsLongPress(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Android phones and tablets: the browser sends its own right-click for a long press. */
function androidTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent);
}

/**
 * The tidying every touch device gets around a long press (see the top): text selection held off while a
 * tappable thing is pressed, the lift, and the clicks that follow a hold swallowed. `held()` says a menu
 * opened by holding is up with the finger still down.
 */
function pressGuard(root: HTMLElement) {
  let lifted: HTMLElement | null = null;
  let watcher: MutationObserver | null = null;
  let swallowUntil = 0;
  let pressing = false;
  const selection = (on: boolean) => {
    root.style.setProperty("-webkit-user-select", on ? "none" : "");
    root.style.setProperty("user-select", on ? "none" : "");
  };
  const unlift = () => {
    watcher?.disconnect();
    watcher = null;
    if (!lifted) return;
    lifted.removeAttribute(LIFT_ATTR);
    lifted = null;
    // The menu's button got focus back when the menu closed: on a touch screen that leaves its "…" showing.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.getAttribute("aria-haspopup") === "menu" && active.closest("[data-ctx-host]")) active.blur();
  };
  return {
    /** A finger came down on `target`. */
    press(target: Element) {
      unlift();
      pressing = !!target.closest(PRESSABLE) && !target.closest(EDITABLE);
      if (pressing) selection(true);
    },
    /** The press ended without a menu (lifted early, scrolled, moved). */
    release() {
      if (!pressing) return;
      pressing = false;
      setTimeout(() => selection(false), 50);
    },
    /**
     * Just before the menu is asked for: what will lift is marked already, so a menu placed next to it
     * (components/ui/Menu.tsx) goes beside the lifted card instead of over it. `drop()` if nothing opened.
     */
    prelift(target: Element) {
      unlift();
      const el = liftable(target);
      if (!el) return;
      lifted = el;
      el.setAttribute(LIFT_ATTR, "");
    },
    drop: () => unlift(),
    /** A menu opened for `target`: it lifts (until the menu closes) and is felt. */
    opened(target: Element) {
      const el = liftable(target);
      if (lifted !== el) unlift();
      haptic("medium");
      if (!el) return;
      lifted = el;
      el.setAttribute(LIFT_ATTR, "");
      watcher = new MutationObserver(() => {
        if (!document.querySelector('[role="menu"]')) unlift();
      });
      watcher.observe(document.body, { childList: true, subtree: true });
      // A hold that opened something other than a menu (a sheet, a drag): the lift goes with the finger.
      setTimeout(() => {
        if (lifted === el && !document.querySelector('[role="menu"]')) unlift();
      }, 400);
    },
    /** The finger that held lifted: what it clicks now is part of the hold. */
    lifted() {
      swallowUntil = Date.now() + AFTER_HOLD_MS;
      pressing = false;
      setTimeout(() => selection(false), 50);
    },
    swallowing: () => Date.now() < swallowUntil,
    stop() {
      unlift();
      selection(false);
    },
  };
}

/** Android: its own right-click opens the menu; the press around it gets the same tidying as on iOS. */
function installAndroidGuard(): () => void {
  const root = document.documentElement;
  const guard = pressGuard(root);
  let down = false;
  let held = false;
  const onStart = (e: TouchEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    down = true;
    held = false;
    if (target && e.touches.length === 1) guard.press(target);
  };
  const onEnd = () => {
    down = false;
    if (held) guard.lifted();
    else guard.release();
    held = false;
  };
  const onMove = () => {
    if (!held) guard.release();
  };
  // Before the app's own handlers (capturing, on window): what will lift is marked, so the menu goes beside it.
  const onContextFirst = (e: MouseEvent) => {
    if (down && e.target instanceof Element && !e.target.closest(EDITABLE)) guard.prelift(e.target);
  };
  // After them (bubbling, on window): only a right-click that opened something counts.
  const onContext = (e: MouseEvent) => {
    if (!down || !(e.target instanceof Element) || e.target.closest(EDITABLE)) return;
    if (!e.defaultPrevented) return guard.drop();
    held = true;
    guard.opened(e.target);
  };
  const onClick = (e: MouseEvent) => {
    if (!held && !guard.swallowing()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const mouse = ["mousedown", "mouseup", "click"] as const;
  const opts = { capture: true, passive: true } as const;
  document.addEventListener("touchstart", onStart, opts);
  document.addEventListener("touchmove", onMove, opts);
  document.addEventListener("touchend", onEnd, opts);
  document.addEventListener("touchcancel", onEnd, opts);
  window.addEventListener("contextmenu", onContextFirst, true);
  window.addEventListener("contextmenu", onContext);
  for (const type of mouse) window.addEventListener(type, onClick, true);
  return () => {
    window.removeEventListener("contextmenu", onContextFirst, true);
    document.removeEventListener("touchstart", onStart, opts);
    document.removeEventListener("touchmove", onMove, opts);
    document.removeEventListener("touchend", onEnd, opts);
    document.removeEventListener("touchcancel", onEnd, opts);
    window.removeEventListener("contextmenu", onContext);
    for (const type of mouse) window.removeEventListener(type, onClick, true);
    guard.stop();
  };
}

/** Starts listening; returns the function that stops. Where the browser opens menus itself (Android), only the tidying. */
export function installTouchContextMenu(): () => void {
  if (!needsLongPress()) return androidTouch() ? installAndroidGuard() : () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number; target: Element } | null = null;
  let held = false;
  // While a held menu is up, the view under the finger stays still, so moving the finger can move the
  // thing held (not scroll the page).
  let frozen: { el: HTMLElement; overflow: string } | null = null;
  let heldAt: { x: number; y: number; target: Element; moved: boolean } | null = null;
  const unfreeze = () => {
    if (frozen) frozen.el.style.overflowY = frozen.overflow;
    frozen = null;
  };

  const root = document.documentElement;
  const guard = pressGuard(root);
  // While a menu opened by holding is on screen and the finger is still down, iOS mustn't start selecting text.
  const holdSelection = (on: boolean) => {
    root.style.setProperty("-webkit-user-select", on ? "none" : "");
    root.style.setProperty("user-select", on ? "none" : "");
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    // A press that ends without a menu lets selection come back.
    if (start) guard.release();
    timer = null;
    start = null;
  };
  const fire = () => {
    timer = null;
    if (!start || !start.target.isConnected) return;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 2,
      clientX: start.x,
      clientY: start.y,
      screenX: start.x + window.screenX,
      screenY: start.y + window.screenY,
    });
    fromHold.add(event);
    guard.prelift(start.target);
    start.target.dispatchEvent(event);
    const target = start.target;
    const at = { x: start.x, y: start.y };
    start = null;
    if (!event.defaultPrevented) return guard.drop();
    heldAt = { ...at, target, moved: false };
    const scroller = scrollerOf(target);
    if (scroller) {
      frozen = { el: scroller, overflow: scroller.style.overflowY };
      scroller.style.overflowY = "hidden";
    }
    // A menu opened: what the finger does next belongs to it (felt in the app, and what was held lifts).
    guard.opened(target);
    held = true;
    holdSelection(true);
  };

  // What a held finger froze is let go when it lifts. Its touchend can be lost (what it was on was redrawn
  // when a moved block landed, so the event never reaches the document): the pointer's lift ends it too,
  // and so does the next touch.
  const release = () => {
    if (!held) return;
    held = false;
    heldAt = null;
    unfreeze();
    guard.lifted();
    setTimeout(() => holdSelection(false), 50);
  };
  const onPointerEnd = (e: PointerEvent) => {
    // (A moment later: its touchend, which comes just after, ends the hold itself when it arrives.)
    if (e.pointerType === "touch" && held) setTimeout(release, 60);
  };

  const onStart = (e: TouchEvent) => {
    cancel();
    release();
    const touch = e.touches.length === 1 ? e.touches[0] : undefined;
    const target = e.target instanceof Element ? e.target : null;
    // Text fields keep iOS's own (its loupe, select and paste); so do media, embedded pages and anything marked native.
    if (!touch || !target || target.closest("input, textarea, select, video, audio, iframe, [data-native-menu]")) return;
    start = { x: touch.clientX, y: touch.clientY, target };
    guard.press(target);
    timer = setTimeout(fire, HOLD_MS);
  };
  const onMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (held && heldAt && touch && !heldAt.moved && Math.hypot(touch.clientX - heldAt.x, touch.clientY - heldAt.y) > SLOP) {
      heldAt.moved = true;
      const detail: HoldMoveDetail = { startX: heldAt.x, startY: heldAt.y, x: touch.clientX, y: touch.clientY };
      heldAt.target.dispatchEvent(new CustomEvent(HOLD_MOVE_EVENT, { bubbles: true, cancelable: true, detail }));
      return;
    }
    if (!start || !touch) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > SLOP) cancel();
  };
  const onEnd = (e: TouchEvent) => {
    cancel();
    if (!held) return;
    // The lift that ends a hold isn't a tap on whatever is under the finger (the menu, or the page).
    if (e.cancelable) e.preventDefault();
    release();
  };

  // While a held finger has a menu open, WebKit can still send a mouse press for it (a held link does, about
  // 200 ms in): that isn't a tap outside the menu, so it never reaches the menu's close-on-outside-press.
  const onMouse = (e: MouseEvent) => {
    // (And just after the finger lifts: WebKit's mouse press for the lift would close the menu it opened.)
    if (!held && !guard.swallowing()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // The click WebKit can still send when a held finger lifts opens neither what was held nor the menu item
  // under the finger (a "Delete folder…" under it must be tapped on its own).
  const onClick = (e: MouseEvent) => {
    if (!held && !guard.swallowing()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // iOS's own sheet for a held link or picture would cover the menu: the menu has those actions instead.
  root.style.setProperty("-webkit-touch-callout", "none");
  // A browser that does send its own for a long press (a future Safari): that one opens the menu, not a second.
  const onNative = (e: Event) => {
    if (!fromHold.has(e)) cancel();
  };

  const opts = { capture: true, passive: true } as const;
  document.addEventListener("contextmenu", onNative, true);
  document.addEventListener("touchstart", onStart, opts);
  document.addEventListener("touchmove", onMove, opts);
  document.addEventListener("touchend", onEnd, { capture: true, passive: false });
  document.addEventListener("touchcancel", onEnd, { capture: true, passive: false });
  window.addEventListener("scroll", cancel, opts);
  window.addEventListener("pointerup", onPointerEnd, opts);
  window.addEventListener("pointercancel", onPointerEnd, opts);
  for (const type of ["mousedown", "mouseup"] as const) window.addEventListener(type, onMouse, true);
  window.addEventListener("click", onClick, true);
  return () => {
    for (const type of ["mousedown", "mouseup"] as const) window.removeEventListener(type, onMouse, true);
    window.removeEventListener("click", onClick, true);
    guard.stop();
    window.removeEventListener("pointerup", onPointerEnd, opts);
    window.removeEventListener("pointercancel", onPointerEnd, opts);
    cancel();
    unfreeze();
    holdSelection(false);
    root.style.removeProperty("-webkit-touch-callout");
    document.removeEventListener("contextmenu", onNative, true);
    document.removeEventListener("touchstart", onStart, opts);
    document.removeEventListener("touchmove", onMove, opts);
    document.removeEventListener("touchend", onEnd, { capture: true });
    document.removeEventListener("touchcancel", onEnd, { capture: true });
    window.removeEventListener("scroll", cancel, opts);
  };
}
