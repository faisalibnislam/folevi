// The lifted preview of a long press (docs/IOS_POLISH_PLAN.md §4.1, owner's decision D1: the menu stays
// Folevi's own, only the preview is native). lib/touchContextMenu.ts drives it:
//
// 1. A finger has rested on something with a menu for a moment (ARM_MS): the app takes a picture of it as it is
//    at rest (`liftArm`), and the page starts pressing it in (scale 0.97, linear, until the hold fires).
// 2. The menu opened: the picture floats above the page over the thing, springing from the pressed-in scale to
//    1.04 with a shadow (`lift`), the thing itself steps out of sight under it, and the page behind (not the
//    menu, which is the page's) goes under a frosted backdrop. The page's menu sits beside the lifted thing.
// 3. The menu closed: the picture settles back into place (or fades, when the thing is gone or was dragged
//    away), the backdrop fades, and the thing is shown again (`liftDrop`).
//
// Without the app's piece (the website, Android without it, an older app) step 1 only presses in and the page's
// own lift runs (globals.css [data-held-lift]: the thing grows a little, no backdrop).

import { nativeApp } from "@/lib/nativeApp";
import { prefersReducedMotion } from "./physics";
import { screenRect } from "./ui";

/** How long a finger rests before the picture is taken: long enough that a tap or a scroll never asks for one. */
export const ARM_MS = 120;
/** The scale a held thing is pressed in to by the time its menu opens (§2.4). */
export const PRESSED_SCALE = 0.97;
/** A thing taller than this share of the screen (a whole note) doesn't lift as a picture. */
const MAX_HEIGHT_SHARE = 0.6;

const BACKDROP_ATTR = "data-lift-backdrop";
/** Marks a held thing whose lift is the app's picture (globals.css keeps the thing itself at rest under it). */
export const LIFT_NATIVE_ATTR = "data-lift-native";
/** The scale the app's picture lifts to (Native/UI/LiftPreview.swift liftedScale), and the page's own lift's. */
export const LIFTED_SCALE = 1.04;

// ------------------------------------------------------------------------- where the menu goes

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the held thing is drawn while its menu is open: the thing at rest (whatever scale its own lift has
 * reached mid-transition), grown to LIFTED_SCALE about its centre. Null when nothing is held.
 */
export function heldLiftRect(): Box | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>("[data-held-lift]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // (A transform only scales here: undo it to find the box at rest.)
  const m = /^matrix\(([^,]+),/.exec(getComputedStyle(el).transform);
  const now = m ? Math.abs(parseFloat(m[1]!)) || 1 : 1;
  const k = LIFTED_SCALE / now;
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  return { left: cx - (r.width * k) / 2, right: cx + (r.width * k) / 2, top: cy - (r.height * k) / 2, bottom: cy + (r.height * k) / 2 };
}

export interface LiftPlacement {
  left: number;
  top: number;
  /** The most the menu may be tall there (it scrolls inside when it's taller). */
  maxHeight: number;
  /** Where it grows from (its corner or edge nearest the held thing). */
  origin: string;
  side: "below" | "above" | "right" | "left";
  /** No room anywhere clear of the held thing: the menu covers part of it. */
  overlaps: boolean;
}

/**
 * Where a menu goes for a held thing, as iOS places a context menu: below it, else above it, else beside it
 * (the roomier side), always on screen (`view`, the usable part of the screen) and never over it. Aligned with
 * the thing's leading edge ("start") or trailing edge ("end"). When it doesn't fit anywhere whole, the roomiest
 * clear place with the menu scrolling inside; only when there's no clear place of a useful size does it overlap.
 */
export function placeAroundLift(lift: Box, menu: { width: number; height: number }, view: Box, align: "start" | "end" = "start", gap = 8): LiftPlacement {
  const w = Math.min(menu.width, view.right - view.left);
  const h = menu.height;
  const clampX = (x: number) => Math.min(Math.max(view.left, x), view.right - w);
  const clampY = (y: number, height: number) => Math.min(Math.max(view.top, y), view.bottom - height);
  const x = clampX(align === "end" ? lift.right - w : lift.left);
  const hx = align === "end" ? "right" : "left";
  const rooms = {
    below: view.bottom - (lift.bottom + gap),
    above: lift.top - gap - view.top,
    right: view.right - (lift.right + gap),
    left: lift.left - gap - view.left,
  };
  const full = view.bottom - view.top;
  const below = (maxHeight: number): LiftPlacement => ({ left: x, top: lift.bottom + gap, maxHeight, origin: `${hx} top`, side: "below", overlaps: false });
  const above = (maxHeight: number): LiftPlacement => ({ left: x, top: lift.top - gap - Math.min(h, maxHeight), maxHeight, origin: `${hx} bottom`, side: "above", overlaps: false });
  const beside = (side: "right" | "left"): LiftPlacement => {
    const height = Math.min(h, full);
    return { left: side === "right" ? lift.right + gap : lift.left - gap - w, top: clampY(lift.top, height), maxHeight: full, origin: `${side === "right" ? "left" : "right"} top`, side, overlaps: false };
  };
  // Whole, in iOS's order.
  if (h <= rooms.below) return below(rooms.below);
  if (h <= rooms.above) return above(rooms.above);
  const sides = (["right", "left"] as const).filter((s) => rooms[s] >= w).sort((a, b) => rooms[b] - rooms[a]);
  if (sides.length && h <= full) return beside(sides[0]!);
  // Not whole anywhere: the roomiest clear place, scrolling inside (a side is a whole screen tall).
  const MIN = 132;
  const vertical = rooms.below >= rooms.above ? ("below" as const) : ("above" as const);
  if (sides.length && full > Math.max(rooms.below, rooms.above)) return beside(sides[0]!);
  if (rooms[vertical] >= MIN) return vertical === "below" ? below(rooms.below) : above(rooms.above);
  // Nowhere clear (a held thing nearly the whole screen): over it, on screen.
  const top = clampY(lift.bottom + gap, Math.min(h, full));
  return { left: x, top, maxHeight: full, origin: `${hx} top`, side: "below", overlaps: true };
}

/** A menu placed over the held thing (placeAroundLift's `overlaps`) tells the lift so the app's picture steps aside. */
export const LIFT_COVERED_EVENT = "folevi:lift-covered";
let coveredSince = 0;
/** Called by a menu once it's placed for a held thing. */
export function reportLiftPlacement(p: LiftPlacement): void {
  if (!p.overlaps) return;
  coveredSince = Date.now();
  document.dispatchEvent(new Event(LIFT_COVERED_EVENT));
}

let counter = 0;
/** Things whose picture is still settling back: their own visibility, to give back when it has (or a new hold starts). */
const settling = new WeakMap<HTMLElement, string>();

function nativeLift() {
  const b = nativeApp();
  return b && typeof b.liftArm === "function" && typeof b.lift === "function" && typeof b.liftDrop === "function" ? b : null;
}

/** Whether `el` lifts by growing (a card, a tile, a row with its own menu), as opposed to the pressed tint of a link. */
export const growsWhenLifted = (el: Element): boolean => el.matches("[data-ctx-host], [data-lift]");

/** The corner radius the preview gets: the thing's own, or a row's 12 when it's square. */
function radiusOf(el: HTMLElement): number {
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(r) && r > 0 ? Math.min(r, 40) : 12;
}

/** The visible part of `el` on screen, or null when too little of it shows or it's too big to lift. */
function visibleRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  const right = Math.min(vw, r.right);
  const bottom = Math.min(vh, r.bottom);
  if (right - left < 8 || bottom - top < 8) return null;
  if (bottom - top > vh * MAX_HEIGHT_SHARE) return null;
  return screenRect(new DOMRect(left, top, right - left, bottom - top));
}

