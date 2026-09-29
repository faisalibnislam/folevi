"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** Where a marquee may not start: anything you can click, type in or drag, and the cards themselves. */
const NOT_EMPTY_SPACE = 'a, button, input, select, textarea, label, [role="menu"], [role="radiogroup"], [contenteditable="true"], [draggable="true"], [data-card-id], [data-no-marquee]';
const DRAG_THRESHOLD = 4;
const EDGE = 48;

function typingIn(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

function blockingLayerOpen() {
  return Boolean(document.querySelector('dialog[open], [role="menu"]'));
}

/**
 * Multi-select for a grid or list of note cards (each marked `data-card-id`):
 * - click-and-drag on empty space draws a selection rectangle that selects the cards it touches (with ⌘/Ctrl
 *   or Shift held it adds to the selection); the page scrolls when the pointer nears its edge;
 * - ⌘/Ctrl-click toggles a card, Shift-click selects the range from the last one;
 * - ⌘/Ctrl+A selects every card shown, Escape (or a click on empty space) clears.
 * `ids` are the cards in display order. Keyboard users select from a card's menu ("Select").
 */
export function useCardSelection(ids: string[], enabled = true) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<CSSProperties | null>(null);
  const anchor = useRef<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Only cards still on screen count (a moved or trashed note drops out of the selection).
  const selectedIds = useMemo(() => ids.filter((id) => picked.has(id)), [ids, picked]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const clear = useCallback(() => {
    setPicked(new Set());
    anchor.current = null;
  }, []);
  const selectAll = useCallback(() => setPicked(new Set(idsRef.current)), []);
  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectRange = useCallback((id: string) => {
    const list = idsRef.current;
    const from = anchor.current ? list.indexOf(anchor.current) : -1;
    const to = list.indexOf(id);
    if (to < 0) return;
    const [a, b] = from < 0 ? [to, to] : from < to ? [from, to] : [to, from];
    setPicked((prev) => new Set([...prev, ...list.slice(a, b + 1)]));
    if (from < 0) anchor.current = id;
  }, []);

  /** For a card's onClickCapture: modifier clicks select instead of opening the note. */
  const onCardClick = useCallback(
    (id: string) => (e: ReactMouseEvent) => {
      if (!enabled || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      } else if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        selectRange(id);
      }
    },
    [enabled, toggle, selectRange],
  );

  // Escape clears; ⌘/Ctrl+A selects everything shown (not while typing or with a dialog or menu open).
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typingIn(e.target) || blockingLayerOpen()) return;
      if (e.key === "Escape" && selectedIds.length) {
        e.preventDefault();
        clear();
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && idsRef.current.length) {
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, selectedIds.length, clear, selectAll]);

  /** For the surface around the cards (it should fill the scrolling area). */
  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0 || e.pointerType === "touch") return;
      const target = e.target as Element;
      // A click that only closes an open menu doesn't start a selection.
      if (target.closest(NOT_EMPTY_SPACE) || blockingLayerOpen()) return;
      const surface = e.currentTarget;
      const scroller = (surface.closest("main") as HTMLElement | null) ?? document.scrollingElement ?? document.documentElement;
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      const base = additive ? new Set(picked) : new Set<string>();
      const start = { x: e.clientX, y: e.clientY + scroller.scrollTop };
      let last = { x: e.clientX, y: e.clientY };
      let moved = false;
      let frame = 0;

      const update = () => {
        const y = last.y + scroller.scrollTop;
        const left = Math.min(start.x, last.x);
        const top = Math.min(start.y, y) - scroller.scrollTop;
        const width = Math.abs(last.x - start.x);
        const height = Math.abs(y - start.y);
        setMarquee({ left, top, width, height });
        const hits = new Set(base);
        surface.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right >= left && r.left <= left + width && r.bottom >= top && r.top <= top + height) hits.add(el.dataset.cardId!);
        });
        setPicked(hits);
      };
      // Scroll while the pointer is near the top or bottom edge of the scrolling area.
      const tick = () => {
        const r = scroller.getBoundingClientRect();
        const topEdge = r.top + (parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0);
        const speed = last.y < topEdge + EDGE ? -Math.ceil((topEdge + EDGE - last.y) / 4) : last.y > r.bottom - EDGE ? Math.ceil((last.y - (r.bottom - EDGE)) / 4) : 0;
        if (speed) {
          scroller.scrollTop += speed;
          update();
        }
        frame = requestAnimationFrame(tick);
      };
      const onMove = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        if (!moved) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY + scroller.scrollTop - start.y) < DRAG_THRESHOLD) return;
          moved = true;
          // No text selection while drawing.
          document.body.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
          frame = requestAnimationFrame(tick);
        }
        update();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        cancelAnimationFrame(frame);
        document.body.style.userSelect = "";
        setMarquee(null);
        // A plain click on empty space clears the selection.
        if (!moved && !additive) clear();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [enabled, picked, clear],
  );

  return { selectedIds, selected, clear, selectAll, toggle, onCardClick, onSurfacePointerDown, marquee };
}
