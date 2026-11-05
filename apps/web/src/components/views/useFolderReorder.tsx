"use client";

// Folder cards put in order by dragging, as icons on the iPhone Home Screen: held over another card's middle a
// folder goes inside it (the card lights up, components/app/FolderDropLayer.tsx); held over a card's left or right
// quarter, or a gap between cards, it goes in that spot, and the other cards slide aside to open the gap where it
// will land. The drop layer reads the pointer (the mouse's drag and a finger's alike) and asks the list where it is
// (lib/app/dragSession.ts ReorderList); this hook keeps the gap and slides the cards.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { registerReorderList, useDragPayload, useDropHint } from "@/lib/app/dragSession";
import { cardZone, gapChangesOrder, reorderIds } from "@/lib/app/folderOrder";

const SLIDE = "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export interface FolderReorder {
  /** The cards' ids in the order to draw them (with the dragged one in the gap while there is one). */
  order: string[];
  /** The folder being dragged (null when none): its card is drawn as the spot it will land in. */
  dragged: string | null;
  /** Props for the list element (the cards' parent); undefined while it can't be reordered. */
  listProps: { ref: (el: HTMLElement | null) => void; "data-reorder-list"?: string };
}

/**
 * `ids`: the cards on show, in order. `enabled`: whether they can be reordered now (off while searching: a folder
 * still goes inside a card). `commit(draggedId, gap)`: put the folder in that gap among the others.
 */
export function useFolderReorder({ key, ids, enabled, commit }: { key: string; ids: string[]; enabled: boolean; commit: (draggedId: string, gap: number) => void }): FolderReorder {
  const payload = useDragPayload();
  const dragged = enabled && payload?.kind === "folder" ? payload.id : null;
  const hint = useDropHint(`reorder:${key}`);

  // The gap stays open while the folder is over a card's middle (so the cards don't jump back under the pointer),
  // and closes when the drag ends.
  const [held, setHeld] = useState<{ id: string; gap: number } | null>(null);
  if (dragged && hint?.index !== undefined && (held?.id !== dragged || held.gap !== hint.index)) setHeld({ id: dragged, gap: hint.index });
  if (!dragged && held) setHeld(null);
  const gap = dragged && held?.id === dragged ? held.gap : null;
  const order = dragged && gap !== null ? reorderIds(ids, dragged, gap) : ids;

  const list = useRef<HTMLElement | null>(null);
  const live = useRef({ ids, gap, commit });
  useLayoutEffect(() => {
    live.current = { ids, gap, commit };
  });

  useEffect(() => {
    if (!enabled) return;
    return registerReorderList(key, {
      spotAt(el, x, y, draggedId) {
        const host = list.current;
        if (!host || !host.contains(el)) return null;
        const { ids, gap } = live.current;
        const spot = (g: number) => ({ gap: g, changes: gapChangesOrder(ids, draggedId, g) });
        const others = ids.filter((id) => id !== draggedId);
        let card = el.closest<HTMLElement>("[data-reorder-id]");
        let between = false;
        if (!card || !host.contains(card)) {
          // Between cards: the nearest one says which side of it.
          between = true;
          let best = Infinity;
          for (const c of host.querySelectorAll<HTMLElement>("[data-reorder-id]")) {
            const r = c.getBoundingClientRect();
            const dx = Math.max(r.left - x, 0, x - r.right);
            const dy = Math.max(r.top - y, 0, y - r.bottom);
            if (dx * dx + dy * dy < best) {
              best = dx * dx + dy * dy;
              card = c;
            }
          }
          if (!card) return spot(others.length);
        }
        const id = card.dataset.reorderId ?? "";
        // Over its own spot: where it is stays (nothing yet when it hasn't moved).
        if (id === draggedId) return gap === null ? null : spot(gap);
        const r = card.getBoundingClientRect();
        const zone = between ? (x < r.left + r.width / 2 ? "before" : "after") : cardZone(x, r.left, r.width);
        if (zone === "inside") return "inside";
        const i = others.indexOf(id);
        if (i < 0) return null;
        return spot(zone === "before" ? i : i + 1);
      },
      commit(draggedId, gap) {
        live.current.commit(draggedId, gap);
      },
    });
  }, [key, enabled]);

  // The cards slide to their new places (measured before and after each change, then eased between).
  const rects = useRef(new Map<string, { x: number; y: number }>());
  const lastOrder = useRef("");
  const orderKey = order.join(" ");
  useLayoutEffect(() => {
    const host = list.current;
    if (!host) return;
    const moved = lastOrder.current !== "" && lastOrder.current !== orderKey;
    lastOrder.current = orderKey;
    const slide = moved && !reducedMotion();
    const seen = new Map<string, { x: number; y: number }>();
    for (const el of host.querySelectorAll<HTMLElement>(":scope > [data-reorder-id]")) {
      const id = el.dataset.reorderId ?? "";
      // (Laid-out places, not where a slide under way draws it: offsets leave transforms out.)
      const now = { x: el.offsetLeft, y: el.offsetTop };
      seen.set(id, now);
      const was = rects.current.get(id);
      if (!slide || !was || (was.x === now.x && was.y === now.y)) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${was.x - now.x}px, ${was.y - now.y}px)`;
      requestAnimationFrame(() => {
        el.style.transition = SLIDE;
        el.style.transform = "";
      });
    }
    rects.current = seen;
  });

  return {
    order,
    dragged,
    listProps: {
      ref: (el) => {
        list.current = el;
      },
      ...(enabled ? { "data-reorder-list": key } : {}),
    },
  };
}

/**
 * The cards to draw, in `reorder`'s order: each folder of `list`, and the id of a folder dragged in from elsewhere
 * (the sidebar) where its gap is, drawn as an empty spot (ReorderGap).
 */
export function reorderedCards<T extends { id: string }>(list: readonly T[], reorder: FolderReorder): (T | string)[] {
  const byId = new Map(list.map((f) => [f.id, f]));
  return reorder.order.map((id) => byId.get(id) ?? id);
}

/** Where a folder dragged in from elsewhere will land: an empty spot the size of a card. */
export function ReorderGap({ id }: { id: string }) {
  return <li data-reorder-id={id} aria-hidden className="min-h-24 rounded-panel border-2 border-dashed border-line" />;
}