interface Held {
  id: string;
  el: HTMLElement;
  /** Whether the app has the picture (asked for it). */
  armed: boolean;
  /** Whether the picture is up (lift resolved true). */
  shown: boolean;
  pressed: boolean;
  /** Stops listening for the menu covering it. */
  unlisten?: () => void;
  /** What the thing's inline style had before it was pressed in and hidden. */
  saved: { transform: string; transition: string; visibility: string };
}

/** One press at a time: what's held, its picture and its backdrop. */
export function liftController() {
  let held: Held | null = null;
  let backdrop: HTMLElement | null = null;

  const restore = (h: Held) => {
    h.unlisten?.();
    h.el.removeAttribute(LIFT_NATIVE_ATTR);
    h.el.style.transform = h.saved.transform;
    h.el.style.transition = h.saved.transition;
    h.el.style.visibility = h.saved.visibility;
  };

  const showBackdrop = () => {
    hideBackdrop(true);
    const el = document.createElement("div");
    el.setAttribute(BACKDROP_ATTR, "");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("popover", "manual");
    const solid = document.documentElement.hasAttribute("data-reduce-transparency");
    const dark = document.documentElement.dataset.theme === "dark";
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "margin:0",
      "padding:0",
      "border:0",
      "width:100vw",
      "height:100vh",
      "max-width:none",
      "max-height:none",
      `background:${dark ? "rgb(0 0 0 / 0.32)" : "rgb(0 0 0 / 0.1)"}`,
      solid ? "" : "-webkit-backdrop-filter:blur(16px) saturate(1.3);backdrop-filter:blur(16px) saturate(1.3)",
      "opacity:0",
      `transition:opacity ${prefersReducedMotion() ? 150 : 220}ms ease-out`,
    ]
      .filter(Boolean)
      .join(";");
    // A tap on it is a tap outside the menu, which closes it (components/ui/Menu.tsx listens for the press):
    // WebKit sends no mouse press of its own for a tap on something that isn't a control.
    el.style.cursor = "pointer";
    el.addEventListener("pointerdown", () => {
      if (backdrop === el) el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
    });
    document.body.appendChild(el);
    try {
      el.showPopover();
    } catch {
      el.style.zIndex = "99";
    }
    // The menu was put in the top layer first (it opened before the picture was up): it goes back above.
    for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"][popover]')) {
      try {
        if (menu.matches(":popover-open")) {
          menu.hidePopover();
          menu.showPopover();
        }
      } catch {
        /* not a popover after all */
      }
    }
    requestAnimationFrame(() => (el.style.opacity = "1"));
    backdrop = el;
  };

  function hideBackdrop(now = false) {
    const el = backdrop;
    backdrop = null;
    if (!el) return;
    if (now) return el.remove();
    el.style.opacity = "0";
    setTimeout(() => el.remove(), prefersReducedMotion() ? 160 : 240);
  }

  return {
    /** The finger has rested on `el`: the picture is taken and the press-in starts. `holdMs`: until the menu opens. */
    arm(el: HTMLElement, holdMs: number) {
      this.cancel();
      const visibility = settling.get(el) ?? el.style.visibility;
      settling.delete(el);
      el.style.visibility = visibility;
      const h: Held = { id: `lift-${++counter}`, el, armed: false, shown: false, pressed: false, saved: { transform: el.style.transform, transition: el.style.transition, visibility } };
      held = h;
      const bridge = nativeLift();
      const rect = bridge ? visibleRect(el) : null;
      if (bridge && rect) {
        bridge.liftArm!({ id: h.id, rect, radius: radiusOf(el) });
        h.armed = true;
      }
      if (!growsWhenLifted(el) || prefersReducedMotion()) return;
      // (Two frames on: the picture is taken of the thing at rest, not already pressed in.)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (held !== h) return;
          h.pressed = true;
          el.style.transition = `transform ${Math.max(60, holdMs)}ms linear`;
          el.style.transform = `scale(${PRESSED_SCALE})`;
        }),
      );
    },
    /** Whether `el` is what's held (armed). */
    holds: (el: Element | null) => !!held && held.el === el,
    /** The press ended without a menu: the press-in springs back, the picture is let go. */
    cancel() {
      const h = held;
      if (!h || h.shown) return;
      held = null;
      if (h.pressed) {
        h.el.style.transition = "transform 160ms ease-out";
        h.el.style.transform = h.saved.transform;
        setTimeout(() => {
          if (held !== h) h.el.style.transition = h.saved.transition;
        }, 170);
      } else restore(h);
      if (h.armed) void nativeLift()?.liftDrop!({ id: h.id, to: "fade" });
    },
    /**
     * The menu is about to open for `el`: the press-in lets go (the page's lift, or the picture, takes over).
     * Returns whether the native picture will show.
     */
    prelift(el: HTMLElement): boolean {
      const h = held;
      if (!h || h.el !== el) return false;
      h.el.style.transition = h.saved.transition;
      h.el.style.transform = h.saved.transform;
      // (Marked before the menu is placed, so it's placed round the picture's size, not the page's own lift.)
      if (h.armed) h.el.setAttribute(LIFT_NATIVE_ATTR, "");
      coveredSince = 0;
      return h.armed;
    },
    /** The menu opened: the picture lifts over the thing (when the app took one). Resolves whether it did. */
    async lift(el: HTMLElement): Promise<boolean> {
      const h = held;
      const bridge = nativeLift();
      if (!h || h.el !== el || !h.armed || !bridge) return false;
      // The menu had to go over the thing (no room clear of it): the page's own lift, under the menu.
      if (coveredSince) {
        this.drop("fade");
        return false;
      }
      h.shown = true;
      showBackdrop();
      const onCovered = () => {
        if (held === h) this.drop("fade");
      };
      document.addEventListener(LIFT_COVERED_EVENT, onCovered, { once: true });
      h.unlisten = () => document.removeEventListener(LIFT_COVERED_EVENT, onCovered);
      const ok = await bridge.lift!({ id: h.id, from: h.pressed ? PRESSED_SCALE : 1 }).catch(() => false);
      if (held !== h) return ok;
      if (!ok) {
        h.shown = false;
        h.el.removeAttribute(LIFT_NATIVE_ATTR);
        h.unlisten?.();
        hideBackdrop();
        return false;
      }
      // The picture is over it: the thing itself steps out of sight (no blurred copy round the picture's edge).
      h.el.style.visibility = "hidden";
      return true;
    },
    /**
     * The menu closed (or the thing was dragged on): the picture settles back ("back") or fades ("fade"),
     * then the thing shows again.
     */
    drop(to?: "back" | "fade") {
      const h = held;
      if (!h) return;
      held = null;
      restore(h);
      if (!h.armed) return;
      hideBackdrop();
      const gone = !h.el.isConnected;
      const bridge = nativeLift();
      if (!bridge) return;
      // Hidden again until the picture has landed on it (it's the same pixels; the picture goes after).
      if (h.shown && !gone && (to ?? "back") === "back") {
        h.el.style.visibility = "hidden";
        settling.set(h.el, h.saved.visibility);
      }
      void bridge
        .liftDrop!({ id: h.id, to: gone ? "fade" : (to ?? "back") })
        .catch(() => undefined)
        .then(() => {
          // (Unless a new hold on it took over.)
          if (!settling.has(h.el)) return;
          settling.delete(h.el);
          h.el.style.visibility = h.saved.visibility;
        });
    },
    stop() {
      this.drop("fade");
      hideBackdrop(true);
    },
  };
}

export type LiftController = ReturnType<typeof liftController>;
