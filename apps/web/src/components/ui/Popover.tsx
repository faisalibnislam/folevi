"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTopLayer } from "./topLayer";
import { useIphoneApp } from "@/lib/iphone";
import { Sheet } from "@/components/iphone/Sheet";
import { POP_IN, focusedFieldIn, letKeyboardGo, popOut } from "@/lib/native/ui";

/**
 * A closed panel fades out as a copy of itself (the panel is gone from the page by then), as menus do: 150 ms, a
 * 4 px rise on the web, only the fade on the Mac and with Reduce Motion (2026-11-25 polish review).
 */
function fadeOutCopy(node: HTMLElement) {
  if (typeof node.animate !== "function") return;
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.removeAttribute("role");
  ghost.removeAttribute("aria-label");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("data-closing", "");
  ghost.inert = true;
  ghost.style.pointerEvents = "none";
  ghost.style.animation = "none";
  document.body.appendChild(ghost);
  try {
    ghost.showPopover();
  } catch {
    /* Popover API missing: it's fixed in place already. */
  }
  const still = (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || document.documentElement.getAttribute("data-desktop") === "mac";
  const fade = ghost.animate([{ opacity: 1 }, { opacity: 0, transform: still ? "none" : "translateY(-4px)" }], { duration: 150, easing: "ease-out", fill: "forwards" });
  fade.onfinish = () => ghost.remove();
  fade.oncancel = () => ghost.remove();
}

/**
 * A non-modal panel floating next to its anchor in the top layer (nothing can clip or cover it). It's a
 * labelled dialog: focus moves into it when it opens, Escape or a click outside closes it, and Escape
 * puts focus back on the anchor. Closing, it fades out (popOut), and a field typing in it lets the keyboard go first.
 */
export function Popover({
  open,
  onClose,
  anchor,
  label,
  children,
  align = "start",
  className = "w-80",
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const iphone = useIphoneApp();
  const panel = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setLeaving(!open && !iphone);
  }
  const style = useTopLayer((open || leaving) && !iphone, panel, anchor, { align, gap: 6 });
  useLayoutEffect(() => {
    const el = panel.current;
    if (!leaving || !el) return;
    const typing = focusedFieldIn(el);
    if (typing) letKeyboardGo(typing);
    return popOut(el, () => setLeaving(false));
  }, [leaving]);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || iphone) return;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, button, [href], textarea, [tabindex]:not([tabindex='-1'])");
    (first ?? panel.current)?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // Menus and dropdowns opened from the panel live in the top layer outside it.
      if (target.closest?.('[role="menu"], [role="listbox"]')) return;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close.current();
        anchor.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, iphone]);
  // The panel last shown, so its closing can fade a copy of it.
  const shownPanel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && !iphone) {
      shownPanel.current = panel.current;
      return;
    }
    const node = shownPanel.current;
    shownPanel.current = null;
    if (node) fadeOutCopy(node);
  }, [open, iphone]);
  // In the iPhone app, a sheet from the bottom of the screen.
  if (iphone)
    return (
      <Sheet open={open} onClose={onClose} label={label}>
        <div className="px-1 pb-3">{children}</div>
      </Sheet>
    );
  if (!open && !leaving) return null;
  return (
    <div
      ref={panel}
      popover="manual"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={style}
      className={`ui-pop z-[100] max-h-[min(620px,calc(100vh-2rem))] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-panel border-0 p-0 text-ink outline-none origin-top ${POP_IN} ${className}`}
    >
      {children}
    </div>
  );
}
