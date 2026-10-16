// Press and hold opens Folevi's own menus on iPhone and iPad, as right-click does elsewhere. Safari on iOS
// never fires `contextmenu` for a long press (Android does), so a held touch sends one: everything that
// listens for right-clicks (the editor, note cards, tabs, AppContextMenu) works unchanged.

import { haptic } from "./nativeApp";

/** How long a finger rests before the menu opens; just under iOS's own text selection, so the menu wins. */
const HOLD_MS = 450;
/** A finger that moves further than this is scrolling or dragging, not holding. */
const SLOP = 10;

const fromHold = new WeakSet<Event>();

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

/** Starts listening; returns the function that stops. Does nothing where the browser opens menus itself. */
export function installTouchContextMenu(): () => void {
  if (!needsLongPress()) return () => undefined;
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
  // While a menu opened by holding is on screen and the finger is still down, iOS mustn't start selecting text.
  const holdSelection = (on: boolean) => {
    root.style.setProperty("-webkit-user-select", on ? "none" : "");
    root.style.setProperty("user-select", on ? "none" : "");
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
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
    start.target.dispatchEvent(event);
    const target = start.target;
    const at = { x: start.x, y: start.y };
    start = null;
    if (!event.defaultPrevented) return;
    heldAt = { ...at, target, moved: false };
    const scroller = scrollerOf(target);
    if (scroller) {
      frozen = { el: scroller, overflow: scroller.style.overflowY };
      scroller.style.overflowY = "hidden";
    }
    // A menu opened: what the finger does next belongs to it (felt, in the iOS app).
    haptic("medium");
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
  return () => {
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
