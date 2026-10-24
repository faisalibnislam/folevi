"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";
import { SPRINGS, VelocityTracker, prefersReducedMotion } from "@/lib/native/physics";
import { safeInsets } from "@/lib/iphone";
import { KEYBOARD_EASE, onKeyboardFrame } from "@/lib/native/ui";
import { dimAt, poseFor, releaseTarget, restingDetent, springFrames, springStart, type SheetPose } from "./sheetMotion";

export type SheetSize = "fit" | "medium" | "large";

/**
 * A round button in a sheet's header (Close, a menu, New chat): a 32 pt circle drawn in a 44 pt target, as iOS
 * draws a sheet's close button. The circle is the ::before; the icon sits on it.
 */
export const SHEET_BUTTON =
  "relative isolate grid h-11 w-11 flex-none place-items-center rounded-capsule text-muted outline-none before:absolute before:left-1.5 before:top-1.5 before:-z-10 before:h-8 before:w-8 before:rounded-capsule before:bg-[color-mix(in_oklab,var(--color-ink)_9%,transparent)] before:transition-transform before:duration-200 active:before:scale-90 focus-visible:before:ring-2 focus-visible:before:ring-focus";

/** How dark the screen behind gets (§2.4): a sheet at its large (or only) detent, and at medium. */
const DIM_FULL = 0.25;
const DIM_MEDIUM = 0.1;
/**
 * A sheet's surface: solid (the screen's raised neutral, light and dark) with the glass's fine edge and soft
 * shadow. No backdrop blur: blurring what's under a sheet costs the web view every frame it moves.
 */
const SURFACE = "relative isolate bg-[var(--iphone-solid)] shadow-[var(--liquid-edge),var(--liquid-shadow)]";
/** Below the screen with its shadow, when it's gone. */
const OFF = 24;
/** Going away: the sheet's spring without the bounce (nothing to see past the screen's edge), quick to settle. */
const AWAY = { response: SPRINGS.sheet.response, damping: 1 };

/** The scrollable element a touch started in (inside the sheet), if any. */
function scrollerOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== root) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [data-no-sheet-drag], [role="slider"]';

/**
 * The screen a sheet is laid out on, in points, taken when it opens (and again when the screen turns with the
 * keyboard away): its height and how far the status bar and the home indicator reach in. The sheet is placed
 * from the top of this, not from the bottom of the window, so the app's web view shrinking for the keyboard
 * (Capacitor resizes it a moment after the keyboard lands) doesn't move it: the keyboard's own news does, in
 * step with it (onKeyboardFrame).
 */
interface Screen {
  h: number;
  top: number;
  bottom: number;
}
function measureScreen(keyboard = 0): Screen {
  const { top, bottom } = safeInsets();
  return { h: window.innerHeight + keyboard, top, bottom };
}

/** The sheet's large detent (the screen below the status bar) and medium one (a little over half), in points. */
function detentsOn(s: Screen): { large: number; medium: number } {
  const large = s.h - s.top - 10;
  return { large, medium: Math.min(Math.round(s.h * 0.56), large) };
}

/** Where a panel is drawn right now (part way through an animation, too): how far it's pushed down. */
function currentOffset(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    return new DOMMatrix(t).m42;
  } catch {
    return 0;
  }
}

/**
 * A sheet, as iOS presents one: a panel from the bottom of the screen with a grabber, on a spring; dragged with
 * the finger 1:1 (from the grabber or the header anywhere, or from the content once it's scrolled to its top),
 * rubber-banded past its top, and let go it settles on the detent the fling carries it to or goes away
 * (docs/IOS_POLISH_PLAN.md §2.4). A `medium` sheet is dragged up to fill the screen (scrolling its content up
 * does that first, as on iOS). The screen behind dims with how much of the sheet shows; a tap there lowers a
 * pulled-up medium sheet, or closes. `variant="card"` is the short-form version: a card in the middle (above
 * the keyboard). Both are modal <dialog>s: the page behind is inert, focus stays inside, Escape closes, and focus
 * returns to what opened it. Reduce Motion: every move is a 150 ms cross-fade.
 *
 * It comes in from below on its first frame, in points (WebKit misplaces a `calc(% + px)` transform keyframe: the
 * sheet flew up to the top of the screen and then snapped down). A medium or large sheet draws its frame at once
 * and its content a frame later, so the tap answers at once.
 *
 * The keyboard: it rides with the keyboard's own move (its height, duration and curve, from the app): a medium or
 * large sheet goes to its large detent and its dock (its `footer`, or the element marked `data-sheet-dock` in
 * it, like Foli AI's composer) rides up on the keyboard's top in the same move; a fitted sheet lifts whole.
 */
