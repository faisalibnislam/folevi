"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { SPRINGS, VelocityTracker, prefersReducedMotion, springAt, springDuration } from "@/lib/native/physics";
import { safeInsets } from "@/lib/iphone";
import { dimAt, poseFor, releaseTarget, restingDetent, settlePose, springFrames, springStart, type SheetPose } from "./sheetMotion";

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

/** The sheet's large detent (the screen below the status bar) and medium one (a little over half), in points. */
function screenDetents(): { large: number; medium: number } {
  const large = window.innerHeight - safeInsets().top - 10;
  return { large, medium: Math.min(window.innerHeight * 0.56, large) };
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
 * does that first, as on iOS). The screen behind dims with how much of the sheet shows. `variant="card"` is the
 * short-form version: a glass card in the middle (above the keyboard, which shrinks the page). Both are modal
 * <dialog>s: the page behind is inert, focus stays inside, Escape closes, and focus returns to what opened it.
 * Reduce Motion: every move is a 150 ms cross-fade.
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
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
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

  // What's moving the sheet now: the animations coming in or going away, a settle on a detent, a finger.
  const motion = useRef<{ anims: Animation[]; raf: number; closing: boolean }>({ anims: [], raf: 0, closing: false });
  // The pose a finger or a settle has drawn (null: at rest, where its CSS puts it).
  const pose = useRef<SheetPose | null>(null);
  // A drag that let the sheet go: how fast, for the spring that takes it away (points per second, up positive).
  const releaseVelocity = useRef(0);

  const detents = useCallback((): number[] => {
    const p = panel.current;
    if (size === "fit" || card) return [p?.offsetHeight ?? 0];
    const { large, medium } = screenDetents();
    return size === "medium" ? [Math.min(mediumFitRef.current ?? medium, large), large] : [large];
  }, [size, card]);
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

  // Open as a modal on a spring from below; on close, go away first.
  useLayoutEffect(() => {
    const el = ref.current;
    const p = panel.current;
    const s = scrim.current;
    if (!el || !shown) return;
    if (open && (!el.open || motion.current.closing)) {
      const reopening = el.open;
      if (!reopening) {
        const active = document.activeElement;
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
        el.showModal();
        // The sheet itself takes the focus (not its Close button, ringed); a field that asks for it takes it next.
        p?.focus({ preventScroll: true });
        setReady(true);
      }
      stop();
      motion.current.closing = false;
      draw(null, restDim());
      if (!p || !s) return;
      const dim = restDim();
      if (prefersReducedMotion()) {
        motion.current.anims = [p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" }), s.animate([{ opacity: 0 }, { opacity: dim }], { duration: 150, easing: "linear" })];
        return;
      }
      if (card) {
        motion.current.anims = [s.animate([{ opacity: 0 }, { opacity: dim }], { duration: 220, easing: "ease-out" })];
        return;
      }
      const { progress, ms } = springFrames(SPRINGS.sheet);
      // From below the screen (a share of its own height, which is known only once its content is in).
      motion.current.anims = [
        p.animate(progress.map((k) => ({ transform: `translateY(calc(${(1 - k) * 100}% + ${(1 - k) * OFF}px))` })), { duration: ms, easing: "linear" }),
        s.animate(progress.map((k) => ({ opacity: Math.min(1, Math.max(0, k * dim)) })), { duration: ms, easing: "linear" }),
      ];
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
        if (ref.current?.open) ref.current.close();
        setShown(false);
        setReady(false);
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
        const to = p.offsetHeight + OFF;
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
  }, [open, shown, card, draw, stop, restDim]);

  // Settles from where a finger left the sheet to a detent, on the sheet's spring (a new touch catches it).
  const settle = useCallback(
    (visible: number, target: number, velocity: number, ds: number[]) => {
      const dims = dimsFor(ds);
      if (prefersReducedMotion()) {
        draw(null, restDim());
        return;
      }
      const v0 = springStart(velocity, target - visible);
      const duration = springDuration(SPRINGS.sheet, v0);
      const start = performance.now();
      const step = (now: number) => {
        const t = (now - start) / 1000;
        if (t >= duration) {
          motion.current.raf = 0;
          draw(null, restDim());
          return;
        }
        const at = visible + (target - visible) * springAt(t, SPRINGS.sheet, v0);
        draw(settlePose(at, ds), dimAt(at, ds, dims));
        motion.current.raf = requestAnimationFrame(step);
      };
      motion.current.raf = requestAnimationFrame(step);
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

  // snapMedium: the medium detent ends after the last whole block that fits in the usual one.
  useLayoutEffect(() => {
    if (!ready || !snapMedium || size !== "medium" || card) return;
    const measure = () => {
      const p = panel.current;
      const b = body.current;
      if (!p || !b) return;
      const pr = p.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const below = pr.bottom - br.bottom;
      const { medium } = screenDetents();
      let best = 0;
      for (const el of b.querySelectorAll<HTMLElement>(snapMedium)) {
        // The sheet's height that shows this block whole, with the content at its top.
        const need = el.getBoundingClientRect().bottom - br.top + b.scrollTop + (br.top - pr.top) + below + 14;
        if (need <= medium + 1) best = Math.max(best, need);
      }
      setMediumFit(best >= window.innerHeight * 0.3 ? Math.round(best) : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ready, snapMedium, size, card]);

  // A new detent (dragged to large, or another size asked for) dims the screen to match, once nothing moves it.
  useEffect(() => {
    if (shown && !pose.current && !motion.current.closing && scrim.current && !motion.current.raf) scrim.current.style.opacity = String(restDim());
  }, [shown, expanded, size, restDim]);

  // Stops whatever is moving when the sheet goes.
  useEffect(() => () => stop(), [stop]);

  if (!shown) return null;
  const height = card ? undefined : size === "fit" ? undefined : expanded ? "calc(100dvh - env(safe-area-inset-top) - 10px)" : mediumFit ? `${mediumFit}px` : "min(56dvh, calc(100dvh - env(safe-area-inset-top) - 10px))";
  const named = title ? titleId : labelledBy;
  const hasHeader = Boolean(title || leading || trailing || closeButton);
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
      // The whole screen: the dimmed page (a tap there closes) and the sheet on it.
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-ink outline-none backdrop:bg-transparent"
    >
      <div ref={scrim} aria-hidden data-sheet-scrim="" onClick={() => onCloseRef.current()} className="absolute inset-0 bg-black opacity-0" />
      <div className={card ? "pointer-events-none absolute inset-0 grid place-items-center" : "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col"}>
        <div
          ref={panel}
          data-iphone-sheet={card ? "card" : "sheet"}
          tabIndex={-1}
          style={card ? undefined : { height: `var(--sheet-drag-h, ${height ?? "auto"})` }}
          className={
            card
              ? "ui-liquid-strong pointer-events-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-sheet outline-none animate-[iphone-card-in_260ms_cubic-bezier(0.2,0.9,0.25,1.05)] motion-reduce:animate-none"
              : // As on iOS 26: a sheet that isn't full height floats as glass, inset from the screen's edges with
                // round corners all round; pulled up to full height it meets the edges.
                `ui-liquid-strong pointer-events-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-10px)] flex-col overflow-hidden outline-none transition-[margin,border-radius] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] [@media(orientation:landscape)]:mx-auto [@media(orientation:landscape)]:w-full [@media(orientation:landscape)]:max-w-[560px] ${
                  expanded ? "rounded-t-sheet pb-[env(safe-area-inset-bottom)]" : "iphone-sheet-float mx-2 mb-2 rounded-float pb-[max(8px,calc(env(safe-area-inset-bottom)-14px))]"
                }`
          }
        >
          {card ? null : (
            // The grabber, 5 pt from the top over the header (which drags the sheet too).
            <div data-sheet-handle="" onPointerDown={onHandlePointerDown} className={`flex flex-none cursor-grab touch-none justify-center pt-[5px] ${hasHeader ? "absolute inset-x-0 top-0 z-10 h-4" : "h-5"}`} aria-hidden>
              <span className="h-[5px] w-9 rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_22%,transparent)]" />
            </div>
          )}
          {hasHeader ? (
            // 56 pt tall, title centred, its buttons 44 pt with their circles 12 pt in from the sheet's corner.
            <header data-sheet-handle={card ? undefined : ""} onPointerDown={card ? undefined : onHandlePointerDown} className={`flex h-14 flex-none items-center px-1.5 ${card ? "mt-1" : ""}`}>
              <div className="flex min-w-11 flex-1 basis-0 items-center justify-start">{leading}</div>
              <div className="min-w-0 flex-[0_1_auto] px-1 text-center">
                {title ? (
                  <h2 id={titleId} className="truncate text-[17px] font-semibold leading-[22px] text-heading">
                    {title}
                  </h2>
                ) : null}
              </div>
              <div className="flex min-w-11 flex-1 basis-0 items-center justify-end">
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
          <div ref={body} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}>{ready ? children : null}</div>
          {footer && ready ? <footer className="flex flex-none flex-wrap items-center gap-2 px-4 pb-4 pt-2 [&>a]:min-h-12 [&>a]:flex-1 [&>button]:min-h-12 [&>button]:flex-1 [&>button]:text-[17px]">{footer}</footer> : null}
        </div>
      </div>
    </dialog>
  );
}
