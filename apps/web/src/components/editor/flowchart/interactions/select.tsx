"use client";

// Selecting connectors by clicking them (shift or ⌘ adds or removes), and shapes by dragging an area on
// empty canvas (shift or ⌘ adds to the selection). Shapes are selected when pressed (interactions/move.tsx).
import { useRef, useState } from "react";
import { rectsOverlap, type Rect } from "../schema";
import { NO_SELECTION } from "../ops";
import type { FlowController, Interaction } from "../controller/types";

export function useSelect(ctrl: FlowController) {
  const { docRef, selRef, setSel, toWorld } = ctrl;
  const routedRef = useRef(ctrl.routed);
  routedRef.current = ctrl.routed;
  const [marquee, setMarquee] = useState<Rect | null>(null);

  /** Connector clicks: offered before the area selection. */
  const edges: Interaction = {
    handles: "[data-fc-edge]",
    press: ({ e, target }) => {
      const edgeEl = target.closest("[data-fc-edge]");
      if (!edgeEl) return null;
      const id = edgeEl.getAttribute("data-fc-edge")!;
      const s = selRef.current;
      if (e.shiftKey || e.metaKey) setSel({ nodes: s.nodes, edges: s.edges.includes(id) ? s.edges.filter((x) => x !== id) : [...s.edges, id] });
      else setSel({ nodes: [], edges: [id] });
      return "handled";
    },
  };

  /** Empty canvas: select an area. Takes every press that reaches it, so it goes last. */
  const area: Interaction = {
    press: ({ e, at }) => {
      const base = e.shiftKey || e.metaKey ? selRef.current : NO_SELECTION;
      if (!e.shiftKey && !e.metaKey) setSel(NO_SELECTION);
      return {
        move: (m) => {
          const p = toWorld(m.clientX, m.clientY);
          const r = { x: Math.min(at.x, p.x), y: Math.min(at.y, p.y), w: Math.abs(p.x - at.x), h: Math.abs(p.y - at.y) };
          setMarquee(r);
          const hits = docRef.current.nodes.filter((n) => rectsOverlap(n, r)).map((n) => n.id);
          // Connectors too: the ones between two shapes in the area, and any whose whole line is in it
          // (one with a free end), so "select an area, delete" leaves nothing behind.
          const inArea = new Set(hits);
          const inside = (p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
          const lines = routedRef.current.filter((x) => (inArea.has(x.edge.from ?? "") && inArea.has(x.edge.to ?? "")) || (x.points.length > 0 && x.points.every(inside))).map((x) => x.edge.id);
          setSel({ nodes: [...new Set([...base.nodes, ...hits])], edges: [...new Set([...base.edges, ...lines])] });
        },
        end: () => setMarquee(null),
        cancel: () => setMarquee(null),
      };
    },
  };

  const overlay = marquee ? <rect className="fc-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} /> : null;

  return { edges, area, overlay };
}