export function Sheet({
  open,
  onClose,
  label,
  title,
  description,
  leading,
  trailing,
  footer,
  children,
  size = "fit",
  variant = "sheet",
  closeButton = true,
  bodyClassName = "",
  labelledBy,
  snapMedium,
  appear = true,
  bodyPad = true,
}: {
  open: boolean;
  onClose: () => void;
  /** The accessible name when there's no visible title. */
  label?: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Header slots beside the title (a menu button at the start, an action at the end). */
  leading?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  size?: SheetSize;
  variant?: "sheet" | "card";
  closeButton?: boolean;
  bodyClassName?: string;
  /** An id inside the content that names the sheet (instead of `title`). */
  labelledBy?: string;
  /**
   * A medium sheet's content in blocks (a CSS selector, e.g. its grouped sections): its medium detent ends just
   * after the last block that fits, not part way through one (as iOS's account sheets do).
   */
  snapMedium?: string;
  /** false: the content scrolls inside a list of its own, which keeps the home indicator's room itself (--sheet-safe-b). */
  bodyPad?: boolean;
  /** false: it's already on screen (it takes over from a stand-in drawn while its code loaded), so no slide in. */
  appear?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLElement>(null);
  const lead = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  // The medium detent fitted to whole blocks (snapMedium), in points; null: the usual one.
  const [mediumFit, setMediumFit] = useState<number | null>(null);
  const mediumFitRef = useRef(mediumFit);
  mediumFitRef.current = mediumFit;
  const titleId = useId();
  const descId = useId();
  // Mounted while open and while the closing animation plays.
  const [shown, setShown] = useState(open);
  const [expanded, setExpanded] = useState(size === "large");
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const opener = useRef<HTMLElement | null>(null);
  // The content mounts once the dialog is open, so a field marked autoFocus can take the focus.
  const [ready, setReady] = useState(false);
  const card = variant === "card";
  const fit = size === "fit" || card;
  // A medium or large sheet's height is known before its content: its frame comes in at once, the content next.
  const later = !fit && !snapMedium;

  // What's moving the sheet now: the animations coming in or going away, a settle on a detent, a finger.
  const motion = useRef<{ anims: Animation[]; raf: number; closing: boolean; entering: boolean }>({ anims: [], raf: 0, closing: false, entering: false });
  // The keyboard's move (the sheet and its dock riding with it).
  const kb = useRef<{ height: number; anims: Animation[] }>({ height: 0, anims: [] });
  // The pose a finger or a settle has drawn (null: at rest, where its CSS puts it).
  const pose = useRef<SheetPose | null>(null);
  // A drag that let the sheet go: how fast, for the spring that takes it away (points per second, up positive).
  const releaseVelocity = useRef(0);
  const appearRef = useRef(appear);
  appearRef.current = appear;

  const detents = useCallback((): number[] => {
    const p = panel.current;
    if (fit) return [p?.offsetHeight ?? 0];
    const s = screenRef.current ?? measureScreen();
    const { large, medium } = detentsOn(s);
    return size === "medium" ? [Math.min(mediumFitRef.current ?? medium, large), large] : [large];
  }, [size, fit]);
  const restDim = useCallback(() => (size === "medium" && !expandedRef.current ? DIM_MEDIUM : DIM_FULL), [size]);
  const dimsFor = useCallback((ds: number[]) => (ds.length > 1 ? [DIM_MEDIUM, DIM_FULL] : [DIM_FULL]), []);

  const stop = useCallback(() => {
    const m = motion.current;
    for (const a of m.anims) {
      try {
        a.commitStyles?.();
      } catch {
        /* not rendered */
      }
      a.cancel();
    }
    m.anims = [];
    if (m.raf) cancelAnimationFrame(m.raf);
    m.raf = 0;
    m.entering = false;
  }, []);

  // Draws a pose (null: back to rest) with the screen behind dimmed to match.
  const draw = useCallback((next: SheetPose | null, dim: number) => {
    const p = panel.current;
    pose.current = next;
    if (p) {
      if (next) {
        p.style.setProperty("--sheet-drag-h", `${next.height}px`);
        p.style.maxHeight = "none";
        p.style.transform = next.offset ? `translateY(${next.offset}px)` : "";
      } else {
        p.style.removeProperty("--sheet-drag-h");
        p.style.maxHeight = "";
        p.style.transform = "";
        p.style.opacity = "";
      }
    }
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, Math.min(1, dim)));
  }, []);

  useEffect(() => {
    if (open) {
      setShown(true);
      setExpanded(size === "large");
    }
  }, [open, size]);

  // Comes in from below the screen on a spring, in points (its height is known now: a fitted sheet's content is in).
  const enter = useCallback(() => {
    const p = panel.current;
    const s = scrim.current;
    motion.current.entering = false;
    if (!p || !s) return;
    const dim = restDim();
    p.style.visibility = "";
    if (!appearRef.current) {
      draw(null, dim);
      return;
    }
    if (prefersReducedMotion()) {
      motion.current.anims = [p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" }), s.animate([{ opacity: 0 }, { opacity: dim }], { duration: 150, easing: "linear" })];
      return;
    }
    if (card) {
      motion.current.anims = [
        p.animate([{ opacity: 0, transform: "scale(0.94)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" }),
        s.animate([{ opacity: 0 }, { opacity: dim }], { duration: 220, easing: "ease-out" }),
      ];
      return;
    }
    const wrapRect = wrap.current?.getBoundingClientRect();
    const below = wrapRect ? Math.max(0, wrapRect.bottom - p.getBoundingClientRect().bottom) : 0;
    const from = p.offsetHeight + below + OFF;
    const { progress, ms } = springFrames(SPRINGS.sheet);
    motion.current.anims = [
      p.animate(progress.map((k) => ({ transform: `translateY(${Math.round((1 - k) * from * 100) / 100}px)` })), { duration: ms, easing: "linear" }),
      s.animate(progress.map((k) => ({ opacity: Math.min(1, Math.max(0, k * dim)) })), { duration: ms, easing: "linear" }),
    ];
  }, [card, draw, restDim]);

  // Open as a modal on a spring from below; on close, go away first.
  useLayoutEffect(() => {
    const el = ref.current;
    const p = panel.current;
    const s = scrim.current;
    if (!el || !shown) return;
    if (open && !screen) {
      // (The screen it's laid out on first: the next render places it, still before anything is drawn.)
      setScreen(measureScreen());
      return;
    }
    if (open && (!el.open || motion.current.closing)) {
      const reopening = el.open;
      if (!reopening) {
        const active = document.activeElement;
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
        el.showModal();
        // The sheet itself takes the focus (not its Close button, ringed); a field that asks for it takes it next.
        p?.focus({ preventScroll: true });
      }
      stop();
      motion.current.closing = false;
      draw(null, restDim());
      if (!p || !s) return;
      if (reopening || later) {
        enter();
        // The content a frame later: the sheet is on its way first.
        if (!reopening) requestAnimationFrame(() => setReady(true));
      } else {
        // A fitted sheet's height is its content's: in first (hidden), then in from below.
        p.style.visibility = "hidden";
        motion.current.entering = true;
        setReady(true);
      }
      return;
    }
    if (!open && el.open && !motion.current.closing) {
      const from = pose.current ? pose.current.offset : p ? currentOffset(p) : 0;
      const fromDim = s ? Number(getComputedStyle(s).opacity) || 0 : 0;
      stop();
      motion.current.closing = true;
      const done = () => {
        if (!motion.current.closing) return;
        motion.current.closing = false;
        motion.current.anims = [];
        draw(null, 0);
        for (const a of kb.current.anims) a.cancel();
        kb.current = { height: 0, anims: [] };
        if (wrap.current) wrap.current.style.transform = "";
        panel.current?.style.removeProperty("--sheet-kb");
        panel.current?.style.removeProperty("--sheet-safe-b");
        if (ref.current?.open) ref.current.close();
        setShown(false);
        setReady(false);
        setScreen(null);
        const back = opener.current;
        if (back?.isConnected) back.focus({ preventScroll: true });
      };
      if (!p || !s) return done();
      let anims: Animation[];
      if (prefersReducedMotion()) {
        anims = [p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "linear", fill: "forwards" }), s.animate([{ opacity: fromDim }, { opacity: 0 }], { duration: 150, easing: "linear", fill: "forwards" })];
      } else if (card) {
        anims = [
          p.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.96)" }], { duration: 160, easing: "ease-in", fill: "forwards" }),
          s.animate([{ opacity: fromDim }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" }),
        ];
      } else {
        // Down past the screen's edge, carried on by the finger's fling when a drag let it go.
        const wrapRect = wrap.current?.getBoundingClientRect();
        const below = wrapRect ? Math.max(0, wrapRect.bottom - p.getBoundingClientRect().bottom + from) : 0;
        const to = p.offsetHeight + below + OFF;
        const v = springStart(-releaseVelocity.current, to - from);
        releaseVelocity.current = 0;
        const { progress, ms } = springFrames(AWAY, Math.max(0, v), 0.01);
        anims = [
          p.animate(progress.map((k) => ({ transform: `translateY(${from + (to - from) * k}px)` })), { duration: ms, easing: "linear", fill: "forwards" }),
          s.animate(progress.map((k) => ({ opacity: Math.max(0, fromDim * (1 - k)) })), { duration: ms, easing: "linear", fill: "forwards" }),
        ];
      }
      motion.current.anims = anims;
      anims[0]!.onfinish = done;
    }
  }, [open, shown, screen, card, later, draw, stop, restDim, enter]);

  // A fitted sheet: its content is in (hidden), so its height is known: in it comes.
  useLayoutEffect(() => {
    if (ready && motion.current.entering) enter();
  }, [ready, enter]);

  // Settles from where a finger left the sheet to a detent, on the sheet's spring (a new touch catches it). Only
  // its transform and the scrim's opacity move, as Web Animations sampled from the spring, so Core Animation
  // runs it at the display's rate (120 Hz on ProMotion) with nothing for the page to lay out per frame: the
  // panel takes the larger of its two heights for the way (the part below the screen's edge doesn't show),
  // slides, and takes its resting height at the end (docs/IOS_PERFORMANCE.md, "120 Hz").
  const settle = useCallback(
    (visible: number, target: number, velocity: number, ds: number[]) => {
      const p = panel.current;
      const s = scrim.current;
      const dims = dimsFor(ds);
      if (prefersReducedMotion() || !p || !s) {
        draw(null, restDim());
        return;
      }
      const v0 = springStart(velocity, target - visible);
      const { progress, ms } = springFrames(SPRINGS.sheet, v0);
      const min = Math.min(...ds);
      const height = Math.max(visible, target, min);
      const at = (k: number) => {
        let v = visible + (target - visible) * k;
        // Flung down onto its smallest detent, a sheet stops there (it doesn't dip below and bounce back up).
        if (visible >= target && target <= min + 0.5 && v < target) v = target;
        return v;
      };
      draw({ height, offset: height - visible }, dimAt(visible, ds, dims));
      // (Caught by a new touch, it's read from where the animation has it: begin() reads the transform.)
      pose.current = null;
      p.style.willChange = "transform";
      const t: KeyframeAnimationOptions = { duration: ms, easing: "linear" };
      const slide = p.animate(progress.map((k) => ({ transform: `translateY(${Math.round((height - at(k)) * 100) / 100}px)` })), t);
      const fade = s.animate(progress.map((k) => ({ opacity: Math.max(0, Math.min(1, dimAt(at(k), ds, dims))) })), t);
      motion.current.anims = [slide, fade];
      slide.onfinish = () => {
        if (!motion.current.anims.includes(slide)) return;
        motion.current.anims = [];
        p.style.willChange = "";
        draw(null, restDim());
        slide.cancel();
        fade.cancel();
      };
      slide.oncancel = () => {
        p.style.willChange = "";
      };
    },
    [draw, dimsFor, restDim],
  );

  // A finger (or a mouse on the grabber) moving the sheet.
  const drag = useRef<{ startY: number; startVisible: number; ds: number[]; visible: number; tracker: VelocityTracker; active: boolean; decided: boolean; scroller: HTMLElement | null } | null>(null);

  const begin = useCallback(
    (y: number, handle: boolean, scroller: HTMLElement | null) => {
      const p = panel.current;
      if (!p || motion.current.closing) return;
      // Catch it where it is, mid-spring.
      const offset = pose.current ? pose.current.offset : currentOffset(p);
      const height = pose.current ? pose.current.height : p.offsetHeight;
      stop();
      const ds = detents();
      const visible = height - offset;
      if (pose.current || offset) draw({ height, offset }, dimAt(visible, ds, dimsFor(ds)));
      const tracker = new VelocityTracker();
      tracker.add(0, y);
      drag.current = { startY: y, startVisible: visible, ds, visible, tracker, active: handle, decided: handle, scroller };
    },
    [detents, draw, dimsFor, stop],
  );

  const move = useCallback(
    (y: number, e?: TouchEvent) => {
      const d = drag.current;
      if (!d) return false;
      const dy = y - d.startY;
      if (!d.decided) {
        if (Math.abs(dy) < 6) return false;
        d.decided = true;
        const atTop = !d.scroller || d.scroller.scrollTop <= 0;
        // A pull down from the content only once it's scrolled to its top; up, a medium sheet grows first.
        d.active = (dy > 0 && atTop) || (dy < 0 && size === "medium" && !expandedRef.current);
        if (!d.active) {
          drag.current = null;
          // (Caught mid-spring for a scroll or a tap: on to where it was going.)
          if (pose.current) settle(d.visible, restingDetent(d.ds, expandedRef.current), 0, d.ds);
          return false;
        }
        d.startY = y;
      }
      if (!d.active) return false;
      if (e?.cancelable) e.preventDefault();
      // Pulled down with the keyboard up: the keyboard goes (as a sheet's drag dismisses it on iOS).
      if (dy > 0 && kb.current.height > 0) {
        const a = document.activeElement;
        if (a instanceof HTMLElement && panel.current?.contains(a)) a.blur();
      }
      d.tracker.add(0, y);
      d.visible = d.startVisible - (y - d.startY);
      draw(poseFor(d.visible, d.ds), dimAt(d.visible, d.ds, dimsFor(d.ds)));
      return true;
    },
    [size, draw, dimsFor, settle],
  );

  const end = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.active) {
      if (pose.current) settle(d.visible, restingDetent(d.ds, expandedRef.current), 0, d.ds);
      return;
    }
    // Up positive, as the detents are heights.
    const velocity = -d.tracker.velocity().y;
    const target = releaseTarget(d.visible, velocity, d.ds);
    if (target === "dismiss") {
      releaseVelocity.current = velocity;
      onCloseRef.current();
      return;
    }
    if (size === "medium") setExpanded(target >= d.ds[d.ds.length - 1]! - 1);
    // (The rest pose of the new detent comes from React; the spring draws the way there.)
    expandedRef.current = size === "medium" ? target >= d.ds[d.ds.length - 1]! - 1 : expandedRef.current;
    settle(d.visible, target, velocity, d.ds);
  }, [size, settle]);

  useEffect(() => {
    const p = panel.current;
    if (!p || !shown || card) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      const target = e.target as Element;
      const handle = Boolean(target.closest?.("[data-sheet-handle]"));
      if (!handle && target.closest?.(NO_DRAG)) return;
      begin(t.clientY, handle, handle ? null : scrollerOf(target, p));
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) move(t.clientY, e);
    };
    p.addEventListener("touchstart", onStart, { passive: true });
    p.addEventListener("touchmove", onMove, { passive: false });
    p.addEventListener("touchend", end);
    p.addEventListener("touchcancel", end);
    return () => {
      p.removeEventListener("touchstart", onStart);
      p.removeEventListener("touchmove", onMove);
      p.removeEventListener("touchend", end);
      p.removeEventListener("touchcancel", end);
    };
  }, [shown, card, begin, move, end]);

  // A mouse (or a pen) on the grabber drags too.
  const onHandlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    begin(e.clientY, true, null);
    const onMove = (ev: PointerEvent) => void move(ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      end();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  // The keyboard: the sheet (and its dock) ride with it, in step, from its own news (height, duration, curve).
  const keyboardTo = useCallback(
    (height: number, duration: number, curve: string) => {
      const p = panel.current;
      const w = wrap.current;
      const s = screenRef.current;
      if (!p || !w || !s || motion.current.closing) return;
      const K = Math.max(0, Math.min(Math.round(height), s.h - s.top - 120));
      if (K === kb.current.height) return;
      kb.current.height = K;
      const ms = prefersReducedMotion() ? 0 : Math.max(0, duration);
      const ease = curve === "linear" ? "linear" : KEYBOARD_EASE;
      for (const a of kb.current.anims) {
        try {
          a.commitStyles?.();
        } catch {
          /* not rendered */
        }
        a.cancel();
      }
      kb.current.anims = [];
      if (card) return;
      if (fit) {
        // A fitted sheet lifts whole onto the keyboard.
        const from = currentOffset(w);
        // Above the keyboard there's no home indicator to keep clear of.
        if (K) p.style.setProperty("--sheet-safe-b", "0px");
        else p.style.removeProperty("--sheet-safe-b");
        w.style.transform = K ? `translateY(${-K}px)` : "";
        if (ms) kb.current.anims.push(w.animate([{ transform: `translateY(${from}px)` }, { transform: K ? `translateY(${-K}px)` : "none" }], { duration: ms, easing: ease }));
        return;
      }
      // A medium or large sheet: up to its large detent, its dock riding on the keyboard's top. (The sheet stays
      // large when the keyboard goes: only a finger takes it down.)
      const dock = body.current?.querySelector<HTMLElement>("[data-sheet-dock]") ?? foot.current;
      const fingered = Boolean(drag.current?.active || pose.current);
      const settling = motion.current.anims.length > 0 || motion.current.raf !== 0;
      if (settling && !fingered) stop();
      const p0 = p.getBoundingClientRect();
      const d0 = dock?.getBoundingClientRect();
      if (!fingered) {
        p.style.transform = "";
        pose.current = null;
      }
      if (K > 0 && size === "medium" && !expandedRef.current) {
        expandedRef.current = true;
        flushSync(() => setExpanded(true));
      }
      p.style.setProperty("--sheet-kb", `${K}px`);
      if (scrim.current && !fingered) scrim.current.style.opacity = String(restDim());
      if (!ms) return;
      const p1 = p.getBoundingClientRect();
      const d1 = dock?.getBoundingClientRect();
      const dp = fingered ? 0 : p0.top - p1.top;
      const dd = d0 && d1 ? d0.bottom - d1.bottom - dp : 0;
      const opts = { duration: ms, easing: ease };
      if (Math.abs(dp) > 0.5) kb.current.anims.push(p.animate([{ transform: `translateY(${dp}px)` }, { transform: "none" }], opts));
      if (dock && Math.abs(dd) > 0.5) kb.current.anims.push(dock.animate([{ transform: `translateY(${dd}px)` }, { transform: "none" }], opts));
    },
    [card, fit, size, stop, restDim],
  );

  useEffect(() => {
    if (!shown || !ready || card) return;
    const off = onKeyboardFrame((f) => keyboardTo(f.visible ? f.height : 0, f.duration, f.curve));
    return off;
  }, [shown, ready, card, keyboardTo]);

  // The screen turned (or the window changed) with the keyboard away: laid out on it again.
  useEffect(() => {
    if (!shown) return;
    const onResize = () => {
      const s = screenRef.current;
      if (!s || kb.current.height > 0) return;
      if (Math.abs(window.innerHeight - s.h) > 1) setScreen(measureScreen());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [shown]);

  // snapMedium: the medium detent ends after the last whole block that fits in the usual one.
  useLayoutEffect(() => {
    if (!ready || !snapMedium || size !== "medium" || card || !screen) return;
    const p = panel.current;
    const b = body.current;
    if (!p || !b) return;
    const pr = p.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const below = pr.bottom - br.bottom;
    const { medium } = detentsOn(screen);
    let best = 0;
    for (const el of b.querySelectorAll<HTMLElement>(snapMedium)) {
      // The sheet's height that shows this block whole, with the content at its top.
      const need = el.getBoundingClientRect().bottom - br.top + b.scrollTop + (br.top - pr.top) + below + 14;
      if (need <= medium + 1) best = Math.max(best, need);
    }
    setMediumFit(best >= screen.h * 0.3 ? Math.round(best) : null);
  }, [ready, snapMedium, size, card, screen]);

  // The header's two sides are as wide as each other (the wider one's buttons), so the title stays centred and
  // never runs under a button.
  useLayoutEffect(() => {
    const l = lead.current;
    const r = trail.current;
    if (!l || !r) return;
    const fitSides = () => {
      l.style.minWidth = "";
      r.style.minWidth = "";
      const wide = Math.max(l.scrollWidth, r.scrollWidth, 44);
      l.style.minWidth = `${wide}px`;
      r.style.minWidth = `${wide}px`;
    };
    fitSides();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fitSides);
    for (const el of [...l.children, ...r.children]) ro.observe(el);
    return () => ro.disconnect();
  });

  // A new detent (dragged to large, or another size asked for) dims the screen to match, once nothing moves it.
  useEffect(() => {
    if (shown && !pose.current && !motion.current.closing && scrim.current && !motion.current.raf) scrim.current.style.opacity = String(restDim());
  }, [shown, expanded, size, restDim]);

  // Stops whatever is moving when the sheet goes.
  useEffect(
    () => () => {
      stop();
      for (const a of kb.current.anims) a.cancel();
    },
    [stop],
  );

  // A tap on the dimmed screen: a pulled-up medium sheet goes back down (and the keyboard away); else it closes.
  const tapOutside = () => {
    if (size === "medium" && expandedRef.current && !motion.current.closing) {
      const a = document.activeElement;
      if (a instanceof HTMLElement && panel.current?.contains(a)) a.blur();
      const ds = detents();
      const p = panel.current;
      const from = p ? p.offsetHeight : ds[ds.length - 1]!;
      expandedRef.current = false;
      setExpanded(false);
      settle(from, ds[0]!, 0, ds);
      return;
    }
    onCloseRef.current();
  };

  if (!shown) return null;
  const s = screen;
  const { large, medium } = s ? detentsOn(s) : { large: 0, medium: 0 };
  const height = card || !s ? undefined : size === "fit" ? undefined : expanded ? `${large}px` : `${Math.min(mediumFit ?? medium, large)}px`;
  const named = title ? titleId : labelledBy;
  const hasHeader = Boolean(title || leading || trailing || closeButton);
  const safeBottom = s?.bottom ?? 0;
  return (
    <dialog
      ref={ref}
      aria-label={named ? undefined : label}
      aria-labelledby={named}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      // The whole screen: the dimmed page (a tap there closes) and the sheet on it. (`clip`: never scrolled to
      // show a field, which would move the sheet.)
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-clip border-0 bg-transparent p-0 text-ink outline-none backdrop:bg-transparent"
    >
      <div ref={scrim} aria-hidden data-sheet-scrim="" onClick={tapOutside} className="absolute inset-0 bg-black opacity-0" />
      <div
        ref={wrap}
        style={s ? ({ height: `${s.h}px`, "--sheet-safe-b": `${safeBottom}px`, "--sheet-max": `${s.h - s.top - (card ? 24 : 10)}px` } as React.CSSProperties) : { visibility: "hidden" }}
        className={card ? "pointer-events-none absolute inset-x-0 top-0 grid place-items-center" : "pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-end"}
      >
        <div
          ref={panel}
          data-iphone-sheet={card ? "card" : "sheet"}
          data-sheet-expanded={expanded ? "" : undefined}
          tabIndex={-1}
          style={card ? undefined : { height: `var(--sheet-drag-h, ${height ?? "auto"})` }}
          className={
            card
              ? `${SURFACE} pointer-events-auto flex max-h-[calc(var(--sheet-max)-var(--sheet-kb,0px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-sheet outline-none`
              : // Attached to the screen's bottom and side edges at every height, round only at the top (the
                // display's own corners round its foot); its surface runs on behind the home indicator.
                `${SURFACE} pointer-events-auto flex max-h-[var(--sheet-max)] flex-col overflow-hidden rounded-t-sheet pb-[var(--sheet-kb,0px)] outline-none [@media(orientation:landscape)]:mx-auto [@media(orientation:landscape)]:w-full [@media(orientation:landscape)]:max-w-[560px]`
          }
        >
          {card ? null : (
            // The grabber, 5 pt from the top over the header (which drags the sheet too).
            <div data-sheet-handle="" onPointerDown={onHandlePointerDown} className={`flex flex-none cursor-grab touch-none justify-center pt-[5px] ${hasHeader ? "absolute inset-x-0 top-0 z-10 h-4" : "h-5"}`} aria-hidden>
              <span className="h-[5px] w-9 rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_22%,transparent)]" />
            </div>
          )}
          {hasHeader ? (
            // 56 pt tall: its buttons at the sides (44 pt, their circles 12 pt in from the sheet's corner), the
            // title in the middle, centred on the sheet, cut short with an ellipsis before it reaches them.
            <header data-sheet-handle={card ? undefined : ""} onPointerDown={card ? undefined : onHandlePointerDown} className={`flex h-14 flex-none items-center px-1.5 ${card ? "mt-1" : ""}`}>
              <div ref={lead} className="flex flex-none items-center justify-start">
                {leading}
              </div>
              <div className="min-w-0 flex-1 px-1 text-center">
                {title ? (
                  <h2 id={titleId} className="truncate text-[17px] font-semibold leading-[22px] text-heading">
                    {title}
                  </h2>
                ) : null}
              </div>
              <div ref={trail} className="flex flex-none items-center justify-end">
                {trailing}
                {closeButton ? (
                  <button type="button" aria-label="Close" onClick={() => onCloseRef.current()} className={SHEET_BUTTON}>
                    <X size={15} strokeWidth={2.6} aria-hidden />
                  </button>
                ) : null}
              </div>
            </header>
          ) : null}
          {description ? (
            <div id={descId} className="flex-none px-5 pb-2 text-center text-[15px] leading-5 text-muted">
              {description}
            </div>
          ) : null}
          {/* What it shows runs on behind the home indicator: room for it at the end (less what the keyboard
              covers), so the last row scrolls up clear of it. A list that scrolls inside reads --sheet-safe-b. */}
          <div ref={body} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}>
            {ready ? children : null}
            {footer || card || !bodyPad ? null : <div aria-hidden data-sheet-safe-room="" className="h-[max(0px,calc(var(--sheet-safe-b,0px)-var(--sheet-kb,0px)))] flex-none" />}
          </div>
          {footer && ready ? (
            <footer ref={foot} className="flex flex-none flex-wrap items-center gap-2 px-4 pb-[max(16px,calc(var(--sheet-safe-b,0px)-var(--sheet-kb,0px)))] pt-2 [&>a]:min-h-12 [&>a]:flex-1 [&>button]:min-h-12 [&>button]:flex-1 [&>button]:text-[17px]">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
