"use client";

// Full canvas for the visual blocks (flowchart, mind map, sticky notes, chart, wireframe): the block's card
// lifts into the top layer (a manual popover, so nothing in the page clips it) and fills the window, then
// comes back. Toggled from the block's own toolbar or with ⇧⌘F; Esc goes back (each block decides when, as
// Esc may first close a panel or clear a selection). Styles: canvas.css (`.fb-canvas-card[data-full]`).
//
//   const full = useFullCanvas({ cardRef, focusRef, onRefit: (on) => fit() });
//   <div ref={cardRef} className="fb-canvas-card …" {...full.cardProps}>
//     <div ref={focusRef} className="fb-canvas-body" onKeyDown={(e) => full.handleKey(e) || …}>
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface FullCanvas {
  full: boolean;
  /** Turns full canvas on or off (or flips it). */
  toggleFull: (on?: boolean) => void;
  /** Spread on the card: marks it full and makes it a manual popover while it is. */
  cardProps: { "data-full"?: true; popover?: "manual" };
  /**
   * ⇧⌘F flips full canvas; Esc leaves it (only when `escape` is true, the default). Returns true when the
   * key was used (and stops it), so the caller can return early.
   */
  handleKey: (e: React.KeyboardEvent | KeyboardEvent, opts?: { escape?: boolean }) => boolean;
}

export function useFullCanvas({
  cardRef,
  focusRef,
  onRefit,
}: {
  /** The card that lifts into the top layer. */
  cardRef: RefObject<HTMLElement | null>;
  /** Focused when full canvas opens, so the keyboard keeps working there. */
  focusRef?: RefObject<HTMLElement | null>;
  /** Runs a frame after full canvas turns on or off, once the card has its new size (fit the content again). */
  onRefit?: (full: boolean) => void;
}): FullCanvas {
  const [full, setFull] = useState(false);
  const refit = useRef(false);
  const onRefitRef = useRef(onRefit);
  useLayoutEffect(() => {
    onRefitRef.current = onRefit;
  });

  const toggleFull = useCallback((on?: boolean) => {
    setFull((was) => {
      const next = on ?? !was;
      if (next !== was) refit.current = true;
      return next;
    });
  }, []);

  // Shown in the top layer while on (and hidden on the way back, or when the block goes away).
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !full) return;
    try {
      if (!card.matches(":popover-open")) card.showPopover();
    } catch {
      /* Without the Popover API it's still fixed over the page. */
    }
    focusRef?.current?.focus({ preventScroll: true });
    return () => {
      try {
        if (card.matches(":popover-open")) card.hidePopover();
      } catch {
        /* Already gone. */
      }
    };
  }, [full, cardRef, focusRef]);

  // A frame later, once the card has its new size: the block measures itself directly (an observer's
  // numbers may lag) and fits its content again.
  useEffect(() => {
    if (!refit.current) return;
    const id = requestAnimationFrame(() => {
      refit.current = false;
      onRefitRef.current?.(full);
    });
    return () => cancelAnimationFrame(id);
  }, [full]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent | KeyboardEvent, opts: { escape?: boolean } = {}) => {
      const mod = e.metaKey || e.ctrlKey;
      const used = mod && e.shiftKey && e.key.toLowerCase() === "f" ? (toggleFull(), true) : e.key === "Escape" && !mod && full && opts.escape !== false ? (toggleFull(false), true) : false;
      if (used) {
        e.preventDefault();
        e.stopPropagation();
      }
      return used;
    },
    [full, toggleFull],
  );

  return { full, toggleFull, cardProps: full ? { "data-full": true, popover: "manual" } : {}, handleKey };
}
