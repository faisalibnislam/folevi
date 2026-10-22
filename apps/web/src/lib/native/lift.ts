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
  /** What the thing's inline style had before it was pressed in and hidden. */
  saved: { transform: string; transition: string; visibility: string };
}

/** One press at a time: what's held, its picture and its backdrop. */
export function liftController() {
  let held: Held | null = null;
  let backdrop: HTMLElement | null = null;

  const restore = (h: Held) => {
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
      return h.armed;
    },
    /** The menu opened: the picture lifts over the thing (when the app took one). Resolves whether it did. */
    async lift(el: HTMLElement): Promise<boolean> {
      const h = held;
      const bridge = nativeLift();
      if (!h || h.el !== el || !h.armed || !bridge) return false;
      h.shown = true;
      showBackdrop();
      const ok = await bridge.lift!({ id: h.id, from: h.pressed ? PRESSED_SCALE : 1 }).catch(() => false);
      if (held !== h) return ok;
      if (!ok) {
        h.shown = false;
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
