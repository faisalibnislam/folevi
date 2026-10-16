"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export type SheetSize = "fit" | "medium" | "large";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
 * A sheet, as iOS presents one: a panel from the bottom of the screen with a grabber, dragged down to
 * dismiss (from the grabber or the header anywhere, or from the content once it's scrolled to its top), and
 * for `medium` sheets dragged up to fill the screen. `variant="card"` is the short-form version: a glass card
 * in the middle (above the keyboard, which shrinks the page). Both are modal <dialog>s: the page behind is
 * inert, focus stays inside, Escape closes, and focus returns to what opened it.
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
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Mounted while open and while the closing animation plays.
  const [shown, setShown] = useState(open);
  const [expanded, setExpanded] = useState(size === "large");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setShown(true);
      setExpanded(size === "large");
    }
  }, [open, size]);

  // Open as a modal; on close, slide away first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !shown) return;
    if (open && !el.open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      el.showModal();
    }
    if (!open && el.open) {
      const p = panel.current;
      const done = () => {
        if (ref.current?.open) ref.current.close();
        setShown(false);
        const back = opener.current;
        if (back?.isConnected) back.focus({ preventScroll: true });
      };
      if (!p || reduceMotion()) return done();
      const anim =
        variant === "card"
          ? p.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.96)" }], { duration: 160, easing: "ease-in" })
          : p.animate([{ transform: getComputedStyle(p).transform === "none" ? "translateY(0)" : getComputedStyle(p).transform }, { transform: "translateY(100%)" }], { duration: 260, easing: EASE });
      anim.onfinish = done;
      anim.oncancel = done;
    }
  }, [open, shown, variant]);

  // Dragging: down to dismiss, up (from medium) to fill the screen.
  const drag = useRef<{ startY: number; lastY: number; lastT: number; v: number; active: boolean; decided: boolean; scroller: HTMLElement | null } | null>(null);
  const setOffset = (y: number) => {
    const p = panel.current;
    if (p) p.style.transform = y ? `translateY(${y}px)` : "";
  };
  const settle = useCallback(
    (dy: number, v: number) => {
      const p = panel.current;
      if (!p) return;
      const h = p.offsetHeight;
      const up = dy < 0;
      if (up && size === "medium" && !expanded && (dy < -60 || v < -0.5)) {
        setExpanded(true);
        setOffset(0);
        return;
      }
      if (!up && (dy > h * 0.3 || v > 0.6)) {
        if (size === "medium" && expanded && dy < h * 0.5 && v < 1.2) {
          setExpanded(false);
          setOffset(0);
          return;
        }
        onCloseRef.current();
        return;
      }
      p.animate([{ transform: `translateY(${Math.max(0, dy)}px)` }, { transform: "translateY(0)" }], { duration: 280, easing: EASE });
      setOffset(0);
    },
    [size, expanded],
  );

  useEffect(() => {
    const p = panel.current;
    if (!p || !shown || variant === "card") return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      const target = e.target as Element;
      const handle = Boolean(target.closest?.("[data-sheet-handle]"));
      if (!handle && target.closest?.(NO_DRAG)) return;
      drag.current = { startY: t.clientY, lastY: t.clientY, lastT: e.timeStamp, v: 0, active: handle, decided: handle, scroller: handle ? null : scrollerOf(target, p) };
    };
    const onMove = (e: TouchEvent) => {
      const d = drag.current;
      const t = e.touches[0];
      if (!d || !t) return;
      const dy = t.clientY - d.startY;
      if (!d.decided) {
        if (Math.abs(dy) < 6) return;
        d.decided = true;
        // From the content, only a pull down at the top of what it scrolls (or up, to expand a medium sheet).
        const atTop = !d.scroller || d.scroller.scrollTop <= 0;
        d.active = (dy > 0 && atTop) || (dy < 0 && size === "medium" && !expanded && !d.scroller);
        if (!d.active) return;
        d.startY = t.clientY;
      }
      if (!d.active) return;
      if (e.cancelable) e.preventDefault();
      const now = e.timeStamp;
      d.v = (t.clientY - d.lastY) / Math.max(1, now - d.lastT);
      d.lastY = t.clientY;
      d.lastT = now;
      const y = t.clientY - d.startY;
      // Resisting upward (a sheet that can't grow), like a rubber band.
      setOffset(y > 0 ? y : size === "medium" && !expanded ? y / 2 : y / 6);
    };
    const onEnd = () => {
      const d = drag.current;
      drag.current = null;
      if (!d?.active) return;
      settle(d.lastY - d.startY, d.v);
    };
    p.addEventListener("touchstart", onStart, { passive: true });
    p.addEventListener("touchmove", onMove, { passive: false });
    p.addEventListener("touchend", onEnd);
    p.addEventListener("touchcancel", onEnd);
    return () => {
      p.removeEventListener("touchstart", onStart);
      p.removeEventListener("touchmove", onMove);
      p.removeEventListener("touchend", onEnd);
      p.removeEventListener("touchcancel", onEnd);
    };
  }, [shown, variant, size, expanded, settle]);

  // A mouse (or a pen) on the grabber drags too.
  const onHandlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const startY = e.clientY;
    let last = startY;
    let lastT = e.timeStamp;
    let v = 0;
    const move = (ev: PointerEvent) => {
      v = (ev.clientY - last) / Math.max(1, ev.timeStamp - lastT);
      last = ev.clientY;
      lastT = ev.timeStamp;
      setOffset(Math.max(-40, ev.clientY - startY));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      settle(last - startY, v);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!shown) return null;
  const card = variant === "card";
  const height = card ? undefined : size === "fit" ? undefined : expanded ? "calc(100dvh - env(safe-area-inset-top) - 10px)" : "min(56dvh, calc(100dvh - env(safe-area-inset-top) - 10px))";
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
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
      className={
        card
          ? "m-auto w-[min(400px,calc(100%-24px))] max-w-none overflow-visible border-0 bg-transparent p-0 text-ink outline-none backdrop:bg-[var(--iphone-scrim)] backdrop:animate-[iphone-fade-in_200ms_ease-out]"
          : "fixed inset-x-0 bottom-0 top-auto m-0 h-auto max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0 text-ink outline-none backdrop:bg-[var(--iphone-scrim)] backdrop:animate-[iphone-fade-in_220ms_ease-out]"
      }
    >
      <div
        ref={panel}
        data-iphone-sheet={card ? "card" : "sheet"}
        style={{ height, transition: "height 320ms cubic-bezier(0.32, 0.72, 0, 1)" }}
        className={
          card
            ? "ui-liquid-strong flex max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] flex-col overflow-hidden rounded-sheet animate-[iphone-card-in_260ms_cubic-bezier(0.2,0.9,0.25,1.05)] motion-reduce:animate-none"
            : "ui-liquid-strong flex max-h-[calc(100dvh-env(safe-area-inset-top)-10px)] flex-col overflow-hidden rounded-t-sheet pb-[env(safe-area-inset-bottom)] animate-[iphone-sheet-in_380ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none [@media(orientation:landscape)]:mx-auto [@media(orientation:landscape)]:max-w-[560px]"
        }
      >
        {card ? null : (
          <div data-sheet-handle="" onPointerDown={onHandlePointerDown} className="flex h-5 flex-none cursor-grab touch-none items-end justify-center" aria-hidden>
            <span className="h-[5px] w-9 rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_22%,transparent)]" />
          </div>
        )}
        {hasHeader ? (
          <header data-sheet-handle={card ? undefined : ""} className={`flex flex-none items-center gap-2 px-4 ${card ? "pb-2 pt-4" : "pb-2 pt-1.5"}`}>
            <div className="flex min-w-11 flex-none items-center">{leading}</div>
            <div className="min-w-0 flex-1 text-center">
              {title ? (
                <h2 id={titleId} className="truncate text-[17px] font-semibold leading-tight text-heading">
                  {title}
                </h2>
              ) : null}
            </div>
            <div className="flex min-w-11 flex-none items-center justify-end gap-1">
              {trailing}
              {closeButton ? (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => onCloseRef.current()}
                  className="grid h-[30px] w-[30px] place-items-center rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_9%,transparent)] text-muted outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <X size={15} strokeWidth={2.6} aria-hidden />
                </button>
              ) : null}
            </div>
          </header>
        ) : null}
        {description ? (
          <div id={descId} className="flex-none px-5 pb-2 text-center text-[14px] leading-snug text-muted">
            {description}
          </div>
        ) : null}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}>{children}</div>
        {footer ? <footer className="flex flex-none gap-2 px-4 pb-4 pt-2 [&>*]:h-12 [&>*]:flex-1 [&>*]:text-[16px]">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
