"use client";

// Pressing a shape selects it (shift or ⌘ adds or removes it), and dragging moves the selected shapes,
// snapping to the grid and to nearby shapes' edges and centres (with guides; ⌥ turns snapping off).
import { useState } from "react";
import { rectsOverlap } from "../schema";
import { boxOf, moveNodes, snapGroup, type Guide } from "../ops";
import type { FlowController, Interaction } from "../controller/types";

export function useMove(ctrl: FlowController) {
  const { docRef, setLive, commit, selRef, setSel, toWorld, viewRef } = ctrl;
  const [guides, setGuides] = useState<Guide[]>([]);

  const interaction: Interaction = {
    handles: "[data-fc-node]",
    press: ({ e, target, at }) => {
      const nodeEl = target.closest("[data-fc-node]");
      if (!nodeEl) return null;
      const id = nodeEl.getAttribute("data-fc-node")!;
      const s = selRef.current;
      let nodes = s.nodes;
      let toggled = false;
      if (e.shiftKey || e.metaKey) {
        toggled = true;
        nodes = s.nodes.includes(id) ? s.nodes.filter((x) => x !== id) : [...s.nodes, id];
        setSel({ nodes, edges: s.edges });
      } else if (!s.nodes.includes(id)) {
        nodes = [id];
        setSel({ nodes, edges: [] });
      }
      const before = docRef.current;
      const moving = before.nodes.filter((n) => nodes.includes(n.id));
      if (!moving.length) return "handled";
      const origin = new Map(moving.map((n) => [n.id, { x: n.x, y: n.y }]));
      const box = boxOf(moving)!;
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      return {
        move: (m) => {
          if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 3) return;
          moved = true;
          const p = toWorld(m.clientX, m.clientY);
          const dx = p.x - at.x;
          const dy = p.y - at.y;
          const moving = { ...box, x: box.x + dx, y: box.y + dy };
          // Only nearby shapes offer alignment (keeps big charts fast and guides relevant).
          const reach = { x: moving.x - 600, y: moving.y - 600, w: moving.w + 1200, h: moving.h + 1200 };
          const others = before.nodes.filter((n) => !origin.has(n.id) && rectsOverlap(n, reach));
          const s = m.altKey ? { dx: 0, dy: 0, guides: [] } : snapGroup(moving, others, 6 / viewRef.current.k);
          setLive(moveNodes(before, origin, dx + s.dx, dy + s.dy));
          setGuides(s.guides);
        },
        end: () => {
          setGuides([]);
          if (moved) commit(docRef.current, { before });
          // A click (no drag) on one of several selected shapes selects just that one.
          else if (!toggled && selRef.current.nodes.length > 1) setSel({ nodes: [id], edges: [] });
        },
        cancel: () => {
          setGuides([]);
          setLive(before);
        },
      };
    },
  };

  /** Alignment guides while dragging (drawn in the overlay layer). */
  const overlay = guides.map((g, i) =>
    g.axis === "x" ? <line key={i} className="fc-guide" x1={g.at} x2={g.at} y1={g.from - 16} y2={g.to + 16} /> : <line key={i} className="fc-guide" y1={g.at} y2={g.at} x1={g.from - 16} x2={g.to + 16} />,
  );

  return { interaction, overlay };
}
