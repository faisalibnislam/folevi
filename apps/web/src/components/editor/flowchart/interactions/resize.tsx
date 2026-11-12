"use client";

// Resizing one selected shape by its eight handles (snapped to the grid; shift keeps its proportions).
import { resizeNode, updateNodes, type ResizeHandle } from "../ops";
import type { FlowNode, Pt } from "../schema";
import type { FlowController, Interaction } from "../controller/types";
import { isCoarse } from "./connect";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const handlePos = (n: FlowNode, h: ResizeHandle): Pt => ({
  x: h.includes("w") ? n.x : h.includes("e") ? n.x + n.w : n.x + n.w / 2,
  y: h.includes("n") ? n.y : h.includes("s") ? n.y + n.h : n.y + n.h / 2,
});

/** The handles show on the one selected shape (when nothing is being written). */
export function useResize(ctrl: FlowController) {
  const { docRef, setLive, commit, toWorld, view, single } = ctrl;

  const interaction: Interaction = {
    handles: "[data-fc-resize]",
    press: ({ target, at }) => {
      const el = target.closest("[data-fc-resize]");
      if (!el) return null;
      const before = docRef.current;
      const orig = before.nodes.find((x) => x.id === el.getAttribute("data-node"));
      if (!orig) return "handled";
      const handle = el.getAttribute("data-fc-resize") as ResizeHandle;
      return {
        move: (m) => {
          const p = toWorld(m.clientX, m.clientY);
          const next = resizeNode(orig, handle, p.x - at.x, p.y - at.y, m.shiftKey);
          setLive(updateNodes(before, [orig.id], () => next));
        },
        end: () => {
          if (docRef.current !== before) commit(docRef.current, { before });
        },
        cancel: () => setLive(before),
      };
    },
  };

  const k = view.k;
  const overlay = single
    ? HANDLES.map((h) => {
        const p = handlePos(single, h);
        const s = 8 / k;
        // What takes the press is wider than what shows (a finger needs more): a press on the shape's edge
        // resizes, and the connection dot just outside it (interactions/connect.tsx) starts a connector.
        const hit = (isCoarse() ? 22 : 12) / k;
        return (
          <g key={h}>
            <rect className="fc-resize fc-resize-hit" data-fc-resize={h} data-node={single.id} data-dir={h} x={p.x - hit / 2} y={p.y - hit / 2} width={hit} height={hit} />
            <rect className="fc-resize" data-fc-resize={h} data-node={single.id} data-dir={h} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} rx={2 / k} />
          </g>
        );
      })
    : null;

  return { interaction, overlay };
}
